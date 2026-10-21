import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadSettings } from '../src/config.js'
import { DirectAdminClient, HostingError } from '../src/directadmin.js'
import { WordPressClient } from '../src/wordpress.js'
import { MAX_RESPONSE_BYTES } from '../src/directadmin-http.js'
import { createMcpServer } from '../src/server.js'

const location = (id = 'wp-one', filePath = 'domains/site.example/public_html') => ({
  id, host: 'site.example', filePath, webPath: '',
  wordpress: { version: '6.9', title: 'Site token=private-value', siteURL: 'https://site.example', template: 'theme', error: '' },
})
const metadata = (overrides = {}) => ({ canonicalPath: 'domains/site.example/public_html/wp-content',
  files: [{ name: 'debug.log', type: 'file', symlink: false, sizeBytes: 100 }], ...overrides })
const json = (value: unknown) => new Response(JSON.stringify(value))
const isCode = (code: string) => (error: unknown) => error instanceof HostingError && error.code === code

async function fixture() {
  const settings = await loadSettings({}, false)
  settings.accounts = {
    h101: { label: 'First', aliases: [], baseUrl: 'https://first.example:2222', usernameEnv: 'ONE_USER', loginKeyEnv: 'ONE_KEY', wordpressLogRoots: ['domains/site.example'] },
    h202: { label: 'Second', aliases: [], baseUrl: 'https://second.example:2222', usernameEnv: 'TWO_USER', loginKeyEnv: 'TWO_KEY', wordpressLogRoots: ['domains/site.example'] },
  }
  settings.credentials = { h101: { username: 'first', loginKey: 'first-secret' }, h202: { username: 'second', loginKey: 'second-secret' } }
  return settings
}

test('private WordPress log configuration rejects unsafe roots and non-log overrides', async () => {
  const settings = await fixture(), directory = await mkdtemp(join(tmpdir(), 'mcp-wp-config-'))
  const file = join(directory, 'servers.json')
  const account = settings.accounts.h101!
  try {
    for (const change of [{ wordpressLogRoots: ['../private'] }, { wordpressLogRoots: ['/home/user'] }, { wordpressLogPaths: { site: 'domains/site.example/wp-config.php' } }, { wordpressLogPaths: { site: 'domains/site.example/../private.log' } }]) {
      await writeFile(file, JSON.stringify({ servers: { sample: { ...account, ...change } } }))
      await assert.rejects(loadSettings({ MCP_CONFIG_FILE: file }, false))
    }
    await writeFile(file, JSON.stringify({ servers: { sample: account } }))
    assert.deepEqual((await loadSettings({ MCP_CONFIG_FILE: file }, false)).accounts.sample?.wordpressLogRoots, ['domains/site.example'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('subdomains require account ownership and normalize the legacy list without making writes', async () => {
  const calls: URL[] = []
  const api = new DirectAdminClient(await fixture(), async (input, init) => {
    const url = new URL(String(input)); calls.push(url)
    assert.equal(init?.method, 'GET'); assert.equal(init.redirect, 'manual')
    assert.equal(url.origin, 'https://second.example:2222')
    if (url.pathname === '/CMD_API_SHOW_DOMAINS') return new Response('list[]=site.example')
    assert.equal(url.pathname, '/CMD_API_SUBDOMAINS')
    assert.equal(url.searchParams.get('domain'), 'site.example')
    assert(!url.searchParams.has('action'))
    return new Response('list[]=shop&list[]=stage.shop&list[]=shop.site.example')
  })
  assert.deepEqual(await api.listSubdomains(202, 'SITE.EXAMPLE'), { serverId: 'h202', domain: 'site.example', subdomains: ['shop.site.example', 'stage.shop.site.example'] })
  calls.length = 0
  await assert.rejects(api.listSubdomains(202, 'foreign.example'), isCode('DOMAIN_NOT_ON_SERVER'))
  assert.equal(calls.length, 1)
})

test('subdomain empty lists, malformed replies and permission errors fail predictably', async () => {
  const settings = await fixture()
  for (const [raw, code] of [['error=1&details=private', 'ACCESS_DENIED'], ['{"error":1}', 'ACCESS_DENIED'], ['wrong=value', 'INVALID_RESPONSE'], ['list[]=../escape', 'INVALID_RESPONSE'], ['{"list":[{}]}', 'INVALID_RESPONSE']] as const) {
    const api = new DirectAdminClient(settings, async input => new Response(new URL(String(input)).pathname === '/CMD_API_SHOW_DOMAINS' ? 'list[]=site.example' : raw))
    await assert.rejects(api.listSubdomains('h101', 'site.example'), isCode(code))
  }
  const api = new DirectAdminClient(settings, async input => new Response(new URL(String(input)).pathname === '/CMD_API_SHOW_DOMAINS' ? 'list[]=site.example' : 'list[]='))
  // The legacy API uses an empty list marker for no subdomains.
  assert.deepEqual((await new DirectAdminClient(settings, async input => new Response(new URL(String(input)).pathname === '/CMD_API_SHOW_DOMAINS' ? 'list[]=site.example' : '')).listSubdomains('h101', 'site.example')).subdomains, [])
  assert.deepEqual((await api.listSubdomains('h101', 'site.example')).subdomains, [])
})

test('WordPress inventory returns installed sites only, stable pages and safe projected fields', async () => {
  const settings = await fixture()
  const api = new WordPressClient(settings, async (input, init) => {
    assert.equal(new URL(String(input)).pathname, '/api/wordpress/locations')
    assert.equal(init?.method, 'GET')
    return json([{ ...location('z'), config: { dbPass: 'never-return' } }, { ...location('empty'), wordpress: null }, location('a')])
  })
  const first = await api.listSites({ serverId: 101, limit: 1 })
  assert.equal(first.total, 2); assert.equal(first.nextOffset, 1)
  assert.equal(first.sites[0]?.siteId, 'a')
  assert.equal((await api.listSites({ serverId: 101, limit: 1, offset: 1 })).sites[0]?.siteId, 'z')
  const serialized = JSON.stringify(first)
  for (const secret of ['never-return', 'private-value', 'filePath', 'dbPass']) assert(!serialized.includes(secret))
  for (const value of [{ error: 'secret' }, [location(), location()], [{ ...location(), host: 'https://bad.example' }]]) {
    await assert.rejects(new WordPressClient(settings, async () => json(value)).listSites({ serverId: 101 }), isCode('INVALID_RESPONSE'))
  }
})

test('WordPress log reads use the selected account, fresh inventory and fixed standard log path', async () => {
  const settings = await fixture(), calls: URL[] = []
  const api = new WordPressClient(settings, async (input, init) => {
    const url = new URL(String(input)); calls.push(url)
    assert.equal(url.origin, 'https://second.example:2222'); assert.equal(init?.method, 'GET'); assert.equal(init.redirect, 'manual')
    assert.equal(new Headers(init.headers).get('Authorization'), 'Basic ' + Buffer.from('second:second-secret').toString('base64'))
    if (url.pathname === '/api/wordpress/locations') return json([location()])
    if (url.pathname === '/api/filemanager/list') {
      assert.equal(url.searchParams.get('path'), 'domains/site.example/public_html/wp-content')
      assert.equal(url.searchParams.get('limit'), '10')
      return json(metadata())
    }
    assert.equal(url.pathname, '/api/filemanager/download')
    assert.equal(url.searchParams.get('path'), 'domains/site.example/public_html/wp-content/debug.log')
    assert.equal(new Headers(init.headers).get('Range'), `bytes=-${MAX_RESPONSE_BYTES}`)
    return new Response('old\nFatal token=hidden\nignored\nFATAL second-secret\n')
  })
  const result = await api.readLog({ serverId: 202, siteId: 'wp-one', lines: 3, contains: 'fatal' })
  assert.deepEqual(result.lines, ['Fatal token=[REDACTED]', 'FATAL [REDACTED]'])
  assert.equal(result.scannedLines, 3); assert.equal(result.untrustedContent, true)
  await api.readLog({ serverId: 202, siteId: 'wp-one' })
  assert.equal(calls.filter(v => v.pathname === '/api/wordpress/locations').length, 2)
})

test('disabled logs, invalid selectors and invalid limits do not contact the provider', async () => {
  const settings = await fixture(); let calls = 0
  settings.accounts.h101!.wordpressLogRoots = []
  const api = new WordPressClient(settings, async () => { calls++; throw Error('must not run') })
  await assert.rejects(api.readLog({ serverId: 101, siteId: 'wp-one' }), isCode('WORDPRESS_LOGS_DISABLED'))
  await assert.rejects(api.readLog({ serverId: 'unknown', siteId: 'wp-one' }))
  await assert.rejects(api.readLog({ serverId: 202, siteId: 'wp-one', lines: 1001 }))
  await assert.rejects(api.listSites({ serverId: 202, limit: 101 }))
  assert.equal(calls, 0)
})

test('unknown sites, unsafe paths and paths outside root boundaries never reach filemanager', async () => {
  const settings = await fixture()
  for (const path of ['../domains/site.example', '/domains/site.example', 'domains/site.example/../private', 'domains/site.example2/public_html', 'domains/site.example/%2e%2e', 'domains/site.example\\escape', 'domains//site.example', 'node-apps/private']) {
    let calls = 0
    const api = new WordPressClient(settings, async input => {
      calls++; assert.equal(new URL(String(input)).pathname, '/api/wordpress/locations')
      return json([location('wp-one', path)])
    })
    await assert.rejects(api.readLog({ serverId: 101, siteId: 'wp-one' }), isCode('LOG_PATH_DENIED'))
    assert.equal(calls, 1)
  }
  const api = new WordPressClient(settings, async () => json([location()]))
  await assert.rejects(api.readLog({ serverId: 101, siteId: 'missing' }), isCode('UNKNOWN_SITE'))
})

test('log metadata denies symlinks, changed canonical paths, non-files and missing logs', async () => {
  const settings = await fixture()
  for (const [value, code] of [
    [metadata({ canonicalPath: '.ssh' }), 'LOG_PATH_DENIED'],
    [metadata({ files: [{ name: 'debug.log', type: 'file', symlink: true, sizeBytes: 100 }] }), 'LOG_PATH_DENIED'],
    [metadata({ files: [{ name: 'debug.log', type: 'special', symlink: false, sizeBytes: 100 }] }), 'LOG_PATH_DENIED'],
    [metadata({ files: [] }), 'LOG_NOT_FOUND'], [{ error: 'private' }, 'INVALID_RESPONSE'],
  ] as const) {
    let calls = 0
    const api = new WordPressClient(settings, async input => {
      calls++
      const path = new URL(String(input)).pathname
      assert.notEqual(path, '/api/filemanager/download')
      return path === '/api/wordpress/locations' ? json([location()]) : json(value)
    })
    await assert.rejects(api.readLog({ serverId: 101, siteId: 'wp-one' }), isCode(code))
    assert.equal(calls, 2)
  }
})

test('custom log locations are private per-site configuration and stay inside allowed roots', async () => {
  const settings = await fixture()
  settings.accounts.h101!.wordpressLogPaths = { 'wp-one': 'domains/site.example/public/content/debug.log' }
  const api = new WordPressClient(settings, async input => {
    const url = new URL(String(input))
    if (url.pathname === '/api/wordpress/locations') return json([location('wp-one', 'domains/site.example/public/wp')])
    assert.equal(url.searchParams.get('path'), 'domains/site.example/public/content')
    return json(metadata({ canonicalPath: 'domains/site.example/public/content', files: [{ name: 'debug.log', type: 'file', symlink: false, sizeBytes: 0 }] }))
  })
  assert.deepEqual((await api.readLog({ serverId: 101, siteId: 'wp-one' })).lines, [])
  for (const path of ['.ssh/private.log', 'domains/site.example2/debug.log', 'domains/site.example/wp-config.php', 'domains/site.example/../private.log']) {
    settings.accounts.h101!.wordpressLogPaths['wp-one'] = path
    await assert.rejects(api.readLog({ serverId: 101, siteId: 'wp-one' }), isCode('LOG_PATH_DENIED'))
  }
})

test('WordPress suffix ranges drop incomplete records and byte bounds preserve the latest records', async () => {
  const settings = await fixture()
  let log = 'partial-leading-record\nFatal token=private\nnewest\n'
  let headers: Record<string, string> = { 'Content-Range': `bytes 100-${99 + Buffer.byteLength(log)}/${100 + Buffer.byteLength(log)}` }
  let status = 206
  const api = new WordPressClient(settings, async input => {
    const path = new URL(String(input)).pathname
    if (path === '/api/wordpress/locations') return json([location()])
    if (path === '/api/filemanager/list') return json(metadata())
    return new Response(log, { status, headers })
  })
  const result = await api.readLog({ serverId: 101, siteId: 'wp-one' })
  assert.deepEqual(result.lines, ['Fatal token=[REDACTED]', 'newest'])
  assert(result.byteWindowLimited); assert(result.truncated)
  headers = { 'Content-Range': 'bytes 0-10/100' }
  await assert.rejects(api.readLog({ serverId: 101, siteId: 'wp-one' }), isCode('INVALID_RESPONSE'))
  headers = { 'Content-Range': 'bytes 0-10/11' }
  await assert.rejects(api.readLog({ serverId: 101, siteId: 'wp-one' }), isCode('INVALID_RESPONSE'))
  status = 200; headers = {}; log = 'x'.repeat(MAX_RESPONSE_BYTES + 1)
  await assert.rejects(api.readLog({ serverId: 101, siteId: 'wp-one' }), isCode('RESPONSE_TOO_LARGE'))
  log = Array.from({ length: 100 }, (_, i) => `${i} ${'ą'.repeat(1000)}`).join('\n')
  const bounded = await api.readLog({ serverId: 101, siteId: 'wp-one', lines: 1000 })
  assert(bounded.truncated); assert(Buffer.byteLength(bounded.lines.join('\n')) <= 64 * 1024)
  assert(bounded.lines.at(-1)?.startsWith('99 '))
})

test('WordPress download permission errors and error envelopes never appear as log records', async () => {
  const settings = await fixture()
  for (const response of [new Response('private upstream details', { status: 403 }), json({ error: 'private upstream details' }), json({ type: 'ACCESS_DENIED', message: 'private upstream details' })]) {
    const api = new WordPressClient(settings, async input => {
      const path = new URL(String(input)).pathname
      if (path === '/api/wordpress/locations') return json([location()])
      if (path === '/api/filemanager/list') return json(metadata())
      return response
    })
    await assert.rejects(api.readLog({ serverId: 101, siteId: 'wp-one' }), (error: unknown) =>
      isCode('ACCESS_DENIED')(error) && error instanceof Error && !error.message.includes('private upstream'))
  }
})

test('real MCP client discovers new tools and rejects cross-account site IDs', async () => {
  const settings = await fixture()
  const server = createMcpServer(settings, async input => {
    const url = new URL(String(input))
    if (url.pathname === '/api/wordpress/locations') return json(url.hostname.startsWith('first') ? [location()] : [])
    return json(metadata({ files: [{ name: 'debug.log', type: 'file', symlink: false, sizeBytes: 0 }] }))
  })
  const client = new Client({ name: 'wordpress-tests', version: '1' })
  const [local, remote] = InMemoryTransport.createLinkedPair()
  await server.connect(remote); await client.connect(local)
  try {
    const result = await client.callTool({ name: 'list_wordpress_sites', arguments: { serverId: 101 } })
    assert.equal(result.isError, undefined)
    const denied = await client.callTool({ name: 'read_wordpress_log', arguments: { serverId: 202, siteId: 'wp-one' } })
    assert.equal(denied.isError, true)
    assert.equal(((denied.structuredContent as Record<string, unknown>)?.error as { code: string }).code, 'UNKNOWN_SITE')
    const empty = await client.callTool({ name: 'read_wordpress_log', arguments: { serverId: 101, siteId: 'wp-one' } })
    assert.deepEqual((empty.structuredContent as Record<string, unknown>)?.lines, [])
  } finally { await client.close(); await server.close() }
})

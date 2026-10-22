import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadSettings } from '../src/config.js'
import { getServerCapabilities, TOOL_NAMES } from '../src/capabilities.js'
import { HostingError } from '../src/hosting-error.js'
import { WordPressClient } from '../src/wordpress.js'
import { createMcpServer } from '../src/server.js'
import { MAX_RESPONSE_BYTES } from '../src/directadmin-http.js'

const instance = { version: '6.9', title: 'Site token=title-private', siteURL: 'https://site.example/wp?token=url-private#private',
  template: 'sample-theme', error: 'dbPass=diagnostic-private', autoUpdateMajor: false, autoUpdateMinor: true }
const location = (id = 'wp-one') => ({ id, host: 'site.example', filePath: 'domains/site.example/public_html', webPath: '/wp', wordpress: instance })
const metadata = (sizeBytes = 100) => ({ canonicalPath: 'domains/site.example/public_html/wp-content',
  filesMatched: 1, files: [{ name: 'debug.log', type: 'file', symlink: false, sizeBytes, modifyTime: '2026-10-22T10:00:00Z' }] })
const json = (data: unknown) => new Response(JSON.stringify(data))
const hasCode = (code: string) => (error: unknown) => error instanceof HostingError && error.code === code

async function fixture() {
  const settings = await loadSettings({}, false)
  settings.accounts = {
    h101: { label: 'One', aliases: ['first'], baseUrl: 'https://first.example:2222', usernameEnv: 'FIRST_USER', loginKeyEnv: 'FIRST_KEY', wordpressLogRoots: ['domains/site.example'], backupRoots: ['private-backups'] },
    h202: { label: 'Two', aliases: [], baseUrl: 'https://second.example:2222', usernameEnv: 'SECOND_USER', loginKeyEnv: 'SECOND_KEY' },
  }
  settings.credentials = { h101: { username: 'first-user', loginKey: 'first-private-key' } }
  return settings
}

test('capabilities describe configuration without claiming provider permission or exposing private fields', async () => {
  const settings = await fixture()
  const configured = getServerCapabilities(settings, 'first')
  assert.equal(configured.serverId, 'h101'); assert.equal(configured.providerContacted, false)
  assert(configured.tools.filter(tool => tool.requiredScope === 'mcp:read').every(tool => tool.configurationReady))
  assert.equal(configured.tools.find(tool => tool.name === 'apply_hosting_change')?.configurationReady, false)
  assert.equal(configured.tools.find(tool => tool.name === 'get_wordpress_info')?.providerPermission, 'unverified')
  const missing = getServerCapabilities(settings, 202)
  assert.equal(missing.tools.find(tool => tool.name === 'get_server_capabilities')?.configurationReady, true)
  assert.deepEqual(missing.tools.find(tool => tool.name === 'get_wordpress_log_info')?.missingConfiguration, ['hosting_credentials', 'wordpress_log_roots'])
  assert.deepEqual(missing.tools.find(tool => tool.name === 'list_backup_files')?.missingConfiguration, ['hosting_credentials', 'backup_roots'])
  settings.accounts.h101!.wordpressLogRoots = []
  assert.deepEqual(getServerCapabilities(settings, 101).tools.find(tool => tool.name === 'read_wordpress_log')?.missingConfiguration, ['wordpress_log_roots'])
  assert.throws(() => getServerCapabilities(settings, 'unknown'), /Unknown or ambiguous/)
  for (const value of ['first-private-key', 'first-user', 'first.example', 'FIRST_KEY', 'domains/site.example'])
    assert(!JSON.stringify(configured).includes(value))
})

test('WordPress details refresh site ownership, encode opaque IDs and project safe metadata', async () => {
  const settings = await fixture(), calls: URL[] = [], id = 'wp id+one=1'
  const api = new WordPressClient(settings, async (input, init) => {
    const url = new URL(String(input)); calls.push(url)
    assert.equal(url.origin, 'https://first.example:2222')
    assert.equal(init?.method, 'GET'); assert.equal(init.redirect, 'manual')
    assert.equal(new Headers(init.headers).get('Authorization'), 'Basic ' + Buffer.from('first-user:first-private-key').toString('base64'))
    if (url.pathname === '/api/wordpress/locations') return json([location(id)])
    assert.equal(url.pathname, '/api/wordpress/locations/wp%20id%2Bone%3D1/wordpress')
    assert.equal(url.search, '')
    return json({ ...instance, config: { dbPass: 'config-private' }, adminPass: 'admin-private' })
  })
  const result = await api.getInfo({ serverId: 'first', siteId: id })
  assert.equal(result.siteURL, 'https://site.example/wp')
  assert.equal(result.diagnosticError, true)
  assert.deepEqual(result.autoUpdates, { major: false, minor: true })
  assert.equal(result.template, 'sample-theme'); assert.equal(result.untrustedContent, true)
  for (const value of ['title-private', 'url-private', 'diagnostic-private', 'config-private', 'admin-private', 'filePath', 'dbPass'])
    assert(!JSON.stringify(result).includes(value))
  await api.getInfo({ serverId: 101, siteId: id })
  assert.equal(calls.filter(url => url.pathname === '/api/wordpress/locations').length, 2)
})

test('WordPress details omit invalid or credentialed URLs and reject malformed flag data', async () => {
  const settings = await fixture()
  for (const siteURL of ['', 'not-a-url', 'javascript:alert(1)', 'https://user:private@site.example/']) {
    const api = new WordPressClient(settings, async input => new URL(String(input)).pathname === '/api/wordpress/locations'
      ? json([location()]) : json({ ...instance, siteURL }))
    assert.equal((await api.getInfo({ serverId: 101, siteId: 'wp-one' })).siteURL, null)
  }
  for (const details of [{ ...instance, autoUpdateMajor: 'true' }, { type: 'ACCESS_DENIED', message: 'private' }, { ...instance, title: 42 }]) {
    const api = new WordPressClient(settings, async input => new URL(String(input)).pathname === '/api/wordpress/locations'
      ? json([location()]) : json(details))
    await assert.rejects(api.getInfo({ serverId: 101, siteId: 'wp-one' }), hasCode('INVALID_RESPONSE'))
  }
})

test('WordPress details deny cross-account and absent IDs before querying the detail route', async () => {
  const settings = await fixture(); settings.credentials.h202 = { username: 'second-user', loginKey: 'second-private-key' }
  let calls = 0
  const api = new WordPressClient(settings, async input => {
    calls++
    const url = new URL(String(input))
    assert.equal(url.pathname, '/api/wordpress/locations')
    return json(url.hostname.startsWith('first') ? [location()] : [])
  })
  await assert.rejects(api.getInfo({ serverId: 202, siteId: 'wp-one' }), hasCode('UNKNOWN_SITE'))
  await assert.rejects(api.getInfo({ serverId: 101, siteId: 'missing' }), hasCode('UNKNOWN_SITE'))
  assert.equal(calls, 2)
})

test('unsafe site selectors and disabled log inspection fail before provider calls', async () => {
  const settings = await fixture(); let calls = 0
  const api = new WordPressClient(settings, async () => { calls++; throw Error('must not run') })
  for (const siteId of ['.', '..', '../config', 'wp/other', 'wp\\other', '%2e%2e', 'wp?query=private', 'wp#fragment', 'wp\u0000']) {
    await assert.rejects(api.getInfo({ serverId: 101, siteId }))
    await assert.rejects(api.getLogInfo({ serverId: 101, siteId }))
  }
  await assert.rejects(api.getLogInfo({ serverId: 202, siteId: 'wp-one' }), hasCode('WORDPRESS_LOGS_DISABLED'))
  assert.equal(calls, 0)
})

test('log inspection reports missing, empty and present snapshots without downloading content', async () => {
  const settings = await fixture()
  for (const size of [null, 0, MAX_RESPONSE_BYTES + 1]) {
    let calls = 0
    const api = new WordPressClient(settings, async input => {
      calls++
      const url = new URL(String(input))
      assert.notEqual(url.pathname, '/api/filemanager/download')
      return url.pathname === '/api/wordpress/locations' ? json([location()])
        : json(size === null ? { ...metadata(), files: [], filesMatched: 0 } : metadata(size))
    })
    const result = await api.getLogInfo({ serverId: 101, siteId: 'wp-one' })
    assert.equal(result.state, size === null ? 'missing' : size === 0 ? 'empty' : 'present')
    assert.equal(result.exists, size !== null); assert.equal(result.sizeBytes, size)
    assert.equal(result.modifiedAt, size === null ? null : '2026-10-22T10:00:00Z')
    assert.equal(result.requiresRangeForBoundedRead, size === null ? null : size > MAX_RESPONSE_BYTES)
    assert.equal(result.rangeSupport, 'unverified'); assert.equal(result.debugEnabled, 'unknown')
    assert.equal(result.contentRead, false); assert.equal(calls, 2)
    assert(!JSON.stringify(result).includes('domains/')); assert(!JSON.stringify(result).includes('filePath'))
  }
})

test('log inspection and reads share path, symlink and incomplete-list rejection', async () => {
  const settings = await fixture()
  for (const [listing, code] of [
    [{ ...metadata(), canonicalPath: '.ssh' }, 'LOG_PATH_DENIED'],
    [{ ...metadata(), files: [{ ...metadata().files[0], symlink: true }] }, 'LOG_PATH_DENIED'],
    [{ ...metadata(), files: [], filesMatched: 30 }, 'INCOMPLETE_METADATA'],
  ] as const) {
    const api = new WordPressClient(settings, async input => {
      const url = new URL(String(input))
      assert.notEqual(url.pathname, '/api/filemanager/download')
      return url.pathname === '/api/wordpress/locations' ? json([location()]) : json(listing)
    })
    await assert.rejects(api.getLogInfo({ serverId: 101, siteId: 'wp-one' }), hasCode(code))
    await assert.rejects(api.readLog({ serverId: 101, siteId: 'wp-one' }), hasCode(code))
  }
})

test('new diagnostics preserve provider permission errors without revealing raw messages', async () => {
  const settings = await fixture()
  for (const status of [403, 404, 302]) {
    const api = new WordPressClient(settings, async input => new URL(String(input)).pathname === '/api/wordpress/locations'
      ? json([location()]) : new Response('private diagnostic content', { status }))
    for (const action of [() => api.getInfo({ serverId: 101, siteId: 'wp-one' }), () => api.getLogInfo({ serverId: 101, siteId: 'wp-one' })])
      await assert.rejects(action(), (error: unknown) => error instanceof HostingError && !error.message.includes('private diagnostic'))
  }
})

test('real MCP client discovers catalog tools and calls configuration and metadata diagnostics', async () => {
  const settings = await fixture(); let calls = 0
  const server = createMcpServer(settings, async input => {
    calls++
    const path = new URL(String(input)).pathname
    if (path === '/api/wordpress/locations') return json([location()])
    if (path.endsWith('/wordpress')) return json(instance)
    assert.equal(path, '/api/filemanager/list')
    return json(metadata())
  })
  const client = new Client({ name: 'diagnostics-tests', version: '1' })
  const [local, remote] = InMemoryTransport.createLinkedPair()
  await server.connect(remote); await client.connect(local)
  try {
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [...TOOL_NAMES].sort())
    const capabilities = await client.callTool({ name: 'get_server_capabilities', arguments: { serverId: 101 } })
    assert.equal(capabilities.isError, undefined); assert.equal(calls, 0)
    const unknown = await client.callTool({ name: 'get_server_capabilities', arguments: { serverId: 'unknown' } })
    assert.equal(unknown.isError, true); assert.equal(calls, 0)
    for (const name of ['get_wordpress_info', 'get_wordpress_log_info']) {
      const result = await client.callTool({ name, arguments: { serverId: 101, siteId: 'wp-one' } })
      assert.equal(result.isError, undefined)
    }
    assert.equal(calls, 4)
  } finally { await client.close(); await server.close() }
})

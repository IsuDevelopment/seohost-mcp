import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadSettings } from '../src/config.js'
import { AccountLogClient } from '../src/account-log.js'
import { HostingError } from '../src/hosting-error.js'
import { MAX_RESPONSE_BYTES } from '../src/directadmin-http.js'
import { createMcpServer } from '../src/server.js'

const file = { name: 'log.txt', type: 'file', symlink: false, sizeBytes: 100 }
const metadata = () => ({ canonicalPath: '.', filesMatched: 1, files: [file] })
const json = (value: unknown) => new Response(JSON.stringify(value))
const code = (value: string) => (error: unknown) => error instanceof HostingError && error.code === value
async function fixture() {
  const settings = await loadSettings({}, false)
  settings.accounts = {
    h101: { label: 'One', aliases: [], baseUrl: 'https://one.example:2222', usernameEnv: 'ONE_USER', loginKeyEnv: 'ONE_KEY' },
    h202: { label: 'Two', aliases: [], baseUrl: 'https://two.example:2222', usernameEnv: 'TWO_USER', loginKeyEnv: 'TWO_KEY' },
  }
  settings.credentials = { h101: { username: 'one', loginKey: 'one-private-key' }, h202: { username: 'two', loginKey: 'two-private-key' } }
  return settings
}

test('account log reads only fixed log.txt on the selected origin, without WordPress or domain inventory', async () => {
  const settings = await fixture(), calls: URL[] = []
  const api = new AccountLogClient(settings, async (input, init) => {
    const url = new URL(String(input)); calls.push(url)
    assert.equal(url.origin, 'https://two.example:2222')
    assert.equal(init?.method, 'GET'); assert.equal(init.redirect, 'manual')
    assert.equal(new Headers(init.headers).get('Authorization'), 'Basic ' + Buffer.from('two:two-private-key').toString('base64'))
    if (url.pathname === '/api/filemanager/list') {
      assert.equal(url.searchParams.get('path'), '')
      assert.equal(url.searchParams.get('query'), 'log.txt')
      return json(metadata())
    }
    assert.equal(url.pathname, '/api/filemanager/download')
    assert.equal(url.searchParams.get('path'), 'log.txt')
    assert.equal(new Headers(init.headers).get('Range'), `bytes=-${MAX_RESPONSE_BYTES}`)
    return new Response('old\nFatal password=secret\nother\nFATAL two-private-key\n')
  })
  const result = await api.readLog({ serverId: 202, lines: 3, contains: 'fatal' })
  assert.equal(result.serverId, 'h202'); assert.equal(result.logName, 'log.txt')
  assert.equal(result.scannedLines, 3)
  assert.deepEqual(result.lines, ['Fatal password=[REDACTED]', 'FATAL [REDACTED]'])
  assert.equal(calls.length, 2)
})

test('account log rejects invalid selection/limits, missing credentials and unsafe metadata before download', async () => {
  const settings = await fixture(); let requests = 0
  const never = new AccountLogClient(settings, async () => { requests++; throw Error('must not run') })
  await assert.rejects(never.readLog({ serverId: 'unknown' }))
  await assert.rejects(never.readLog({ serverId: 101, lines: 1001 }))
  await assert.rejects(never.readLog({ serverId: 101, contains: '' }))
  delete settings.credentials.h101
  await assert.rejects(never.readLog({ serverId: 101 }), code('CREDENTIALS_MISSING'))
  assert.equal(requests, 0)
  for (const value of [
    { ...metadata(), canonicalPath: 'domains/foreign.example' },
    { ...metadata(), files: [{ ...file, symlink: true }] },
    { ...metadata(), files: [{ ...file, type: 'directory' }] },
    { ...metadata(), files: [file, file] },
  ]) {
    let calls = 0
    const api = new AccountLogClient(settings, async () => { calls++; return json(value) })
    await assert.rejects(api.readLog({ serverId: 202 }), code('LOG_PATH_DENIED'))
    assert.equal(calls, 1)
  }
})

test('account log distinguishes empty/missing/incomplete metadata and masks download error envelopes', async () => {
  const settings = await fixture()
  for (const [listing, expected] of [
    [{ canonicalPath: '.', filesMatched: 0, files: [] }, 'LOG_NOT_FOUND'],
    [{ canonicalPath: '.', filesMatched: 11, files: [] }, 'INCOMPLETE_METADATA'],
    [{ canonicalPath: '.', files: Array.from({ length: 10 }, (_, i) => ({ ...file, name: `other-${i}` })) }, 'INCOMPLETE_METADATA'],
    [{ canonicalPath: '.', files: [{ ...file, sizeBytes: -1 }] }, 'INVALID_RESPONSE'],
  ] as const) {
    await assert.rejects(new AccountLogClient(settings, async () => json(listing)).readLog({ serverId: 101 }), code(expected))
  }
  let calls = 0
  const empty = await new AccountLogClient(settings, async () => { calls++; return json({ ...metadata(), files: [{ ...file, sizeBytes: 0 }] }) }).readLog({ serverId: 101 })
  assert.equal(calls, 1); assert.deepEqual(empty.lines, [])
  const denied = new AccountLogClient(settings, async input => new URL(String(input)).pathname.endsWith('/list')
    ? json(metadata()) : json({ type: 'ACCESS_DENIED', message: 'private-provider-error' }))
  await assert.rejects(denied.readLog({ serverId: 101 }), error => code('ACCESS_DENIED')(error) && !(error as Error).message.includes('private-provider-error'))
})

test('account log keeps the bounded suffix, rejects oversized downloads and caps output', async () => {
  const settings = await fixture()
  let download = new Response('partial\nold\nnew\n', { status: 206, headers: { 'Content-Range': 'bytes 100-115/116' } })
  const api = new AccountLogClient(settings, async input => new URL(String(input)).pathname.endsWith('/list') ? json(metadata()) : download)
  const suffix = await api.readLog({ serverId: 101 })
  assert.deepEqual(suffix.lines, ['old', 'new']); assert.equal(suffix.byteWindowLimited, true)
  download = new Response('x'.repeat(MAX_RESPONSE_BYTES + 1))
  await assert.rejects(api.readLog({ serverId: 101 }), code('RESPONSE_TOO_LARGE'))
  download = new Response(Array.from({ length: 100 }, (_, i) => `${i} ${'a'.repeat(1000)}`).join('\n'))
  const capped = await api.readLog({ serverId: 101, lines: 1000 })
  assert(capped.truncated); assert(Buffer.byteLength(capped.lines.join('\n')) <= 64 * 1024)
  assert(capped.lines.at(-1)?.startsWith('99 '))
})

test('real MCP client discovers account log tool and reads it with no WordPress prerequisite', async () => {
  const settings = await fixture()
  const server = createMcpServer(settings, async input => new URL(String(input)).pathname.endsWith('/list')
    ? json(metadata()) : new Response('token=private-token\none-private-key\n'))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'account-log-test', version: '1' })
  await server.connect(serverTransport); await client.connect(clientTransport)
  try {
    assert((await client.listTools()).tools.some(tool => tool.name === 'read_account_log'))
    const result = await client.callTool({ name: 'read_account_log', arguments: { serverId: 'h101', lines: 5 } })
    assert(!result.isError)
    assert.equal((result.structuredContent as Record<string, unknown>)?.returnedLines, 2)
    assert(!JSON.stringify(result).includes('private-token'))
    assert(!JSON.stringify(result).includes('one-private-key'))
  } finally { await client.close(); await server.close() }
})

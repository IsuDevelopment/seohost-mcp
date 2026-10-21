import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadSettings, resolveServer, validateServerAliases } from '../src/config.js'
import { DirectAdminClient, HostingError, redactLog } from '../src/directadmin.js'
import { createMcpServer } from '../src/server.js'

async function fixture() {
  const settings = await loadSettings({}, false)
  settings.accounts = {
    h101: { label: 'First account', baseUrl: 'https://first.example:2222', usernameEnv: 'FIRST_USER', loginKeyEnv: 'FIRST_KEY', aliases: ['main'] },
    h202: { label: 'Second account', baseUrl: 'https://second.example:2222', usernameEnv: 'SECOND_USER', loginKeyEnv: 'SECOND_KEY', aliases: [] },
  }
  settings.credentials = { h101: { username: 'first-user', loginKey: 'first-secret-key' }, h202: { username: 'second-user', loginKey: 'second-secret-key' } }
  return settings
}

test('aliases resolve deterministically; ambiguous and unknown accounts are rejected', async () => {
  const { accounts } = await fixture()
  for (const reference of [101, '101', 'h101', 'H101', 'serwer 101', 'server 101', 'main'])
    assert.equal(resolveServer(accounts, reference).serverId, 'h101')
  assert.equal(resolveServer(accounts, '202').serverId, 'h202')
  assert.throws(() => resolveServer(accounts, '58'), /Unknown or ambiguous/)
  accounts.h202!.aliases = ['101']
  assert.throws(() => validateServerAliases(accounts), /Ambiguous/)
  assert.throws(() => resolveServer(accounts, '101'), /Unknown or ambiguous/)
})

test('log reads use only the selected origin and credentials and verify domain ownership first', async () => {
  const settings = await fixture(), calls: URL[] = []
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url)
    assert.equal(url.origin, 'https://second.example:2222')
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'manual')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Basic ' + Buffer.from('second-user:second-secret-key').toString('base64'))
    if (url.pathname === '/CMD_API_SHOW_DOMAINS') return new Response('list[]=site.example&list[]=other.example')
    assert.equal(url.pathname, '/CMD_SHOW_LOG'); assert.equal(url.searchParams.get('type'), 'log')
    assert.equal(url.searchParams.get('lines'), '3')
    return new Response('old line\nGET /?token=hidden HTTP/1.1 500\nnew line second-secret-key\nlast 500\n')
  }
  const result = await new DirectAdminClient(settings, request).readWebLog({ serverId: 202, domain: 'SITE.EXAMPLE', logType: 'access', lines: 3, contains: '500' })
  assert.equal(result.serverId, 'h202'); assert.equal(result.scannedLines, 3)
  assert.deepEqual(result.lines, ['GET /?token=[REDACTED] HTTP/1.1 500', 'last 500'])
  assert.equal(calls.length, 2)
  calls.length = 0
  await assert.rejects(new DirectAdminClient(settings, request).readWebLog({ serverId: 202, domain: 'foreign.example', logType: 'error' }), (e: unknown) => e instanceof HostingError && e.code === 'DOMAIN_NOT_ON_SERVER')
  assert.equal(calls.length, 1)
})

test('missing credentials, invalid selection, path injection and invalid line counts cause no requests', async () => {
  const settings = await fixture(); let calls = 0
  const api = new DirectAdminClient(settings, async () => { calls++; throw Error('must not run') })
  delete settings.credentials.h101
  await assert.rejects(api.listDomains('h101'), (e: unknown) => e instanceof HostingError && e.code === 'CREDENTIALS_MISSING')
  await assert.rejects(api.listDomains('unknown'))
  for (const domain of ['https://site.example', '../site.example', 'site.example?domain=other.example', 'site.example:2222'])
    await assert.rejects(api.readWebLog({ serverId: 'h202', domain, logType: 'access' }))
  await assert.rejects(api.readWebLog({ serverId: 'h202', domain: 'site.example', logType: 'access', lines: 1001 }))
  assert.equal(calls, 0)
})

test('upstream denial, redirect, legacy errors, malformed lists and streaming byte limits fail closed', async () => {
  const settings = await fixture()
  for (const response of [new Response('secret', { status: 401 }), new Response('', { status: 302, headers: { Location: 'https://elsewhere.example' } }), new Response('error=1&details=secret'), new Response('<html>Login</html>'), new Response('{"unexpected":true}'), new Response('x'.repeat(512 * 1024 + 1))]) {
    await assert.rejects(new DirectAdminClient(settings, async () => response).listDomains('h101'), (e: unknown) => e instanceof HostingError && !e.message.includes('secret'))
  }
  const throwing: typeof fetch = async () => { throw new Error('network secret') }
  await assert.rejects(new DirectAdminClient(settings, throwing).listDomains('h101'), (e: unknown) => e instanceof HostingError && !e.message.includes('network secret'))
})

test('access/error mapping, empty logs, latest complete records and output byte limits', async () => {
  const settings = await fixture(); let log = ''
  const api = new DirectAdminClient(settings, async input => {
    const url = new URL(String(input))
    if (url.pathname === '/CMD_API_SHOW_DOMAINS') return new Response('list[]=site.example')
    assert.equal(url.searchParams.get('type'), 'error')
    return new Response(log)
  })
  const read = () => api.readWebLog({ serverId: 'h101', domain: 'site.example', logType: 'error', lines: 1000 })
  assert.deepEqual((await read()).lines, [])
  log = Array.from({length: 100}, (_, i) => `${i} ${'ą'.repeat(1000)}`).join('\n')
  const result = await read()
  assert(result.truncated); assert(Buffer.byteLength(result.lines.join('\n')) <= 64 * 1024)
  assert(result.lines.at(-1)?.startsWith('99 '))
})

test('common credentials and all query values are redacted, including referrers', () => {
  const raw = 'GET /?code=abc&state=def HTTP/1.1 "https://site.example/?email=private@example.com" Bearer abc123\npassword=abc\nCookie: session=abc\nhttps://user:pass@site.example/\n%3Ftoken%3Dhidden%26page%3D2'
  const output = redactLog(raw)
  for (const secret of ['abc', 'def', 'private@example.com', 'session=abc', 'user:pass', 'hidden']) assert(!output.includes(secret))
  assert(output.includes('[REDACTED]'))
})

test('structured WordPress logs redact JSON, PHP arrays and WordPress credential constants', () => {
  const raw = `{"password":"json-private","dbPass":"database-private","client_secret":"client-private"}\n[password] => multi word private value\nDB_PASSWORD='env-private'\n'AUTH_KEY' => 'auth-private'\n"SECURE_AUTH_SALT": "salt-private"\n{"token":"escaped\\\"private"}`
  const output = redactLog(raw)
  for (const secret of ['json-private', 'database-private', 'client-private', 'multi word private value', 'env-private', 'auth-private', 'salt-private', 'escaped', 'private'])
    assert(!output.includes(secret), secret)
  assert.equal(redactLog('Fatal undefined variable in application.php on line 42'), 'Fatal undefined variable in application.php on line 42')
})

test('real MCP client discovers and calls read tools; concurrent server choices remain isolated', async () => {
  const settings = await fixture()
  const server = createMcpServer(settings, async input => {
    const url = new URL(String(input))
    if (url.pathname === '/CMD_API_SHOW_DOMAINS') return new Response('list[]=site.example')
    return new Response(url.host + '\n')
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'hosting-tests', version: '1' })
  await server.connect(serverTransport); await client.connect(clientTransport)
  try {
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['get_server_info', 'list_domains', 'list_servers', 'list_subdomains', 'list_wordpress_sites', 'read_web_log', 'read_wordpress_log', 'resolve_server'])
    const values = await Promise.all([101,202].map(serverId => client.callTool({ name: 'read_web_log', arguments: {serverId, domain: 'site.example', logType: 'access'} })))
    assert.deepEqual(values.map(r => (r.structuredContent as Record<string,unknown>)?.serverId), ['h101','h202'])
    assert.deepEqual(values.map(r => (r.structuredContent as Record<string,unknown>)?.lines), [['first.example:2222'],['second.example:2222']])
    const error = await client.callTool({name:'list_domains', arguments:{serverId:'unknown'}})
    assert.equal(error.isError,true)
    assert(!JSON.stringify(values).includes('secret-key'))
  } finally { await client.close(); await server.close() }
})

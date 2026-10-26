import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { request as httpRequest } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { loadSettings } from '../src/config.js'
import { createHttpServer } from '../src/http.js'

const token = 'test-token-with-at-least-32-characters'
async function fixture() {
  const settings = await loadSettings({ MCP_AUTH_TOKEN: token, PORT: '0' })
  const server = createHttpServer(settings)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  settings.publicUrl.port = String(address.port)
  settings.allowedOrigins = new Set([settings.publicUrl.origin])
  return { settings, server, url: settings.publicUrl }
}

test('HTTP refuses startup without authentication or with incomplete OAuth', async () => {
  await assert.rejects(loadSettings({}), /Configure MCP_AUTH_TOKEN/)
  await assert.rejects(loadSettings({ MCP_AUTH_TOKEN: 'short' }), /32 characters/)
  await assert.rejects(loadSettings({ MCP_OAUTH_ISSUER: 'https://issuer.example' }), /OAuth requires/)
  await assert.rejects(loadSettings({ MCP_AUTH_TOKEN: token, MCP_PUBLIC_URL: 'http://public.example/mcp' }), /HTTPS/)
  await assert.rejects(loadSettings({ MCP_LOCAL_OAUTH: 'true' }), /Local OAuth requires/)
  assert.equal((await loadSettings({}, false)).authToken, undefined)
})

test('HTTP authentication, host/origin checks, method restrictions and body limit', async () => {
  const { server, url } = await fixture()
  try {
    assert.equal((await fetch(new URL('/healthz', url))).status, 200)
    const unauthorized = await fetch(url)
    assert.equal(unauthorized.status, 401)
    assert.match(unauthorized.headers.get('www-authenticate') || '', /Bearer/)
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer wrong' } })).status, 401)
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' } })).status, 403)
    assert.equal(await new Promise(resolve => { const req = httpRequest(url, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode) }); req.end() }), 403)
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status, 405)
    assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ huge: 'x'.repeat(140000) }) })).status, 413)
    assert.equal((await fetch(new URL('/api/mcp/oauth-protected-resource', url))).status, 503)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('real MCP HTTP client initializes, lists tools and calls both infrastructure tools', async () => {
  const { server, url } = await fixture()
  const client = new Client({ name: 'integration-test', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const tools = await client.listTools()
    assert.deepEqual(tools.tools.map(t => t.name).sort(), ['apply_hosting_change', 'apply_wordpress_stage', 'check_dns', 'continue_wordpress_stage_install', 'export_database', 'get_account_usage', 'get_database_info', 'get_domain_info', 'get_hosting_change', 'get_resource_usage', 'get_server_capabilities', 'get_server_info', 'get_tls_info', 'get_wordpress_info', 'get_wordpress_log_info', 'get_wordpress_stage', 'list_backup_files', 'list_databases', 'list_dns_records', 'list_domains', 'list_redirects', 'list_servers', 'list_subdomains', 'list_wordpress_sites', 'plan_hosting_change', 'plan_wordpress_stage', 'plan_wordpress_stage_recovery', 'read_account_log', 'read_web_log', 'read_wordpress_log', 'resolve_server', 'summarize_web_log'])
    const info = await client.callTool({ name: 'get_server_info', arguments: {} })
    assert.deepEqual(info.structuredContent, { name: 'seohost-mcp', version: '0.17.0', stage: 'hosting-domain-dns-tls', hostingOperationsEnabled: true, hostingWritesEnabled: false })
    const servers = await client.callTool({ name: 'list_servers', arguments: {} })
    assert.deepEqual(servers.structuredContent, { servers: [{ serverId: 'primary', label: 'Primary hosting', aliases: ['hosting-main'], credentialsConfigured: false }, { serverId: 'secondary', label: 'Secondary hosting', aliases: ['hosting-backup'], credentialsConfigured: false }] })
    assert(!JSON.stringify(servers).includes('LOGIN_KEY'))
    assert(!JSON.stringify(servers).includes('baseUrl'))
  } finally { await client.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('stdio works with no HTTP token and no hosting credentials', async () => {
  const client = new Client({ name: 'stdio-test', version: '1' })
  const args = import.meta.url.endsWith('.js') ? [fileURLToPath(new URL('../src/stdio.js', import.meta.url))] : ['--import', 'tsx', 'src/stdio.ts']
  const transport = new StdioClientTransport({ command: process.execPath, args, env: { PATH: process.env.PATH || '' }, stderr: 'pipe' })
  try {
    await client.connect(transport)
    assert.equal((await client.listTools()).tools.length, 32)
    assert.equal((await client.callTool({ name: 'get_server_info', arguments: {} })).isError, undefined)
  } finally { await client.close() }
})

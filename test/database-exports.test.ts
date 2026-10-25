import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readdir, readFile, writeFile, chmod, stat, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadSettings } from '../src/config.js'
import { DatabaseExports, MAX_EXPORT_BYTES } from '../src/database-exports.js'
import { HostingError } from '../src/hosting-error.js'
import { getServerCapabilities } from '../src/capabilities.js'
import { createHttpServer } from '../src/http.js'

const token = 'export-read-token-with-at-least-32-characters'
const access = { actor: 'owner', canWrite: false }
const code = (expected: string) => (error: unknown) => error instanceof HostingError && error.code === expected
const json = (value: unknown) => new Response(JSON.stringify(value))
const sql = '-- MariaDB dump\nCREATE TABLE wp_options (secret text);\n-- private-sql-content\n'
const compressed = gzipSync(sql)
const db = { database: 'account_wp', sizeBytes: 1000, tableCount: 12, userCount: 1, definerIssues: 0,
  defaultCharset: 'utf8mb4', defaultCollation: 'utf8mb4_unicode_ci', eventCount: 0, routineCount: 0, triggerCount: 0, viewCount: 0 }

async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'mcp-exports-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const settings = await loadSettings({ MCP_AUTH_TOKEN: token, MCP_DATABASE_EXPORT_DIRECTORY: directory }, false)
  settings.accounts = {
    first: { label: 'First', aliases: ['one'], baseUrl: 'https://first.example:2222', usernameEnv: 'USER', loginKeyEnv: 'KEY', databaseExports: true },
    second: { label: 'Second', aliases: [], baseUrl: 'https://second.example:2222', usernameEnv: 'USER2', loginKeyEnv: 'KEY2', databaseExports: true },
  }
  settings.credentials = { first: { username: 'account', loginKey: 'private-login-key' }, second: { username: 'second', loginKey: 'private-second-key' } }
  const state = { calls: [] as URL[], dbHost: 'localhost', dbName: 'account_wp', knownSite: true,
    inventory: [db], exportResponse: () => new Response(new Uint8Array(compressed), { headers: { 'Content-Type': 'application/x-gzip' } }) }
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); state.calls.push(url)
    assert.equal(init?.method, 'GET'); assert.equal(init.redirect, 'manual')
    const credentials = url.hostname === 'first.example' ? 'account:private-login-key' : 'second:private-second-key'
    assert.equal(new Headers(init.headers).get('Authorization'), 'Basic ' + Buffer.from(credentials).toString('base64'))
    if (url.pathname === '/api/wordpress/locations') return json(url.hostname === 'first.example' && state.knownSite ? [{
      id: 'wp-one', host: 'site.example', webPath: '/', filePath: 'domains/site.example/public_html',
      wordpress: { version: '6.9', title: 'Site', siteURL: 'https://site.example/', template: 'theme', error: '' },
    }] : [])
    if (url.pathname === '/api/wordpress/locations/wp-one/config')
      return json({ dbName: state.dbName, dbHost: state.dbHost, dbPass: 'private-db-password', dbUser: 'private-db-user', dbPrefix: 'wp_' })
    if (url.pathname === '/api/db-show/databases') return json(url.hostname === 'first.example' ? state.inventory : [])
    if (url.pathname === '/api/db-show/databases/account_wp') return json(db)
    assert.equal(url.pathname, '/api/db-manage/databases/account_wp/export')
    assert.equal(url.search, '?gzip=true')
    assert.equal(new Headers(init.headers).get('Accept-Encoding'), 'identity')
    return state.exportResponse()
  }
  return { settings, directory, state, request, exports: new DatabaseExports(settings, request) }
}

test('database export maps fresh site ownership to a local owned database and stores only private gzip/metadata', async t => {
  const f = await fixture(t)
  const value = await f.exports.create({ serverId: 'one', siteId: 'wp-one' }, access)
  assert.equal(value.serverId, 'first'); assert.equal(value.database, 'account_wp'); assert.equal(value.scope, 'entire_database')
  assert.equal(value.sizeBytes, compressed.length)
  assert.equal(value.sha256, createHash('sha256').update(compressed).digest('hex'))
  assert(!('localPath' in value)); assert(!JSON.stringify(value).includes('private-'))
  assert.equal(f.state.calls.length, 5)
  const stored = join(f.directory, value.exportId)
  assert.deepEqual((await readdir(stored)).sort(), ['export.sql.gz', 'manifest.json'])
  for (const path of [f.directory, stored, join(stored, 'export.sql.gz'), join(stored, 'manifest.json')])
    assert.equal((await stat(path)).mode & 0o077, 0)
  assert.equal(gunzipSync(await readFile(join(stored, 'export.sql.gz'))).toString(), sql)
  assert(!String(await readFile(join(stored, 'manifest.json'))).includes('private-'))
  // Artifact survives a new adapter instance (stateless requests / process restarts).
  const artifact = await new DatabaseExports(f.settings).download(value.exportId, access)
  try { assert.equal((await artifact.file.readFile()).length, compressed.length) } finally { await artifact.file.close() }
})

test('explicit database selection bypasses WordPress config and stdio returns a local path', async t => {
  const f = await fixture(t)
  const value = await f.exports.create({ serverId: 'first', database: 'account_wp' }, { actor: 'stdio-owner', canWrite: true })
  assert.equal(f.state.calls.length, 3)
  assert(!f.state.calls.some(url => url.pathname.includes('wordpress')))
  assert.equal(value.localPath, join(f.directory, value.exportId, 'export.sql.gz'))
})

test('exports fail closed for disabled configuration, invalid selection, foreign sites/databases and remote DB hosts', async t => {
  const f = await fixture(t)
  f.settings.accounts.first!.databaseExports = false
  await assert.rejects(f.exports.create({ serverId: 'first', database: 'account_wp' }, access), code('EXPORTS_DISABLED'))
  f.settings.accounts.first!.databaseExports = true
  f.settings.databaseExportDirectory = undefined
  await assert.rejects(f.exports.create({ serverId: 'first', database: 'account_wp' }, access), code('EXPORTS_DISABLED'))
  f.settings.databaseExportDirectory = f.directory
  for (const input of [{}, { siteId: 'wp-one', database: 'account_wp' }, { database: '../account_wp' }, { siteId: '../wp-one' }])
    await assert.rejects(f.exports.create({ serverId: 'first', ...input }, access))
  assert.equal(f.state.calls.length, 0)
  await assert.rejects(f.exports.create({ serverId: 'second', siteId: 'wp-one' }, access), code('UNKNOWN_SITE'))
  await assert.rejects(f.exports.create({ serverId: 'second', database: 'account_wp' }, access), code('DATABASE_NOT_ON_SERVER'))
  f.state.dbHost = 'remote.example'
  await assert.rejects(f.exports.create({ serverId: 'first', siteId: 'wp-one' }, access), code('DATABASE_HOST_UNVERIFIED'))
  f.state.dbHost = 'localhost'; f.state.dbName = 'foreign_wp'
  await assert.rejects(f.exports.create({ serverId: 'first', siteId: 'wp-one' }, access), code('DATABASE_NOT_ON_SERVER'))
  assert(!f.state.calls.some(url => url.pathname.endsWith('/export')))
  assert.deepEqual(await readdir(f.directory), [])
})

test('provider failures, fake success, corrupt/truncated streams and both byte limits never leave an artifact', async t => {
  const f = await fixture(t)
  const candidates = [
    () => new Response('private-provider-error', { status: 403 }),
    () => new Response('private-provider-error', { status: 302, headers: { Location: 'https://evil.example' } }),
    () => json({ error: 'private-provider-error' }),
    () => new Response('<html>private</html>', { headers: { 'Content-Type': 'application/x-gzip' } }),
    () => new Response(new Uint8Array(compressed.subarray(0, -4)), { headers: { 'Content-Type': 'application/x-gzip' } }),
    () => new Response(new Uint8Array(compressed), { headers: { 'Content-Type': 'application/x-gzip', 'Content-Length': String(compressed.length + 1) } }),
    () => new Response('x', { headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(MAX_EXPORT_BYTES + 1) } }),
    () => new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < 101; i++) controller.enqueue(new Uint8Array(1024 * 1024))
      controller.close()
    } }), { headers: { 'Content-Type': 'application/gzip' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('private-network-error')) } }),
      { headers: { 'Content-Type': 'application/gzip' } }),
    () => new Response(new Uint8Array(Buffer.concat(Array.from({ length: 1025 }, () => gzipSync(Buffer.alloc(1024 * 1024))))),
      { headers: { 'Content-Type': 'application/gzip' } }),
  ]
  for (const candidate of candidates) {
    f.state.exportResponse = candidate
    await assert.rejects(f.exports.create({ serverId: 'first', database: 'account_wp' }, access),
      (error: unknown) => error instanceof HostingError && !error.message.includes('private-'))
    assert.deepEqual(await readdir(f.directory), [])
  }
})

test('private artifact access is actor bound, revocable and expires; symlinks and public storage are refused', async t => {
  const f = await fixture(t)
  const value = await f.exports.create({ serverId: 'first', database: 'account_wp' }, access)
  await assert.rejects(f.exports.download(value.exportId, { actor: 'other', canWrite: true }), code('EXPORT_NOT_FOUND'))
  f.settings.accounts.first!.databaseExports = false
  await assert.rejects(f.exports.download(value.exportId, access), code('EXPORT_NOT_FOUND'))
  f.settings.accounts.first!.databaseExports = true
  const artifact = join(f.directory, value.exportId, 'export.sql.gz')
  await unlink(artifact); await symlink(join(f.directory, value.exportId, 'manifest.json'), artifact)
  await assert.rejects(f.exports.download(value.exportId, access), code('EXPORT_NOT_FOUND'))
  const manifest = join(f.directory, value.exportId, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ ...JSON.parse(await readFile(manifest, 'utf8')), expiresAt: Date.now() - 1 }))
  await assert.rejects(f.exports.download(value.exportId, access), code('EXPORT_NOT_FOUND'))
  assert.deepEqual(await readdir(f.directory), [])
  await chmod(f.directory, 0o755)
  await assert.rejects(f.exports.create({ serverId: 'first', database: 'account_wp' }, access), code('EXPORT_STORAGE_UNSAFE'))
  await chmod(f.directory, 0o700)
  const link = join(f.directory, 'link'); await symlink(f.directory, link)
  f.settings.databaseExportDirectory = link
  await assert.rejects(f.exports.create({ serverId: 'first', database: 'account_wp' }, access), code('EXPORT_STORAGE_UNSAFE'))
})

test('retained export quota prunes expired artifacts and concurrent requests share a directory lock', async t => {
  const f = await fixture(t)
  const first = f.exports.create({ serverId: 'first', database: 'account_wp' }, access)
  // Both operations pass asynchronous root validation before acquiring the shared lock.
  const second = new DatabaseExports(f.settings, f.request).create({ serverId: 'first', database: 'account_wp' }, access)
  const results = await Promise.allSettled([first, second])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const failed = results.find(result => result.status === 'rejected')
  assert(failed?.status === 'rejected' && code('EXPORT_BUSY')(failed.reason))
  for (let i = 1; i < 10; i++) await f.exports.create({ serverId: 'first', database: 'account_wp' }, access)
  await assert.rejects(f.exports.create({ serverId: 'first', database: 'account_wp' }, access), code('EXPORT_STORAGE_FULL'))
  const id = (await readdir(f.directory))[0]!, manifest = join(f.directory, id, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ ...JSON.parse(await readFile(manifest, 'utf8')), expiresAt: Date.now() - 1 }))
  await f.exports.create({ serverId: 'first', database: 'account_wp' }, access)
  assert.equal((await readdir(f.directory)).length, 10)
})

test('capability readiness describes export opt-ins without a provider probe', async t => {
  const f = await fixture(t)
  assert.equal(getServerCapabilities(f.settings, 'first').tools.find(tool => tool.name === 'export_database')?.configurationReady, true)
  f.settings.databaseExportDirectory = undefined; f.settings.accounts.first!.databaseExports = false
  assert.deepEqual(getServerCapabilities(f.settings, 'first').tools.find(tool => tool.name === 'export_database')?.missingConfiguration,
    ['account_database_exports', 'database_export_directory'])
  assert.equal(f.state.calls.length, 0)
})

test('real MCP HTTP export and authenticated binary download enforce actor, host, origin and method checks', async t => {
  const f = await fixture(t)
  f.settings.writeAuthToken = 'other-write-token-with-at-least-32-characters'
  const server = createHttpServer(f.settings, f.request)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert(address && typeof address !== 'string')
  f.settings.publicUrl.port = String(address.port)
  f.settings.allowedOrigins = new Set([f.settings.publicUrl.origin])
  const client = new Client({ name: 'export-test', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(f.settings.publicUrl, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const invalid = await client.callTool({ name: 'export_database', arguments: { serverId: 'first' } })
    assert.equal(invalid.isError, true); assert.equal(f.state.calls.length, 0)
    const exported = await client.callTool({ name: 'export_database', arguments: { serverId: 'first', siteId: 'wp-one' } })
    assert.equal(exported.isError, undefined)
    assert(!JSON.stringify(exported).includes('private-')); assert(!JSON.stringify(exported).includes(f.directory))
    const artifact = exported.structuredContent as Record<string, unknown> | undefined
    const url = String(artifact?.downloadUrl), headers = { Authorization: `Bearer ${token}` }
    assert.equal((await fetch(url)).status, 401)
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${f.settings.writeAuthToken}` } })).status, 404)
    assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403)
    assert.equal((await fetch(url, { method: 'POST', headers })).status, 405)
    const downloaded = await fetch(url, { headers })
    assert.equal(downloaded.status, 200)
    assert.equal(downloaded.headers.get('cache-control'), 'no-store')
    assert.match(downloaded.headers.get('content-disposition')!, /^attachment;/)
    assert.equal(gunzipSync(Buffer.from(await downloaded.arrayBuffer())).toString(), sql)
    const output = join(f.directory, 'downloaded.sql.gz')
    const command = fileURLToPath(new URL('../scripts/download-database.mjs', import.meta.url))
    const args = [command, '--server', 'first', '--site', 'wp-one', '--output', output]
    const env = { PATH: process.env.PATH, MCP_AUTH_TOKEN: token, MCP_PUBLIC_URL: f.settings.publicUrl.href }
    const saved = await promisify(execFile)(process.execPath, args, { env })
    assert.match(saved.stdout, /SHA-256 verified/)
    assert(!saved.stdout.includes('private-'))
    assert.equal(gunzipSync(await readFile(output)).toString(), sql)
    assert.equal((await stat(output)).mode & 0o077, 0)
    const before = f.state.calls.length
    await assert.rejects(promisify(execFile)(process.execPath, args, { env }))
    assert.equal(f.state.calls.length, before)
    assert.equal(gunzipSync(await readFile(output)).toString(), sql)
  } finally { await client.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('an export waits for in-flight housekeeping instead of returning a false busy error', async t => {
  const f = await fixture(t)
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const cleaning = new Promise<void>(resolve => { started = resolve })
  const original = f.exports['prune'].bind(f.exports)
  f.exports['prune'] = async root => { started(); await gate; return original(root) }
  const cleanup = f.exports.cleanup()
  await cleaning
  const contender = new DatabaseExports(f.settings, f.request)
  // Cleanup already validated this canonical root. Resolve it immediately here
  // so acquisition runs before setImmediate regardless of filesystem latency.
  contender['root'] = async () => f.directory
  const releaseHandle = setImmediate(release)
  try {
    const value = await contender.create({ serverId: 'first', database: 'account_wp' }, access)
    assert.equal(value.database, 'account_wp')
    assert.equal(value.scope, 'entire_database')
  } finally { clearImmediate(releaseHandle); release(); await cleanup }
})

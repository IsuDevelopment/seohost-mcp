import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { loadSettings } from '../src/config.js'
import { createHttpServer } from '../src/http.js'
import { createLocalOAuth, isCodexLoopbackRedirect } from '../src/local-oauth.js'

const callback = 'http://127.0.0.1:54705/callback/abcdefghijkl'
const native = { redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }

async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const dir = await mkdtemp(tmpdir() + '/seohost-desktop-oauth-')
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = (reservation.address() as { port: number }).port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  const salt = randomBytes(16).toString('hex'), password = randomBytes(24).toString('hex')
  const settings = await loadSettings({ MCP_AUTH_TOKEN: 'x'.repeat(32) })
  settings.publicUrl = new URL(`http://127.0.0.1:${port}/mcp`)
  settings.allowedOrigins = new Set([settings.publicUrl.origin])
  settings.localOAuth = { file: dir + '/oauth.sqlite', username: 'owner', passwordHash: salt + ':' + scryptSync(password, salt, 64).toString('hex'),
    redirects: ['https://client.example/callback'], allowWrites: true, allowCodexLoopback: true }
  const app = createHttpServer(settings)
  await new Promise<void>(resolve => app.listen(port, '127.0.0.1', resolve))
  t.after(async () => { app.closeAllConnections(); await new Promise<void>(resolve => app.close(() => resolve())); await rm(dir, { recursive: true, force: true }) })
  const base = settings.publicUrl.origin
  const register = (body: unknown) => fetch(base + '/oauth/register', { method: 'POST', body: JSON.stringify(body) })
  const post = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body), redirect: 'manual',
  })
  const refresh = (token: string, client: string, extra: Record<string, string> = {}) => post('/oauth/token',
    { grant_type: 'refresh_token', refresh_token: token, client_id: client, ...extra })
  const state = () => {
    const db = new DatabaseSync(settings.localOAuth!.file)
    try { return JSON.parse((db.prepare('SELECT value FROM oauth_state WHERE id=1').get() as { value: string }).value) }
    finally { db.close() }
  }
  const issue = async (scope = 'mcp:read', metadata = native) => {
    const registration = await register(metadata)
    assert.equal(registration.status, 201)
    const client = await registration.json() as { client_id: string }
    const verifier = randomBytes(32).toString('base64url')
    const params = { client_id: client.client_id, redirect_uri: metadata.redirect_uris[0]!, resource: settings.publicUrl.href,
      scope, response_type: 'code', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), state: 'original-state' }
    // A registered callback remains EXACT even though enrollment allows ephemeral ports/nonces.
    assert.equal((await fetch(base + '/oauth/authorize?' + new URLSearchParams({ ...params, redirect_uri: callback.replace('54705', '54706') }))).status, 400)
    const page = await fetch(base + '/oauth/authorize?' + new URLSearchParams(params))
    assert.equal(page.status, 200)
    const cookie = page.headers.get('set-cookie')!.split(';')[0]!, html = await page.text()
    const ticket = html.match(/name="ticket" value="([^"]+)"/)![1]!
    const consent = await post('/oauth/consent', { ticket, username: 'owner', password, decision: 'allow' }, { Origin: base, Cookie: cookie })
    assert.equal(consent.status, 303)
    const target = new URL(consent.headers.get('location')!)
    assert.equal(target.origin + target.pathname, metadata.redirect_uris[0])
    assert.equal(target.searchParams.get('state'), 'original-state'); assert.equal(target.searchParams.get('iss'), base)
    const exchange = { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: metadata.redirect_uris[0]!,
      resource: settings.publicUrl.href, code: target.searchParams.get('code')!, code_verifier: verifier }
    assert.equal((await post('/oauth/token', { ...exchange, redirect_uri: callback.replace('54705', '54706') })).status, 400)
    const token = await post('/oauth/token', exchange)
    assert.equal(token.status, 200)
    return { ...await token.json() as { access_token: string; refresh_token?: string; scope: string }, client: client.client_id }
  }
  return { settings, app, base, register, post, refresh, issue, state, dir }
}

test('native Codex callback policy accepts only bounded literal loopback ports/nonces', () => {
  for (const value of [callback, 'http://[::1]:1/callback/abcdefghijkl']) assert.equal(isCodexLoopbackRedirect(value), true)
  for (const value of ['http://localhost:1234/callback/abcdefghijkl', 'http://127.0.0.2:1234/callback/abcdefghijkl',
    'http://127.0.0.1.evil.example:1234/callback/abcdefghijkl', 'http://2130706433:1234/callback/abcdefghijkl',
    'http://127.0.0.1:0/callback/abcdefghijkl', 'http://127.0.0.1:65536/callback/abcdefghijkl',
    'http://127.0.0.1:0123/callback/abcdefghijkl', callback + '?next=https://evil.example', callback + '#fragment',
    callback.replace('/callback/', '/other/'), callback.replace('abcdefghijkl', '%61bcdefghijkl'),
    callback.replace('abcdefghijkl', 'short'), callback.replace('abcdefghijkl', 'a'.repeat(129)),
    callback.replace('127.0.0.1', 'user:password@127.0.0.1'), callback + '\n']) assert.equal(isCodexLoopbackRedirect(value), false, value)
})

test('native-only owner configuration is opt-in and never broadens the exact HTTPS callback list', async () => {
  const env = { MCP_LOCAL_OAUTH: 'true', MCP_OWNER_USERNAME: 'owner', MCP_OWNER_PASSWORD_HASH: 'a'.repeat(32) + ':' + 'b'.repeat(128) }
  await assert.rejects(loadSettings(env), /Local OAuth requires/)
  const settings = await loadSettings({ ...env, MCP_OAUTH_CODEX_LOOPBACK: 'true' })
  assert.equal(settings.localOAuth?.allowCodexLoopback, true)
  assert.deepEqual(settings.localOAuth?.redirects, [])
  await assert.rejects(loadSettings({ ...env, MCP_OAUTH_CODEX_LOOPBACK: 'yes' }), /must be true or false/)
  await assert.rejects(loadSettings({ ...env, MCP_OAUTH_CODEX_LOOPBACK: 'true', MCP_OAUTH_REDIRECT_URIS: callback }), /must use HTTPS/)
})

test('desktop DCR requires explicit callback opt-in and validates supported grant sets, without advertising unsupported grants', async t => {
  const f = await fixture(t)
  const discovery = await (await fetch(f.base + '/.well-known/oauth-authorization-server')).json() as { grant_types_supported: string[] }
  assert.deepEqual(discovery.grant_types_supported, ['authorization_code', 'refresh_token'])
  f.settings.localOAuth!.allowCodexLoopback = false
  assert.equal((await f.register(native)).status, 400)
  f.settings.localOAuth!.allowCodexLoopback = true
  const reversed = await f.register({ ...native, grant_types: ['refresh_token', 'authorization_code'] })
  assert.equal(reversed.status, 201)
  assert.deepEqual((await reversed.json() as { grant_types: string[] }).grant_types, ['authorization_code', 'refresh_token'])
  for (const grants of [[], null, false, 'authorization_code', ['refresh_token'], ['authorization_code', 'implicit'], ['authorization_code', 'authorization_code']])
    assert.equal((await f.register({ ...native, grant_types: grants })).status, 400)
  for (const bad of [{ token_endpoint_auth_method: null }, { response_types: null }, { scope: false }, { scope: 'openid' },
    { redirect_uris: [callback, 'https://evil.example/callback'] }]) assert.equal((await f.register({ ...native, ...bad })).status, 400)
  assert.equal((await f.register({ redirect_uris: ['https://client.example/callback'] })).status, 201)
})

test('native code/PKCE flow reaches login, rotates hashed refresh tokens across instances and detects replay', async t => {
  const f = await fixture(t), issued = await f.issue('mcp:read mcp:write')
  assert(issued.refresh_token)
  const initial = Object.values(f.state().refreshTokens)[0] as { expires: number }
  assert.equal((await f.refresh(issued.refresh_token, 'another-client')).status, 400)
  assert.equal((await f.refresh(issued.refresh_token, issued.client, { resource: 'https://evil.example/mcp' })).status, 400)
  const rotated = await f.refresh(issued.refresh_token, issued.client)
  assert.equal(rotated.status, 200)
  const next = await rotated.json() as { access_token: string; refresh_token: string; scope: string }
  assert.notEqual(next.refresh_token, issued.refresh_token); assert.equal(next.scope, issued.scope)
  for (const value of Object.values(f.state().refreshTokens) as { expires: number }[]) assert.equal(value.expires, initial.expires)
  const peer = createLocalOAuth(f.settings.localOAuth!, f.settings.publicUrl)
  try {
    assert.equal(peer.verify(issued.access_token), true); assert.equal(peer.verify(next.access_token), true)
    const raw = JSON.stringify(f.state())
    for (const secret of [issued.access_token, issued.refresh_token, next.access_token, next.refresh_token]) assert(!raw.includes(secret))
    assert.equal((await f.refresh(issued.refresh_token, issued.client)).status, 400)
    assert.equal(peer.verify(issued.access_token), false); assert.equal(peer.verify(next.access_token), false)
    assert.equal((await f.refresh(next.refresh_token, issued.client)).status, 400)
  } finally { peer.close() }
})

test('refresh cannot escalate scope and can downscope permanently; revocation invalidates the token family', async t => {
  const f = await fixture(t), issued = await f.issue()
  assert(issued.refresh_token)
  assert.equal((await f.refresh(issued.refresh_token, issued.client, { scope: 'mcp:read mcp:write' })).status, 400)
  const valid = await f.refresh(issued.refresh_token, issued.client, { scope: 'mcp:read' })
  assert.equal(valid.status, 200)
  const next = await valid.json() as { access_token: string; refresh_token: string; scope: string }
  assert.equal(next.scope, 'mcp:read')
  const peer = createLocalOAuth(f.settings.localOAuth!, f.settings.publicUrl)
  try {
    assert.equal(peer.authorize(next.access_token)?.canWrite, false)
    assert.equal((await f.post('/oauth/revoke', { token: next.access_token })).status, 200)
    assert.equal(peer.verify(issued.access_token), false)
    assert.equal((await f.refresh(next.refresh_token, issued.client)).status, 400)
  } finally { peer.close() }
  const write = await f.issue('mcp:read mcp:write')
  const read = await f.refresh(write.refresh_token!, write.client, { scope: 'mcp:read' })
  const narrowed = await read.json() as { refresh_token: string }
  assert.equal((await f.refresh(narrowed.refresh_token, write.client, { scope: 'mcp:read mcp:write' })).status, 400)
  assert.equal((await f.post('/oauth/revoke', { token: narrowed.refresh_token })).status, 200)
  const writable = await f.issue('mcp:read mcp:write')
  f.settings.localOAuth!.allowWrites = false
  const downgraded = await f.refresh(writable.refresh_token!, writable.client)
  assert.equal(downgraded.status, 200)
  assert.equal((await downgraded.json() as { scope: string }).scope, 'mcp:read')
})

test('expired refresh grants fail and code-only clients retain legacy token behavior', async t => {
  const f = await fixture(t), issued = await f.issue()
  const db = new DatabaseSync(f.settings.localOAuth!.file)
  try {
    const value = f.state()
    for (const token of Object.values(value.refreshTokens) as { expires: number }[]) token.expires = Date.now() - 1
    db.prepare('UPDATE oauth_state SET value=? WHERE id=1').run(JSON.stringify(value))
  } finally { db.close() }
  assert.equal((await f.refresh(issued.refresh_token!, issued.client)).status, 400)
  const codeOnly = await f.issue('mcp:read', { ...native, grant_types: ['authorization_code'] })
  assert.equal(codeOnly.refresh_token, undefined)
  assert.equal((await f.post('/oauth/token', { grant_type: 'client_credentials' })).status, 400)
  const raw = await readFile(f.settings.localOAuth!.file)
  assert(!raw.includes(Buffer.from(issued.refresh_token!)))
})

test('concurrent refresh reuse revokes the winning response token family', async t => {
  const f = await fixture(t), issued = await f.issue()
  const attempts = await Promise.all([f.refresh(issued.refresh_token!, issued.client), f.refresh(issued.refresh_token!, issued.client)])
  assert.deepEqual(attempts.map(response => response.status).sort(), [200, 400])
  const winner = await attempts.find(response => response.status === 200)!.json() as { access_token: string; refresh_token: string }
  assert.equal((await fetch(f.base + '/mcp', { headers: { Authorization: 'Bearer ' + winner.access_token } })).status, 401)
  assert.equal((await f.refresh(winner.refresh_token, issued.client)).status, 400)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadSettings, writeOperations } from '../src/config.js'
import { RedirectsClient } from '../src/redirects.js'
import { HostingChanges, changeInputSchema } from '../src/hosting-changes.js'
import { HostingError } from '../src/hosting-error.js'
import { createMcpServer } from '../src/server.js'

const access = { actor: 'redirect-owner', canWrite: true }
const code = (value: string) => (error: unknown) => error instanceof HostingError && error.code === value
const json = (value: unknown) => new Response(JSON.stringify(value))
async function fixture() {
  const dir = await mkdtemp(tmpdir() + '/redirects-'), settings = await loadSettings({}, false)
  settings.changeStateFile = dir + '/changes.sqlite'
  settings.accounts = { primary: { label: 'Hosting', aliases: [], baseUrl: 'https://hosting.example:2222', usernameEnv: 'USER', loginKeyEnv: 'KEY', writeOperations: [...writeOperations] },
    other: { label: 'Other', aliases: [], baseUrl: 'https://other.example:2222', usernameEnv: 'OTHER_USER', loginKeyEnv: 'OTHER_KEY', writeOperations: [...writeOperations] } }
  settings.credentials = { primary: { username: 'account', loginKey: 'private-key' } }
  const state = { rules: [{ from: '/', to: 'https://target.example', type: 302 }], writes: [] as URLSearchParams[],
    calls: 0, raw: undefined as string | undefined, uncertain: false, dropResponse: false, noEffect: false }
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); state.calls++
    assert.equal(url.origin, 'https://hosting.example:2222')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Basic ' + Buffer.from('account:private-key').toString('base64'))
    assert.equal(init?.redirect, 'manual')
    if (url.pathname === '/CMD_API_SHOW_DOMAINS') { assert.equal(init?.method, 'GET'); return new Response('list[]=site.example') }
    assert.equal(url.pathname, '/CMD_API_REDIRECT')
    if (init?.method === 'POST') {
      const params = new URLSearchParams(String(init.body)); state.writes.push(params)
      assert.equal(params.get('domain'), 'site.example')
      if (!state.noEffect) {
        if (params.get('action') === 'delete') {
          assert.equal(params.get('select0'), '/')
          state.rules = state.rules.filter(rule => rule.from !== params.get('select0'))
        } else {
          assert.equal(params.get('action'), 'add')
          assert(!state.rules.some(rule => rule.from === params.get('from')), 'must not assume provider overwrite')
          state.rules.push({ from: params.get('from')!, to: params.get('to')!, type: Number(params.get('type')) })
        }
      }
      if (state.uncertain) throw Error('private provider timeout')
      if (state.dropResponse) return new Response('secret diagnostic', { status: 302, headers: { location: 'https://target.example/' } })
      return json({ error: '0' })
    }
    assert.equal(init?.method, 'GET'); assert.equal(url.searchParams.get('apitype'), 'yes')
    assert.equal(url.searchParams.get('domain'), 'site.example')
    return new Response(state.raw ?? new URLSearchParams(state.rules.map(rule => [rule.from,
      new URLSearchParams({ to: rule.to, type: String(rule.type) }).toString()])).toString())
  }
  return { settings, request, state, redirects: new RedirectsClient(settings, request), changes: new HostingChanges(settings, request),
    close: () => rm(dir, { recursive: true, force: true }) }
}

test('redirect list decodes typed API inventory, binds opaque IDs and never follows destinations', async () => {
  const f = await fixture()
  try {
    const result = await f.redirects.list('primary', 'site.example')
    assert.equal(result.redirects.length, 1); assert.equal(result.redirects[0]?.type, 302)
    assert.equal(result.redirects[0]?.destination, 'https://target.example/'); assert.equal(result.liveHttpVerified, false)
    assert.match(result.redirects[0]!.redirectId, /^[a-f0-9]{64}$/)
    await assert.rejects(f.redirects.list('primary', 'foreign.example'), code('DOMAIN_NOT_ON_SERVER'))
    assert.equal(f.state.writes.length, 0)
    f.state.rules = []
    assert.deepEqual((await f.redirects.list('primary', 'site.example')).redirects, [])
  } finally { await f.close() }
})

test('provider destinations redact credentials/query/fragment and are not persisted in deletion previews', async () => {
  const f = await fixture()
  try {
    f.state.rules[0]!.to = 'https://private-user:private-password@target.example/path?token=private-token#private-fragment'
    const result = await f.redirects.list('primary', 'site.example')
    assert.equal(result.redirects[0]?.destination, 'https://target.example/path')
    assert.equal(result.redirects[0]?.destinationRedacted, true)
    const plan = await f.changes.plan('primary', { operation: 'delete_redirect', domain: 'site.example', redirectId: result.redirects[0]!.redirectId }, access)
    const stored = await readFile(f.settings.changeStateFile!)
    for (const value of ['private-password', 'private-token', 'private-fragment', 'private-user']) {
      assert(!JSON.stringify(plan).includes(value)); assert(!stored.includes(Buffer.from(value)))
    }
  } finally { await f.close() }
})

test('malformed, ambiguous, untyped and application-error inventories fail closed', async () => {
  const f = await fixture()
  try {
    for (const raw of ['error=1&text=secret-provider-error', '{}', '/=https%3A%2F%2Ftarget.example', '/=to%3Dx%26type%3Dfoo',
      '/=to%3Dx%26type%3D302%26type%3D301', '/=to%3Dx%26type%3D302&/=to%3Dy%26type%3D301',
      'not-a-path=to%3Dx%26type%3D302']) {
      f.state.raw = raw
      await assert.rejects(f.redirects.list('primary', 'site.example'), code('INVALID_RESPONSE'))
    }
  } finally { await f.close() }
})

test('redirect changes require exact write policy and same actor/account; read callers never contact provider', async () => {
  const f = await fixture()
  try {
    const input = { operation: 'add_redirect', domain: 'site.example', from: '/old', to: 'https://target.example/new', type: 301 }
    await assert.rejects(f.changes.plan('primary', input, { ...access, canWrite: false }), code('WRITE_SCOPE_REQUIRED'))
    f.settings.accounts.primary!.writeOperations = ['delete_redirect']
    await assert.rejects(f.changes.plan('primary', input, access), code('WRITE_DISABLED'))
    assert.equal(f.state.calls, 0)
    f.settings.accounts.primary!.writeOperations = ['add_redirect']
    const plan = await f.changes.plan('primary', input, access)
    await assert.rejects(f.changes.apply('primary', plan.planId, plan.previewHash, { actor: 'other', canWrite: true }), code('PLAN_NOT_FOUND'))
    await assert.rejects(f.changes.apply('other', plan.planId, plan.previewHash, access), code('PLAN_NOT_FOUND'))
    f.settings.accounts.primary!.writeOperations = []
    await assert.rejects(f.changes.apply('primary', plan.planId, plan.previewHash, access), code('WRITE_DISABLED'))
    assert.equal(f.state.writes.length, 0)
  } finally { await f.close() }
})

test('documented delete/add editing changes exact rule, preserves unrelated entries and replays receipts', async () => {
  const f = await fixture()
  try {
    f.state.rules.push({ from: '/keep', to: 'https://keep.example/path?key=private-value', type: 303 })
    const rules = (await f.redirects.list('primary', 'site.example')).redirects
    await assert.rejects(f.changes.plan('primary', { operation: 'add_redirect', domain: 'site.example', from: '/', to: 'https://new.example', type: 301 }, access), code('ALREADY_EXISTS'))
    const remove = await f.changes.plan('primary', { operation: 'delete_redirect', domain: 'site.example', redirectId: rules.find(r => r.from === '/')!.redirectId }, access)
    const deleted = await f.changes.apply('primary', remove.planId, remove.previewHash, access)
    assert.equal(deleted.providerStateVerified, true); assert.equal(f.state.rules.length, 1)
    const add = await f.changes.plan('primary', { operation: 'add_redirect', domain: 'site.example', from: '/', to: 'https://new.example', type: 301 }, access)
    assert(add.warnings.some(w => w.includes('precedence')))
    const added = await f.changes.apply('primary', add.planId, add.previewHash, access)
    assert.deepEqual(await new HostingChanges(f.settings, f.request).apply('primary', add.planId, add.previewHash, access), added)
    assert.equal(f.state.writes.length, 2)
    assert.equal(f.state.rules.find(r => r.from === '/')?.type, 301)
    assert.equal(f.state.rules.find(r => r.from === '/keep')?.to, 'https://keep.example/path?key=private-value')
    await assert.rejects(f.changes.plan('primary', { operation: 'delete_redirect', domain: 'site.example', redirectId: rules.find(r => r.from === '/')!.redirectId }, access), code('REDIRECT_NOT_FOUND'))
  } finally { await f.close() }
})

test('redirect writes reject directive injection, unsafe URLs, unsupported status and direct self loops', async () => {
  const f = await fixture()
  try {
    const base = { operation: 'add_redirect', domain: 'site.example', from: '/old', to: 'https://target.example/new', type: 302 }
    for (const patch of [{ from: '/x\nRewriteRule' }, { from: '/x y' }, { from: '/%0a' }, { from: '/x/../y' }, { from: '//target.example' }, { from: '/(.*)' },
      { to: 'javascript:alert(1)' }, { to: '//target.example' }, { to: 'https://u:p@target.example' }, { to: 'https://target.example/?x=1' },
      { to: 'https://target.example/#frag' }, { to: 'https://target.example:2222/' }, { to: 'https://127.0.0.1/' }, { to: 'https://target.example/%0d%0aHeader' },
      { type: 307 }, { type: 308 }, { type: undefined }]) assert(!changeInputSchema.safeParse({ ...base, ...patch }).success)
    await assert.rejects(f.changes.plan('primary', { ...base, to: 'https://site.example/old/again' }, access), code('REDIRECT_LOOP'))
    await assert.rejects(f.changes.plan('primary', { ...base, to: 'https://www.site.example/old' }, access), code('REDIRECT_LOOP'))
    assert.equal(f.state.writes.length, 0)
  } finally { await f.close() }
})

test('stale redirect inventory and selection abort before POST; unknown writes lock without resend and reconcile by full state', async () => {
  const f = await fixture()
  try {
    const input = { operation: 'add_redirect', domain: 'site.example', from: '/old', to: 'https://target.example/new', type: 303 }
    const stale = await f.changes.plan('primary', input, access)
    f.state.rules.push({ from: '/external', to: 'https://changed.example', type: 302 })
    await assert.rejects(f.changes.apply('primary', stale.planId, stale.previewHash, access), code('STALE_PLAN'))
    assert.equal(f.state.writes.length, 0)
    const plan = await f.changes.plan('primary', input, access); f.state.uncertain = true
    await assert.rejects(f.changes.apply('primary', plan.planId, plan.previewHash, access), code('WRITE_OUTCOME_UNKNOWN'))
    await assert.rejects(f.changes.apply('primary', plan.planId, plan.previewHash, access), code('PLAN_NOT_READY'))
    const reconciled = await f.changes.get('primary', plan.planId, access, true)
    assert.equal(reconciled.status, 'applied'); assert.equal(reconciled.result?.originalWriteConfirmation, 'unknown')
    assert.equal(f.state.writes.length, 1)
  } finally { await f.close() }
})

test('false success or provider redirect response remains uncertain and cannot trigger another POST', async () => {
  for (const mode of ['noEffect', 'dropResponse'] as const) {
    const f = await fixture()
    try {
      f.state[mode] = true
      const plan = await f.changes.plan('primary', { operation: 'add_redirect', domain: 'site.example', from: '/old', to: 'https://target.example/new', type: 301 }, access)
      await assert.rejects(f.changes.apply('primary', plan.planId, plan.previewHash, access), code('WRITE_OUTCOME_UNKNOWN'))
      await assert.rejects(f.changes.apply('primary', plan.planId, plan.previewHash, access), code('PLAN_NOT_READY'))
      assert.equal(f.state.writes.length, 1)
    } finally { await f.close() }
  }
})

test('real MCP client discovers redirects and reads safe inventory without any write', async () => {
  const f = await fixture(), server = createMcpServer(f.settings, f.request)
  const client = new Client({ name: 'redirect-test', version: '1' }), [a, b] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(a); await client.connect(b)
    const result = await client.callTool({ name: 'list_redirects', arguments: { serverId: 'primary', domain: 'site.example' } })
    assert.equal(result.isError, undefined)
    assert.equal((result.structuredContent as { redirects: unknown[] }).redirects.length, 1)
    assert.equal(f.state.writes.length, 0)
  } finally { await client.close(); await server.close(); await f.close() }
})

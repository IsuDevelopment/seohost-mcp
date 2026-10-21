import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { loadSettings, writeOperations } from '../src/config.js'
import { HostingChanges } from '../src/hosting-changes.js'
import { DomainDnsClient } from '../src/domain-dns.js'
import { createAuthenticator } from '../src/auth.js'
import { HostingError } from '../src/hosting-error.js'
import type { IncomingMessage } from 'node:http'

const access = { actor: 'owner-client', canWrite: true }
const code = (expected: string) => (error: unknown) => error instanceof HostingError && error.code === expected
const json = (value: unknown) => new Response(JSON.stringify(value))
async function fixture() {
  const dir = await mkdtemp(tmpdir() + '/hosting-changes-')
  const settings = await loadSettings({}, false)
  settings.changeStateFile = dir + '/changes.sqlite'
  settings.accounts = { primary: { label: 'Hosting', aliases: [], baseUrl: 'https://hosting.example:2222', usernameEnv: 'USER', loginKeyEnv: 'KEY',
    writeOperations: [...writeOperations], dnsNameservers: ['ns1.hosting.example', 'ns2.hosting.example'] } }
  settings.credentials = { primary: { username: 'account', loginKey: 'private-key' } }
  const state = { domains: ['site.example'], subdomains: [] as string[], records: [
    { type: 'A', name: 'site.example.', value: '192.0.2.1', ttl: '300' },
    { type: 'NS', name: 'site.example.', value: 'ns1.hosting.example.', ttl: '300' },
  ], posts: [] as { path: string; params: URLSearchParams }[], provider: 'hosting', uncertain: false, gate: undefined as Promise<void> | undefined }
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.hostname === 'dns.google') {
      assert(!new Headers(init?.headers).has('Authorization'))
      return json({ Status: 0, Answer: Number(url.searchParams.get('type')) === 2
        ? (state.provider === 'hosting' ? ['ns1.hosting.example.', 'ns2.hosting.example.'] : ['one.ns.cloudflare.com.'])
          .map(value => ({ name: url.searchParams.get('name'), type: 2, TTL: 60, data: value })) : [] })
    }
    assert.equal(url.origin, 'https://hosting.example:2222'); assert.equal(init?.redirect, 'manual')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Basic ' + Buffer.from('account:private-key').toString('base64'))
    if (init?.method === 'POST') {
      const params = new URLSearchParams(String(init.body)); state.posts.push({ path: url.pathname, params })
      if (state.gate) await state.gate
      if (url.pathname === '/CMD_API_DOMAIN') state.domains.push(params.get('domain')!)
      else if (url.pathname === '/CMD_API_SUBDOMAINS') state.subdomains.push(params.get('subdomain')!)
      else if (url.pathname === '/CMD_API_DNS_CONTROL') {
        const selector = [...params.keys()].find(key => key.endsWith('recs0'))
        if (selector) {
          const old = new URLSearchParams(params.get(selector)!)
          state.records = state.records.filter(record => !(record.name === old.get('name') && record.value === old.get('value')))
        }
        if (params.get('action') !== 'select') state.records.push({ type: params.get('type')!, name: params.get('name')!, value: params.get('value')!, ttl: params.get('ttl') || '300' })
      } else assert.fail('Unexpected mutation path')
      if (state.uncertain) throw Error('private-provider-timeout')
      return json({ error: '0' })
    }
    assert.equal(init?.method, 'GET')
    if (url.pathname === '/CMD_API_SHOW_DOMAINS') return new Response(new URLSearchParams(state.domains.map(domain => ['list[]', domain])).toString())
    if (url.pathname === '/CMD_API_SUBDOMAINS') return new Response(state.subdomains.length ? new URLSearchParams(state.subdomains.map(label => ['list[]', label])).toString() : '')
    if (url.pathname === '/CMD_API_DNS_CONTROL') return json({ records: state.records, dns_ttl: 'yes' })
    assert.fail('Unexpected read path')
  }
  return { settings, request, state, manager: new HostingChanges(settings, request), dns: new DomainDnsClient(settings, request),
    close: () => rm(dir, { recursive: true, force: true }) }
}

test('write authorization and account allowlists fail before provider I/O; separate Bearer tokens do not escalate reads', async () => {
  const f = await fixture()
  try {
    let calls = 0
    const changes = new HostingChanges(f.settings, async () => { calls++; throw Error('must not run') })
    const input = { operation: 'create_domain', domain: 'new.example' }
    await assert.rejects(changes.plan('primary', input, { ...access, canWrite: false }), code('WRITE_SCOPE_REQUIRED'))
    f.settings.accounts.primary!.writeOperations = []
    await assert.rejects(changes.plan('primary', input, access), code('WRITE_DISABLED'))
    assert.equal(calls, 0)
    const settings = await loadSettings({ MCP_AUTH_TOKEN: 'r'.repeat(32), MCP_WRITE_AUTH_TOKEN: 'w'.repeat(32) })
    const authenticate = createAuthenticator(settings)
    const request = (token: string) => ({ headers: { authorization: 'Bearer ' + token } }) as IncomingMessage
    assert.equal((await authenticate(request('r'.repeat(32))))?.canWrite, false)
    assert.equal((await authenticate(request('w'.repeat(32))))?.canWrite, true)
    await assert.rejects(loadSettings({ MCP_AUTH_TOKEN: 'r'.repeat(32), MCP_WRITE_AUTH_TOKEN: 'r'.repeat(32) }))
  } finally { await f.close() }
})

test('previews are actor/account bound, expiring and fingerprinted; domain apply is verified and replayed without another POST', async () => {
  const f = await fixture()
  try {
    const plan = await f.manager.plan('primary', { operation: 'create_domain', domain: 'new.example' }, access)
    assert.equal(f.state.posts.length, 0); assert.equal(plan.applied, false)
    await assert.rejects(f.manager.get('primary', plan.planId, { actor: 'other', canWrite: true }), code('PLAN_NOT_FOUND'))
    await assert.rejects(f.manager.apply('primary', plan.planId, '0'.repeat(64), access), code('PREVIEW_MISMATCH'))
    const applied = await f.manager.apply('primary', plan.planId, plan.previewHash, access)
    assert.equal(applied.providerStateVerified, true)
    const nextRequest = new HostingChanges(f.settings, f.request)
    assert.deepEqual(await nextRequest.apply('primary', plan.planId, plan.previewHash, access), applied)
    assert.equal(f.state.posts.length, 1)
    assert.equal(f.state.posts[0]?.params.get('uquota'), 'unlimited')
    assert.equal(f.state.posts[0]?.params.get('cgi'), 'OFF')
    const expired = await f.manager.plan('primary', { operation: 'create_domain', domain: 'expired.example' }, access)
    const db = new DatabaseSync(f.settings.changeStateFile!)
    const row = db.prepare('SELECT value FROM changes WHERE id=?').get(expired.planId) as { value: string }
    const saved = JSON.parse(row.value); saved.expires = 0
    db.prepare('UPDATE changes SET value=? WHERE id=?').run(JSON.stringify(saved), expired.planId); db.close()
    await assert.rejects(f.manager.apply('primary', expired.planId, expired.previewHash, access), code('PLAN_EXPIRED'))
    assert.equal(f.state.posts.length, 1)
  } finally { await f.close() }
})

test('subdomain creation verifies parent ownership, duplicates and final account inventory', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.manager.plan('primary', { operation: 'create_subdomain', domain: 'foreign.example', label: 'stage' }, access), code('DOMAIN_NOT_ON_SERVER'))
    const change = { operation: 'create_subdomain', domain: 'site.example', label: 'stage' }
    const plan = await f.manager.plan('primary', change, access)
    assert.equal((await f.manager.apply('primary', plan.planId, plan.previewHash, access)).providerStateVerified, true)
    await assert.rejects(f.manager.plan('primary', change, access), code('ALREADY_EXISTS'))
    assert.equal(f.state.posts[0]?.params.get('subdomain'), 'stage')
    assert.equal(f.state.posts.length, 1)
  } finally { await f.close() }
})

test('single-record DNS add/edit/delete preserves unrelated records and uses exact encoded selectors', async () => {
  const f = await fixture()
  try {
    const added = await f.manager.plan('primary', { operation: 'add_dns_record', domain: 'site.example', record: { type: 'TXT', name: '_verify', value: 'verification-value', ttl: 300 } }, access)
    await f.manager.apply('primary', added.planId, added.previewHash, access)
    const txt = (await f.dns.listRecords('primary', 'site.example')).records.find(record => record.type === 'TXT')!
    const edited = await f.manager.plan('primary', { operation: 'update_dns_record', domain: 'site.example', recordId: txt.id,
      record: { type: 'TXT', name: '_verify', value: 'new-value', ttl: 300 } }, access)
    await f.manager.apply('primary', edited.planId, edited.previewHash, access)
    assert.equal(f.state.posts[1]?.params.get('action'), 'edit')
    assert.equal(new URLSearchParams(f.state.posts[1]!.params.get('txtrecs0')!).get('value'), '"verification-value"')
    const current = (await f.dns.listRecords('primary', 'site.example')).records.find(record => record.type === 'TXT')!
    const deleted = await f.manager.plan('primary', { operation: 'delete_dns_record', domain: 'site.example', recordId: current.id }, access)
    await f.manager.apply('primary', deleted.planId, deleted.previewHash, access)
    assert.equal(f.state.posts[2]?.params.get('action'), 'select')
    assert.deepEqual(f.state.records.map(record => record.type), ['A', 'NS'])
  } finally { await f.close() }
})

test('stale plans and changed/failed DNS authority abort before sending a POST', async () => {
  const f = await fixture()
  try {
    const change = { operation: 'add_dns_record', domain: 'site.example', record: { type: 'A', name: 'api', value: '192.0.2.3', ttl: 300 } }
    const stale = await f.manager.plan('primary', change, access)
    f.state.records.push({ type: 'TXT', name: 'unrelated', value: '"changed"', ttl: '300' })
    await assert.rejects(f.manager.apply('primary', stale.planId, stale.previewHash, access), code('STALE_PLAN'))
    const redirected = await f.manager.plan('primary', change, access)
    f.state.provider = 'cloudflare'
    await assert.rejects(f.manager.apply('primary', redirected.planId, redirected.previewHash, access), code('DNS_AUTHORITY_UNVERIFIED'))
    await assert.rejects(f.manager.plan('primary', change, access), code('DNS_AUTHORITY_UNVERIFIED'))
    assert.equal(f.state.posts.length, 0)
  } finally { await f.close() }
})

test('DNS validation rejects IP/type mismatch, CNAME coexistence, unsupported record writes and overlong TXT', async () => {
  const f = await fixture()
  try {
    for (const record of [{ type: 'A', name: 'api', value: '::1' }, { type: 'CNAME', name: '@', value: 'target.example.' },
      { type: 'TXT', name: '_verify', value: 'x'.repeat(256) }, { type: 'A', name: 'outside.example.', value: '192.0.2.1' }]) {
      await assert.rejects(f.manager.plan('primary', { operation: 'add_dns_record', domain: 'site.example', record }, access))
    }
    const ns = (await f.dns.listRecords('primary', 'site.example')).records.find(record => record.type === 'NS')!
    await assert.rejects(f.manager.plan('primary', { operation: 'delete_dns_record', domain: 'site.example', recordId: ns.id }, access), code('UNSUPPORTED_RECORD_WRITE'))
    f.state.records.push({ type: 'CNAME', name: 'alias', value: 'target.example.', ttl: '300' })
    await assert.rejects(f.manager.plan('primary', { operation: 'add_dns_record', domain: 'site.example', record: { type: 'TXT', name: 'alias', value: 'value' } }, access), code('DNS_CONFLICT'))
    assert.equal(f.state.posts.length, 0)
  } finally { await f.close() }
})

test('uncertain writes persist a blocking receipt across MCP instances and are never resent', async () => {
  const f = await fixture()
  try {
    const plan = await f.manager.plan('primary', { operation: 'create_domain', domain: 'uncertain.example' }, access)
    f.state.uncertain = true
    await assert.rejects(f.manager.apply('primary', plan.planId, plan.previewHash, access), code('WRITE_OUTCOME_UNKNOWN'))
    const next = new HostingChanges(f.settings, f.request)
    assert.equal((await next.get('primary', plan.planId, access)).status, 'unknown')
    await assert.rejects(next.apply('primary', plan.planId, plan.previewHash, access), code('PLAN_NOT_READY'))
    const other = await next.plan('primary', { operation: 'create_domain', domain: 'other.example' }, access)
    await assert.rejects(next.apply('primary', other.planId, other.previewHash, access), code('CHANGE_BUSY'))
    assert.equal(f.state.posts.length, 1)
    const reconciled = await next.get('primary', plan.planId, access, true)
    assert.equal(reconciled.status, 'applied')
    assert.equal(reconciled.result?.originalWriteConfirmation, 'unknown')
    assert.equal(f.state.posts.length, 1, 'reconciliation must never send another write')
  } finally { await f.close() }
})

test('simultaneous apply requests reserve the account before awaiting provider I/O', async () => {
  const f = await fixture()
  try {
    const one = await f.manager.plan('primary', { operation: 'create_domain', domain: 'one.example' }, access)
    const two = await f.manager.plan('primary', { operation: 'create_domain', domain: 'two.example' }, access)
    const pending = f.manager.apply('primary', one.planId, one.previewHash, access)
    await assert.rejects(new HostingChanges(f.settings, f.request).apply('primary', two.planId, two.previewHash, access), code('CHANGE_BUSY'))
    await pending
    assert.equal(f.state.posts.length, 1)
  } finally { await f.close() }
})

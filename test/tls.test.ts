import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadSettings, writeOperations } from '../src/config.js'
import { TlsClient } from '../src/tls.js'
import { HostingChanges, changeInputSchema } from '../src/hosting-changes.js'
import { HostingError } from '../src/hosting-error.js'
import { createMcpServer } from '../src/server.js'

const access = { actor: 'tls-owner', canWrite: true }
const code = (value: string) => (error: unknown) => error instanceof HostingError && error.code === value
const json = (value: unknown) => new Response(JSON.stringify(value))
async function fixture() {
  const dir = await mkdtemp(tmpdir() + '/tls-')
  const settings = await loadSettings({}, false)
  settings.changeStateFile = dir + '/changes.sqlite'
  settings.accounts = { primary: { label: 'Hosting', aliases: [], baseUrl: 'https://hosting.example:2222', usernameEnv: 'USER', loginKeyEnv: 'KEY', writeOperations: [...writeOperations] } }
  settings.credentials = { primary: { username: 'account', loginKey: 'private-key' } }
  const state = { acme: { enabled: false, provider: 'letsencrypt', keyType: 'ec256', preferWildcard: true,
    externalAccountKeyID: 'secret-never-eab-id', externalAccountHMAC: 'secret-never-eab-hmac',
    dnsProvider: 'cloudflare', dnsEnvironment: { CLOUDFLARE_DNS_API_TOKEN: 'secret-never-return-or-persist' }, skipDNSNames: ['testing.site.example'] },
    subdomains: ['stage'], forceHttps: false, ssl: true, hsts: false, suspended: false,
    certs: { certIds: ['certificate-id'], missingDNSNames: [] as string[], certs: [{ id: 'certificate-id', autorenewEnabled: true, validationError: '',
      certificate: { dnsNames: ['site.example', '*.site.example', '*.stage.site.example'],
        notBefore: new Date(Date.now() - 86400000).toISOString(), notAfter: new Date(Date.now() + 86400000).toISOString(),
        issuer: 'safe issuer', privateKey: 'do-not-project-additional-fields' } }] },
    writes: [] as { method: string; path: string; body: string }[], calls: [] as string[], uncertain: false, badStatus: 0, invalid: false,
    previewCalls: 0, previewOverride: undefined as unknown, provisionStatus: 0, provisionMode: 'success',
    dryRun: { acmeEnabled: true, acmeInProgress: false, ratelimitReached: false,
      certsPending: [{ certID: 'certificate-id', challengeType: 'http-01', dnsNames: ['site.example','www.site.example'] }],
      certsFulfilled: [] as { certID: string; dnsNames: string[] }[], certsObsolete: [] as { certID: string; dnsNames: string[] }[],
      dnsNamesFailedCAA: [] as string[], dnsNamesFailedChallenge: [] as string[], dnsNamesSkipped: [] as string[] } }
  const readyCertificate = structuredClone(state.certs.certs[0]!)
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); state.calls.push(url.pathname)
    assert.equal(url.origin, 'https://hosting.example:2222'); assert.equal(init?.redirect, 'manual')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Basic ' + Buffer.from('account:private-key').toString('base64'))
    assert(!url.pathname.endsWith('/files')); assert.notEqual(url.pathname, '/CMD_API_SSL')
    if (url.pathname.endsWith('/provision-certs-dry-run')) {
      assert.equal(init?.method, 'POST'); assert.equal(init.body, undefined)
      state.previewCalls++
      return json(state.previewOverride ?? state.dryRun)
    }
    if (url.pathname.endsWith('/provision-certs')) {
      assert.equal(init?.method, 'POST'); assert.equal(init.body, undefined)
      state.writes.push({ method: 'POST', path: url.pathname, body: '' })
      if (state.provisionStatus) return new Response('secret-never-provider-error', { status: state.provisionStatus })
      if (!['missing', 'partial'].includes(state.provisionMode)) {
        state.certs.certs = [structuredClone(readyCertificate)]; state.certs.certIds = ['certificate-id']; state.certs.missingDNSNames = []
      }
      if (state.provisionMode === 'timeout') throw new Error('secret-never-timeout')
      if (state.provisionMode === 'malformed') return json({ output: 'secret-never-output' })
      if (state.provisionMode === 'oversized') return new Response('secret-never-output', { headers: { 'Content-Length': String(512*1024+1) } })
      const result = { certsFulfilled: [{ certID: 'certificate-id', dnsNames: ['site.example','www.site.example'] }],
        certsRemoved: state.provisionMode === 'removed' ? [{ certID: 'old', dnsNames: ['site.example'] }] : [],
        dnsNamesFailedCAA: [], dnsNamesFailedChallenge: [], dnsNamesSkipped: [],
        provisionResults: [{ request: structuredClone(state.dryRun.certsPending[0]!), success: state.provisionMode !== 'partial', output: 'secret-never-command-output' }] }
      if (state.provisionMode === 'unexpected') result.provisionResults.push({ request: { certID: 'foreign', challengeType: 'http-01', dnsNames: ['foreign.example'] }, success: true, output: 'secret-never-other-output' })
      return json(result)
    }
    if (init?.method !== 'GET') {
      state.writes.push({ method: init!.method!, path: url.pathname, body: String(init!.body) })
      if (init?.method === 'PUT') {
        assert.equal(url.pathname, '/api/domain-tls/site.example/acme-config')
        assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json')
        state.acme = JSON.parse(String(init.body))
      } else {
        assert.equal(url.pathname, '/CMD_API_DOMAIN')
        const params = new URLSearchParams(String(init!.body))
        assert.equal(params.get('action'), 'private_html'); assert.equal(params.get('domain'), 'site.example')
        assert.deepEqual([...params.keys()].sort(), ['action', 'domain', ...(params.has('force_ssl') ? ['force_ssl'] : []), 'json'].sort())
        state.forceHttps = params.get('force_ssl') === 'yes'
      }
      if (state.uncertain) throw Error('secret upstream timeout')
      if (state.badStatus) return new Response('secret upstream error', { status: state.badStatus })
      return init?.method === 'PUT' ? new Response(null, { status: 204 }) : json({ error: '0' })
    }
    if (url.pathname === '/CMD_API_SHOW_DOMAINS') return new Response('list[]=site.example')
    if (url.pathname === '/CMD_API_SUBDOMAINS') return new Response(new URLSearchParams(state.subdomains.map(label => ['list[]', label])).toString())
    if (url.pathname === '/CMD_API_ADDITIONAL_DOMAINS') return json({ domain: 'site.example', ssl: state.ssl ? 'ON' : 'OFF',
      force_ssl: state.forceHttps ? 'yes' : undefined, hsts: state.hsts, suspended: state.suspended })
    if (url.pathname.endsWith('/acme-config')) return json(state.invalid ? { enabled: true } : state.acme)
    if (url.pathname.endsWith('/certs')) return json(state.certs)
    assert.fail('Unexpected path')
  }
  const changes = new HostingChanges(settings, request), tls = new TlsClient(settings, request)
  const change = (operation: 'set_free_certificate' | 'set_https_redirect', enabled: boolean) => ({ operation, domain: 'site.example', enabled, scope: 'domain_and_all_subdomains' })
  const apply = async (operation: 'set_free_certificate' | 'set_https_redirect', enabled: boolean) => {
    const p = await changes.plan('primary', change(operation, enabled), access)
    return changes.apply('primary', p.planId, p.previewHash, access)
  }
  return { state, settings, request, changes, tls, change, apply, close: () => rm(dir, { recursive: true, force: true }) }
}

test('TLS read uses owned parent and listed child, projects metadata and never accesses keys or public DNS', async () => {
  const f = await fixture()
  try {
    const info = await f.tls.getInfo('primary', 'site.example', 'stage.site.example')
    assert.equal(info.hostnameCovered, true); assert.equal(info.redirectReady, true)
    assert(!JSON.stringify(info).includes('secret-never')); assert(!JSON.stringify(info).includes('do-not-project'))
    await assert.rejects(f.tls.getInfo('primary', 'foreign.example'), code('DOMAIN_NOT_ON_SERVER'))
    await assert.rejects(f.tls.getInfo('primary', 'site.example', 'foreign.site.example'), code('DOMAIN_NOT_ON_SERVER'))
    f.state.invalid = true
    await assert.rejects(f.tls.getInfo('primary', 'site.example'), code('INVALID_RESPONSE'))
    assert.equal(f.state.writes.length, 0)
  } finally { await f.close() }
})

test('ACME enable/disable preserves secrets and unrelated settings; previews/state/receipts contain no secrets', async () => {
  const f = await fixture()
  try {
    const initial = structuredClone(f.state.acme)
    const plan = await f.changes.plan('primary', f.change('set_free_certificate', true), access)
    assert.equal(f.state.writes.length, 0)
    assert(!JSON.stringify(plan).includes('secret-never'))
    const result = await f.changes.apply('primary', plan.planId, plan.previewHash, access)
    assert.equal(result.certificateIssuance, 'not_verified_use_get_tls_info')
    assert.deepEqual(f.state.acme, { ...initial, enabled: true })
    assert.deepEqual(await new HostingChanges(f.settings, f.request).apply('primary', plan.planId, plan.previewHash, access), result)
    f.state.forceHttps = true
    await f.apply('set_free_certificate', false)
    assert.deepEqual(f.state.acme, initial); assert.equal(f.state.forceHttps, true)
    assert.equal(f.state.writes.length, 2); assert.equal(f.state.certs.certs.length, 1)
    const bytes = await readFile(f.settings.changeStateFile!)
    assert(!bytes.includes(Buffer.from('secret-never'))); assert(!bytes.includes(Buffer.from('do-not-project')))
  } finally { await f.close() }
})

test('TLS changes require write scope, exact allowlist and explicit parent-wide scope acknowledgement', async () => {
  const f = await fixture()
  try {
    assert(!changeInputSchema.safeParse({ operation: 'set_free_certificate', domain: 'site.example', enabled: true }).success)
    assert(!changeInputSchema.safeParse({ ...f.change('set_https_redirect', true), scope: 'subdomain' }).success)
    await assert.rejects(f.changes.plan('primary', f.change('set_free_certificate', true), { ...access, canWrite: false }), code('WRITE_SCOPE_REQUIRED'))
    f.settings.accounts.primary!.writeOperations = ['create_domain']
    await assert.rejects(f.changes.plan('primary', f.change('set_https_redirect', true), access), code('WRITE_DISABLED'))
    assert.equal(f.state.calls.length, 0)
  } finally { await f.close() }
})

test('force HTTPS is parent-wide, verifies coverage before apply and leaves document roots/HSTS unchanged', async () => {
  const f = await fixture()
  try {
    await f.apply('set_https_redirect', true)
    assert.equal(f.state.forceHttps, true)
    f.state.hsts = true
    const off = await f.changes.plan('primary', f.change('set_https_redirect', false), access)
    assert(off.warnings.some(w => w.includes('HSTS')))
    await f.changes.apply('primary', off.planId, off.previewHash, access)
    assert.equal(f.state.forceHttps, false); assert.equal(f.state.hsts, true)
    assert.equal(f.state.writes.length, 2)
  } finally { await f.close() }
})

test('pending, expired, future, invalid, missing or incompletely covered certificates never permit HTTPS', async () => {
  const f = await fixture()
  try {
    const baseline = structuredClone(f.state.certs)
    const changes = [
      () => { f.state.certs.certs = [] },
      () => { f.state.certs.certs[0]!.certificate.notAfter = new Date(Date.now() - 1).toISOString() },
      () => { f.state.certs.certs[0]!.certificate.notBefore = new Date(Date.now() + 86400000).toISOString() },
      () => { f.state.certs.certs[0]!.validationError = 'secret challenge failure' },
      () => { f.state.certs.certIds = [] },
      () => { f.state.certs.missingDNSNames = ['alias.example'] },
      () => { f.state.certs.certs[0]!.certificate.dnsNames = ['site.example', '*.site.example'] }, // wildcard cannot cover www.stage
      () => { f.state.ssl = false },
      () => { f.state.suspended = true },
    ]
    for (const mutate of changes) {
      f.state.certs = structuredClone(baseline); f.state.ssl = true; f.state.suspended = false; mutate()
      await assert.rejects(f.changes.plan('primary', f.change('set_https_redirect', true), access), code('CERTIFICATE_NOT_READY'))
    }
    assert.equal(f.state.writes.length, 0)
  } finally { await f.close() }
})

test('TLS fresh-state checks include DNS secrets, certificate changes and sibling inventory; provider conflict fails closed', async () => {
  const f = await fixture()
  try {
    const acme = await f.changes.plan('primary', f.change('set_free_certificate', true), access)
    f.state.acme.dnsEnvironment.CLOUDFLARE_DNS_API_TOKEN = 'changed-private-secret'
    await assert.rejects(f.changes.apply('primary', acme.planId, acme.previewHash, access), code('STALE_PLAN'))
    const redirect = await f.changes.plan('primary', f.change('set_https_redirect', true), access)
    f.state.subdomains.push('new')
    await assert.rejects(f.changes.apply('primary', redirect.planId, redirect.previewHash, access), code('CERTIFICATE_NOT_READY'))
    f.state.acme.provider = 'letsencrypt-staging'
    await assert.rejects(f.changes.plan('primary', f.change('set_free_certificate', true), access), code('ACME_PROVIDER_CONFLICT'))
    assert.equal(f.state.writes.length, 0)
  } finally { await f.close() }
})

test('ambiguous PUT locks account, replay cannot resend and reconciliation uses observed complete config', async () => {
  const f = await fixture()
  try {
    const plan = await f.changes.plan('primary', f.change('set_free_certificate', true), access)
    f.state.uncertain = true
    await assert.rejects(f.changes.apply('primary', plan.planId, plan.previewHash, access), code('WRITE_OUTCOME_UNKNOWN'))
    await assert.rejects(f.changes.apply('primary', plan.planId, plan.previewHash, access), code('PLAN_NOT_READY'))
    const result = await f.changes.get('primary', plan.planId, access, true)
    assert.equal(result.status, 'applied'); assert.equal(result.result?.originalWriteConfirmation, 'unknown')
    assert.equal(f.state.writes.length, 1)
  } finally { await f.close() }
})

test('MCP exposes safe TLS read and strictly validated planned changes to AI clients', async () => {
  const f = await fixture()
  const server = createMcpServer(f.settings, f.request, access), client = new Client({ name: 'tls-test', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(a); await client.connect(b)
    const read = await client.callTool({ name: 'get_tls_info', arguments: { serverId: 'primary', domain: 'site.example' } })
    assert.equal(read.isError, undefined); assert(!JSON.stringify(read).includes('secret-never'))
    const plan = await client.callTool({ name: 'plan_hosting_change', arguments: { serverId: 'primary', change: f.change('set_free_certificate', true) } })
    assert.equal(plan.isError, undefined); assert.equal(f.state.writes.length, 0)
  } finally { await client.close(); await server.close(); await f.close() }
})

const provisionInput = { operation: 'provision_certificates', domain: 'site.example', scope: 'domain_and_all_subdomains' }
async function pendingFixture() {
  const f = await fixture(), certificate = structuredClone(f.state.certs.certs[0]!)
  f.state.acme.enabled = true; f.state.subdomains = []
  f.state.certs = { certIds: [], certs: [], missingDNSNames: ['site.example','www.site.example'] }
  return { ...f, observeProvisioned() { f.state.certs = { certIds: ['certificate-id'], certs: [structuredClone(certificate)], missingDNSNames: [] } } }
}

test('immediate issuance plans use dry run, require exact authorization and send one replay-safe request', async () => {
  const f = await pendingFixture()
  try {
    assert(!changeInputSchema.safeParse({ operation: 'provision_certificates', domain: 'site.example' }).success)
    assert(!changeInputSchema.safeParse({ ...provisionInput, enabled: true }).success)
    await assert.rejects(f.changes.plan('primary', provisionInput, { ...access, canWrite: false }), code('WRITE_SCOPE_REQUIRED'))
    f.settings.accounts.primary!.writeOperations = ['set_free_certificate']
    await assert.rejects(f.changes.plan('primary', provisionInput, access), code('WRITE_DISABLED'))
    assert.equal(f.state.calls.length, 0)
    f.settings.accounts.primary!.writeOperations = ['provision_certificates']
    const p = await f.changes.plan('primary', provisionInput, access)
    assert.equal(f.state.previewCalls, 1); assert.equal(f.state.writes.length, 0)
    assert(!JSON.stringify(p).includes('secret-never'))
    f.settings.accounts.primary!.writeOperations = ['set_free_certificate']
    await assert.rejects(f.changes.apply('primary', p.planId, p.previewHash, access), code('WRITE_DISABLED'))
    f.settings.accounts.primary!.writeOperations = ['provision_certificates']
    const applied = await f.changes.apply('primary', p.planId, p.previewHash, access)
    assert.equal(applied.certificateIssuance, 'verified_for_planned_names')
    assert.deepEqual(applied.coveredNames, ['site.example','www.site.example'])
    assert.equal(f.state.writes.length, 1); assert.equal(f.state.previewCalls, 2)
    assert.deepEqual(await new HostingChanges(f.settings, f.request).apply('primary', p.planId, p.previewHash, access), applied)
    assert.equal(f.state.writes.length, 1)
    assert.equal(f.state.forceHttps, false); assert.equal(f.state.hsts, false)
    const stored = await readFile(f.settings.changeStateFile!)
    assert(!stored.includes(Buffer.from('secret-never'))); assert(!stored.includes(Buffer.from('do-not-project')))
  } finally { await f.close() }
})

test('issuance refuses disabled, concurrent, limited, invalid, foreign and certificate-removing previews', async () => {
  const scenarios: [string, (f: Awaited<ReturnType<typeof pendingFixture>>) => void][] = [
    ['ACME_DISABLED', f => { f.state.acme.enabled = false }],
    ['TLS_DISABLED', f => { f.state.ssl = false }],
    ['TLS_DISABLED', f => { f.state.suspended = true }],
    ['ACME_PROVIDER_CONFLICT', f => { f.state.acme.provider = 'letsencrypt-staging' }],
    ['ACME_DISABLED', f => { f.state.dryRun.acmeEnabled = false }],
    ['TLS_IN_PROGRESS', f => { f.state.dryRun.acmeInProgress = true }],
    ['TLS_RATE_LIMIT', f => { f.state.dryRun.ratelimitReached = true }],
    ['CERTIFICATE_REMOVAL_REQUIRED', f => { f.state.dryRun.certsObsolete.push({ certID: 'old', dnsNames: ['site.example'] }) }],
    ['TLS_VALIDATION_BLOCKED', f => { f.state.dryRun.dnsNamesFailedCAA.push('site.example') }],
    ['TLS_VALIDATION_BLOCKED', f => { f.state.dryRun.dnsNamesFailedChallenge.push('site.example') }],
    ['CERTIFICATE_ALREADY_READY', f => { f.state.dryRun.certsPending = [] }],
    ['INVALID_RESPONSE', f => { f.state.dryRun.certsPending[0]!.dnsNames = ['foreign.example'] }],
    ['INVALID_RESPONSE', f => { f.state.dryRun.certsPending.push(structuredClone(f.state.dryRun.certsPending[0]!)) }],
    ['INVALID_RESPONSE', f => { f.state.previewOverride = { error: 'secret-never-upstream-error' } }],
    ['INVALID_RESPONSE', f => { Object.assign(f.state.acme, { futureSecretSetting: 'secret-never-drop' }) }],
  ]
  for (const [expected, mutate] of scenarios) {
    const f = await pendingFixture()
    try { mutate(f); await assert.rejects(f.changes.plan('primary', provisionInput, access), code(expected)); assert.equal(f.state.writes.length, 0) }
    finally { await f.close() }
  }
})

test('changed ACME secrets, pending request scope or hosting invalidate issuance plans before any write', async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof pendingFixture>>) => { f.state.acme.externalAccountHMAC = 'secret-never-changed' },
    (f: Awaited<ReturnType<typeof pendingFixture>>) => { f.state.dryRun.certsPending[0]!.dnsNames = ['site.example'] },
    (f: Awaited<ReturnType<typeof pendingFixture>>) => { f.state.forceHttps = true },
  ]) {
    const f = await pendingFixture()
    try {
      const p = await f.changes.plan('primary', provisionInput, access); mutate(f)
      await assert.rejects(f.changes.apply('primary', p.planId, p.previewHash, access), code('STALE_PLAN'))
      assert.equal(f.state.writes.length, 0)
    } finally { await f.close() }
  }
})

test('documented no-start rejections release the reservation without claiming issuance or retrying', async () => {
  for (const [status, expected] of [[403,'ACCESS_DENIED'],[404,'NOT_FOUND'],[409,'ACME_DISABLED'],[490,'TLS_RATE_LIMIT'],[491,'TLS_IN_PROGRESS']] as const) {
    const f = await pendingFixture()
    try {
      const p = await f.changes.plan('primary', provisionInput, access); f.state.provisionStatus = status
      await assert.rejects(f.changes.apply('primary', p.planId, p.previewHash, access), code(expected))
      const receipt = await f.changes.get('primary', p.planId, access)
      assert.equal(receipt.status, 'failed'); assert.equal(f.state.writes.length, 1)
      assert(!JSON.stringify(receipt).includes('secret-never'))
    } finally { await f.close() }
  }
})

test('timeouts, incomplete responses and limits preserve unknown outcomes and reconcile without another request', async () => {
  for (const mode of ['timeout','malformed','missing','partial','oversized','redirect']) {
    const f = await pendingFixture()
    try {
      const p = await f.changes.plan('primary', provisionInput, access)
      f.state.provisionMode = mode
      if (mode === 'redirect') f.state.provisionStatus = 302
      await assert.rejects(f.changes.apply('primary', p.planId, p.previewHash, access), code('WRITE_OUTCOME_UNKNOWN'))
      await assert.rejects(f.changes.apply('primary', p.planId, p.previewHash, access), code('PLAN_NOT_READY'))
      f.observeProvisioned()
      const receipt = await f.changes.get('primary', p.planId, access, true)
      assert.equal(receipt.status, 'applied'); assert.equal(receipt.result?.originalWriteConfirmation, 'unknown')
      assert.equal(f.state.writes.length, 1); assert(!JSON.stringify(receipt).includes('secret-never'))
    } finally { await f.close() }
  }
})

test('unexpected removals or additional provisioning scope stay locked even when certificate coverage appears ready', async () => {
  for (const mode of ['removed','unexpected']) {
    const f = await pendingFixture()
    try {
      const p = await f.changes.plan('primary', provisionInput, access); f.state.provisionMode = mode
      await assert.rejects(f.changes.apply('primary', p.planId, p.previewHash, access), code('WRITE_OUTCOME_UNKNOWN'))
      const receipt = await f.changes.get('primary', p.planId, access, true)
      assert.equal(receipt.status, 'unknown')
      assert.equal(f.state.writes.length, 1); assert(!JSON.stringify(receipt).includes('secret-never'))
    } finally { await f.close() }
  }
})

test('the real MCP client can preview and apply the typed issuance operation', async () => {
  const f = await pendingFixture(), server = createMcpServer(f.settings,f.request,access), client = new Client({name:'provision-test',version:'1'})
  const [a,b] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(a); await client.connect(b)
    const preview = await client.callTool({name:'plan_hosting_change',arguments:{serverId:'primary',change:provisionInput}})
    assert.equal(preview.isError,undefined)
    const plan = preview.structuredContent as {planId:string;previewHash:string}
    const result = await client.callTool({name:'apply_hosting_change',arguments:{serverId:'primary',...{planId:plan.planId,previewHash:plan.previewHash}}})
    assert.equal(result.isError,undefined); assert.equal(f.state.writes.length,1)
  } finally { await client.close();await server.close();await f.close() }
})

test('issuance cannot reconcile success after silently losing an existing certificate', async () => {
  const f = await pendingFixture()
  try {
    f.observeProvisioned()
    f.state.certs.certs[0]!.id = 'old-certificate'
    f.state.certs.certs[0]!.certificate.dnsNames = ['old.site.example']
    f.state.certs.certIds = ['old-certificate']
    const p = await f.changes.plan('primary', provisionInput, access)
    await assert.rejects(f.changes.apply('primary', p.planId, p.previewHash, access), code('WRITE_OUTCOME_UNKNOWN'))
    assert.equal((await f.changes.get('primary', p.planId, access, true)).status, 'unknown')
    assert.equal(f.state.writes.length, 1)
  } finally { await f.close() }
})

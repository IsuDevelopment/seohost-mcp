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
    dnsProvider: 'cloudflare', dnsEnvironment: { CLOUDFLARE_DNS_API_TOKEN: 'secret-never-return-or-persist' }, skipDNSNames: ['testing.site.example'] },
    subdomains: ['stage'], forceHttps: false, ssl: true, hsts: false, suspended: false,
    certs: { certIds: ['certificate-id'], missingDNSNames: [] as string[], certs: [{ id: 'certificate-id', autorenewEnabled: true, validationError: '',
      certificate: { dnsNames: ['site.example', '*.site.example', '*.stage.site.example'],
        notBefore: new Date(Date.now() - 86400000).toISOString(), notAfter: new Date(Date.now() + 86400000).toISOString(),
        issuer: 'safe issuer', privateKey: 'do-not-project-additional-fields' } }] },
    writes: [] as { method: string; path: string; body: string }[], calls: [] as string[], uncertain: false, badStatus: 0, invalid: false }
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); state.calls.push(url.pathname)
    assert.equal(url.origin, 'https://hosting.example:2222'); assert.equal(init?.redirect, 'manual')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Basic ' + Buffer.from('account:private-key').toString('base64'))
    assert(!url.pathname.endsWith('/files')); assert.notEqual(url.pathname, '/CMD_API_SSL')
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

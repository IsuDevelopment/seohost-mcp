import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSettings } from '../src/config.js'
import { DomainDnsClient } from '../src/domain-dns.js'
import { PublicDns } from '../src/public-dns.js'
import { HostingError } from '../src/hosting-error.js'

const json = (value: unknown) => new Response(JSON.stringify(value))
async function fixture() {
  const settings = await loadSettings({}, false)
  settings.accounts = { primary: { label: 'Hosting', aliases: [], baseUrl: 'https://hosting.example:2222',
    usernameEnv: 'USER', loginKeyEnv: 'KEY', dnsNameservers: ['ns1.hosting.example', 'ns2.hosting.example'] } }
  settings.credentials = { primary: { username: 'account', loginKey: 'private-provider-key' } }
  return settings
}
const record = { type: 'A', name: 'site.example.', value: '192.0.2.1', ttl: '300' }

test('domain details/zone verify account ownership, project safe fields, preserve TTL and do not perform public lookups', async () => {
  const settings = await fixture(), calls: URL[] = []
  const api = new DomainDnsClient(settings, async (input, init) => {
    const url = new URL(String(input)); calls.push(url)
    assert.equal(url.origin, 'https://hosting.example:2222'); assert.equal(init?.method, 'GET')
    assert.match(new Headers(init.headers).get('Authorization')!, /^Basic /)
    if (url.pathname === '/CMD_API_SHOW_DOMAINS') return new Response('list[]=site.example')
    if (url.pathname === '/CMD_API_ADDITIONAL_DOMAINS') return json({ domain: 'site.example', active: 'yes', php: 'ON', ssl: 'ON', suspended: 'no',
      ip: '192.0.2.1', quota: '0 / unlimited', username: 'private-account', DIRECTORY_CHECKED: '/home/private-account', password: 'private-password' })
    assert.equal(url.pathname, '/CMD_API_DNS_CONTROL'); assert.equal(url.searchParams.get('full_mx_records'), 'yes')
    return json({ records: [record], dns_ttl: 'yes' })
  })
  const info = await api.getDomainInfo('primary', 'site.example')
  assert.equal(info.phpEnabled, true); assert.equal(info.sslEnabled, true); assert.equal(info.documentRoot, null)
  for (const value of ['private-account', 'private-password', '/home/']) assert(!JSON.stringify(info).includes(value))
  const zone = await api.listRecords('primary', 'site.example')
  assert.equal(zone.records[0]?.ttl, 300); assert.match(zone.records[0]!.id, /^[a-f0-9]{64}$/)
  assert.equal(zone.activePublicZone, 'unverified'); assert(!JSON.stringify(zone).includes('rawName'))
  const before = calls.length
  await assert.rejects(api.zone('primary', 'foreign.example'), (error: unknown) => error instanceof HostingError && error.code === 'DOMAIN_NOT_ON_SERVER')
  assert.equal(calls.length, before + 1)
})

test('public DNS uses fixed credential-free HTTPS origin and bounded TTL cache; fresh bypasses only local cache', async () => {
  let calls = 0
  const dns = new PublicDns(async (input, init) => {
    calls++; const url = new URL(String(input))
    assert.equal(url.origin, 'https://dns.google'); assert.equal(url.pathname, '/resolve')
    assert.equal(new Headers(init?.headers).has('Authorization'), false); assert.equal(init?.redirect, 'manual')
    return json({ Status: 0, Answer: [{ name: 'cache-dns.example.', type: 1, TTL: 60, data: '192.0.2.7' }] })
  })
  assert.equal((await dns.query('cache-dns.example', 'A', true)).cached, false)
  assert.equal((await dns.query('cache-dns.example', 'A')).cached, true)
  assert.equal(calls, 1)
  await dns.query('cache-dns.example', 'A', true); assert.equal(calls, 2)
  await assert.rejects(dns.query('https://internal.example', 'A'))
  const failed = new PublicDns(async () => new Response('x'.repeat(65537)))
  assert.equal((await failed.query('oversize.example', 'A', true)).status, 'failed')
  const nxdomain = new PublicDns(async () => json({ Status: 3 }))
  assert.equal((await nxdomain.query('missing.example', 'NS', true)).status, 'nxdomain')
  const truncated = new PublicDns(async () => json({ Status: 0, TC: true, Answer: [{ name: 'truncated.example', type: 2, TTL: 60, data: 'ns.hosting.example' }] }))
  assert.equal((await truncated.query('truncated.example', 'NS', true)).status, 'failed')
})

test('DNS diagnostics distinguish Cloudflare/local zone and never infer proxy state; resolver failure is not absence', async () => {
  const settings = await fixture()
  let fail = false
  const api = new DomainDnsClient(settings, async input => {
    const url = new URL(String(input))
    if (url.hostname === 'hosting.example') {
      if (url.pathname === '/CMD_API_SHOW_DOMAINS') return new Response('list[]=site.example')
      return json({ records: [record, { type: 'TXT', name: 'site.example.', value: '"v=spf1 -all"', ttl: 300 }], dns_ttl: 'yes' })
    }
    if (fail) throw Error('private-network-diagnostic')
    const type = Number(url.searchParams.get('type')), name = url.searchParams.get('name')!
    return json({ Status: 0, Answer: type === 2 ? [{ name, type, TTL: 60, data: 'one.ns.cloudflare.com.' }]
      : type === 1 ? [{ name, type, TTL: 60, data: '192.0.2.2' }] : [] })
  })
  const result = await api.check('primary', 'site.example', '@', true)
  assert.equal(result.authority.providerHint, 'cloudflare'); assert.equal(result.authority.matchesHosting, false)
  assert.equal(result.authority.proxyStatus, 'unknown')
  assert.equal(result.comparisons.find(item => item.type === 'A')?.status, 'differs')
  fail = true
  const failed = await api.check('primary', 'site.example', '@', true)
  assert.equal(failed.authority.providerHint, 'unknown')
  assert(failed.comparisons.every(item => item.status === 'unverified'))
  assert(!JSON.stringify(failed).includes('private-network-diagnostic'))
})

test('malformed/duplicate zones and owner names outside the account zone fail closed', async () => {
  const settings = await fixture()
  for (const records of [[record, record], [{ ...record, ttl: 'not-a-number' }], [{ ...record, name: 'outside.example.' }]]) {
    const api = new DomainDnsClient(settings, async input => new URL(String(input)).pathname === '/CMD_API_SHOW_DOMAINS'
      ? new Response('list[]=site.example') : json({ records }))
    await assert.rejects(api.zone('primary', 'site.example'))
  }
})

import { isIP } from 'node:net'
import { z } from 'zod'
import { resolveServer, type Settings } from './config.js'
import type { AccessContext } from './auth.js'
import { domainSchema } from './directadmin.js'
import { DomainDnsClient, fingerprint, type ZoneRecord } from './domain-dns.js'
import { dnsName } from './public-dns.js'
import { ChangeStore } from './change-store.js'
import { HostingError } from './hosting-error.js'
import type { WritePath } from './directadmin-http.js'

const dnsRecordInput = z.object({ type: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT']),
  name: z.string().min(1).max(254).default('@'), value: z.string().min(1).max(8192).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  ttl: z.number().int().min(60).max(604800).optional() }).strict()
export const changeInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('create_domain'), domain: domainSchema }).strict(),
  z.object({ operation: z.literal('create_subdomain'), domain: domainSchema, label: z.string().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/) }).strict(),
  z.object({ operation: z.literal('add_dns_record'), domain: domainSchema, record: dnsRecordInput }).strict(),
  z.object({ operation: z.literal('update_dns_record'), domain: domainSchema, recordId: z.string().regex(/^[a-f0-9]{64}$/), record: dnsRecordInput }).strict(),
  z.object({ operation: z.literal('delete_dns_record'), domain: domainSchema, recordId: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
])
type ChangeInput = z.infer<typeof changeInputSchema>
type Prepared = { input: ChangeInput; snapshot: string; path: WritePath; params: Record<string, string>;
  before: unknown; after: unknown; expected: string; previewHash: string; warnings: string[] }
const selectorPrefixes: Record<string, string> = { A: 'arecs', AAAA: 'aaaarecs', CNAME: 'cnamerecs', MX: 'mxrecs', TXT: 'txtrecs' }
const semantic = (records: Pick<ZoneRecord, 'type' | 'name' | 'value' | 'ttl'>[]) => fingerprint(records.map(record => ({
  type: record.type, name: record.name, value: record.type === 'TXT' ? record.value.replace(/"\s+"/g, '').replace(/^"|"$/g, '') : record.value,
  ttl: record.ttl,
})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))

export class HostingChanges {
  private readonly dns: DomainDnsClient
  constructor(private readonly settings: Settings, request: typeof fetch = fetch) { this.dns = new DomainDnsClient(settings, request) }
  private authorize(reference: string | number, access: AccessContext, operation?: ChangeInput['operation']) {
    const { serverId, account } = resolveServer(this.settings.accounts, reference)
    if (!access.canWrite) throw new HostingError('WRITE_SCOPE_REQUIRED', 'A separate mcp:write grant or write token is required; read credentials cannot create/apply previews.')
    if (operation && !account.writeOperations?.includes(operation)) throw new HostingError('WRITE_DISABLED', 'This operation is not enabled for the selected account.')
    return serverId
  }
  private async requireActiveDns(serverId: string, domain: string) {
    const authority = await this.dns.publicDns.authority(domain, this.settings.accounts[serverId]!.dnsNameservers, true)
    if (!authority.matchesHosting || authority.providerHint === 'cloudflare') throw new HostingError('DNS_AUTHORITY_UNVERIFIED', 'Public NS do not confirm this hosting DNS zone. Modify the active provider, or resolve the DNS lookup failure.')
    return authority
  }
  private record(input: z.infer<typeof dnsRecordInput>, domain: string, ttl: number) {
    const name = dnsName(input.name, domain)
    if (name.includes('*') && !name.startsWith('*.')) throw new HostingError('INVALID_DNS_NAME', 'A DNS wildcard must be the leftmost label.')
    let value = input.value
    if (input.type === 'A' && isIP(value) !== 4 || input.type === 'AAAA' && isIP(value) !== 6)
      throw new HostingError('INVALID_DNS_VALUE', 'Use an IP address matching the record type.')
    if (input.type === 'AAAA') value = new URL(`http://[${value}]/`).hostname.slice(1, -1)
    if (input.type === 'CNAME') {
      if (name === domain) throw new HostingError('INVALID_DNS_VALUE', 'An apex CNAME would conflict with the zone NS/SOA records.')
      value = domainSchema.parse(value.replace(/\.$/, '')) + '.'
    }
    if (input.type === 'MX') {
      const match = value.match(/^(\d{1,5})\s+(\S+)$/)
      if (!match || Number(match[1]) > 65535) throw new HostingError('INVALID_DNS_VALUE', 'Use MX value: priority hostname, with priority 0–65535.')
      value = Number(match[1]) + ' ' + domainSchema.parse(match[2]!.replace(/\.$/, '')) + '.'
    }
    if (input.type === 'TXT') {
      if (Buffer.byteLength(value) > 255) throw new HostingError('INVALID_DNS_VALUE', 'This release supports one TXT string of at most 255 bytes per write.')
      value = JSON.stringify(value)
    }
    return { type: input.type, name, value, ttl, rawName: name + '.' }
  }
  private async prepare(serverId: string, input: ChangeInput): Promise<Omit<Prepared, 'previewHash'>> {
    const params: Record<string, string> = { domain: input.domain, json: 'yes' }
    const warnings = ['Changes affect the selected hosting account. Review the exact preview before applying.']
    if (input.operation === 'create_domain') {
      const domains = (await this.dns.hosting.listDomains(serverId)).domains
      if (domains.includes(input.domain)) throw new HostingError('ALREADY_EXISTS', 'This domain already exists on the selected account.')
      const authority = await this.dns.publicDns.authority(input.domain, this.settings.accounts[serverId]!.dnsNameservers, true)
      Object.assign(params, { action: 'create', uquota: 'unlimited', ubandwidth: 'unlimited', ssl: 'ON', php: 'ON', cgi: 'OFF' })
      warnings.push('Creates hosting configuration/local DNS, not domain registration or external DNS. Quota/bandwidth share account limits. No certificate is issued.')
      return { input, snapshot: fingerprint(domains), path: '/CMD_API_DOMAIN', params, before: null,
        after: { domain: input.domain, php: true, ssl: true, cgi: false, limits: 'shared_account_limits', publicDns: authority }, expected: input.domain, warnings }
    }
    if (input.operation === 'create_subdomain') {
      const fqdn = domainSchema.parse(`${input.label}.${input.domain}`)
      const current = await this.dns.hosting.listSubdomains(serverId, input.domain)
      if (current.subdomains.includes(fqdn) || (await this.dns.hosting.listDomains(serverId)).domains.includes(fqdn))
        throw new HostingError('ALREADY_EXISTS', 'This hostname already exists as a domain or subdomain on the account.')
      const authority = await this.dns.publicDns.authority(input.domain, this.settings.accounts[serverId]!.dnsNameservers, true)
      Object.assign(params, { action: 'create', subdomain: input.label })
      warnings.push('Creates local hosting/subdomain configuration; public DNS may require a separate change at the active provider. No document-root override or certificate is requested.')
      return { input, snapshot: fingerprint(current.subdomains), path: '/CMD_API_SUBDOMAINS', params, before: null,
        after: { hostname: fqdn, publicDns: authority }, expected: fqdn, warnings }
    }
    const zone = await this.dns.zone(serverId, input.domain)
    await this.requireActiveDns(serverId, input.domain)
    const before = 'recordId' in input ? zone.records.find(record => record.id === input.recordId) : undefined
    if ('recordId' in input && !before) throw new HostingError('RECORD_NOT_FOUND', 'Select a fresh recordId from list_dns_records.')
    if (before && !selectorPrefixes[before.type]) throw new HostingError('UNSUPPORTED_RECORD_WRITE', 'This record type is read-only in the current release.')
    if (input.operation === 'update_dns_record' && before!.type !== input.record.type)
      throw new HostingError('INVALID_DNS_VALUE', 'Record edits must preserve the type; prepare separate explicit delete/add changes.')
    if ('record' in input && input.record.ttl !== undefined && !zone.perRecordTtl)
      throw new HostingError('TTL_UNSUPPORTED', 'This provider configuration does not support per-record TTL edits.')
    const after = 'record' in input ? this.record(input.record, input.domain, input.record.ttl ?? before?.ttl ?? (zone.perRecordTtl ? 3600 : zone.records[0]?.ttl ?? 14400)) : null
    const remaining = zone.records.filter(record => record.id !== before?.id)
    if (after) {
      if (remaining.some(record => record.name === after.name && (record.type === 'CNAME' || after.type === 'CNAME')))
        throw new HostingError('DNS_CONFLICT', 'A CNAME cannot coexist with other records at the same owner name.')
      if (remaining.some(record => record.type === after.type && record.name === after.name && record.value === after.value))
        throw new HostingError('ALREADY_EXISTS', 'The DNS record already exists.')
    }
    if (before) {
      const ambiguous = zone.records.filter(record => record.type === before.type && record.rawName === before.rawName && record.value === before.value)
      if (ambiguous.length !== 1) throw new HostingError('DNS_CONFLICT', 'The provider selector is ambiguous; no write can be prepared.')
      params[selectorPrefixes[before.type] + '0'] = new URLSearchParams({ name: before.rawName, value: before.value }).toString()
    }
    params.action = input.operation === 'add_dns_record' ? 'add' : input.operation === 'update_dns_record' ? 'edit' : 'select'
    if (after) Object.assign(params, { type: after.type, name: after.rawName, value: after.value, ...(zone.perRecordTtl ? { ttl: String(after.ttl) } : {}), full_mx_records: 'yes' })
    if (before?.type === 'MX') params.full_mx_records = 'yes'
    if ((after?.type === 'TXT' && /v=(?:spf1|dmarc1)/i.test(after.value)) || before?.type === 'MX' || after?.type === 'MX')
      warnings.push('This can affect mail routing/authentication. Preserve unrelated records and review the exact values.')
    warnings.push('Only the local provider state is verified after applying. Public resolver caches may retain the old records until TTL expiry.')
    return { input, snapshot: zone.version, path: '/CMD_API_DNS_CONTROL', params, before: before ?? null, after,
      expected: semantic([...remaining, ...(after ? [after] : [])]), warnings }
  }
  async plan(reference: string | number, value: unknown, access: AccessContext) {
    const input = changeInputSchema.parse(value), serverId = this.authorize(reference, access, input.operation)
    const prepared = await this.prepare(serverId, input)
    const payload: Prepared = { ...prepared, previewHash: fingerprint({ serverId, ...prepared }) }
    const store = new ChangeStore(this.settings.changeStateFile || 'data/changes.sqlite')
    try {
      const saved = store.create({ actor: access.actor, serverId, lockKey: serverId, expires: Date.now() + 600000, payload })
      return { serverId, planId: saved.id, previewHash: payload.previewHash, expiresAt: new Date(saved.expires).toISOString(),
        operation: input.operation, domain: input.domain, before: payload.before, after: payload.after, warnings: payload.warnings,
        applied: false, untrustedContent: true }
    } finally { store.close() }
  }
  private async verify(serverId: string, payload: Prepared) {
    if (payload.input.operation === 'create_domain') return (await this.dns.hosting.listDomains(serverId)).domains.includes(payload.expected)
    if (payload.input.operation === 'create_subdomain') return (await this.dns.hosting.listSubdomains(serverId, payload.input.domain)).subdomains.includes(payload.expected)
    return semantic((await this.dns.zone(serverId, payload.input.domain)).records) === payload.expected
  }
  async get(reference: string | number, id: string, access: AccessContext, reconcile = false) {
    const serverId = this.authorize(reference, access), store = new ChangeStore(this.settings.changeStateFile || 'data/changes.sqlite')
    try {
      const change = store.get(id, access.actor, serverId), payload = change.payload as Prepared
      if (reconcile && change.status === 'unknown' && await this.verify(serverId, payload)) {
        store.finish(change, 'applied', { serverId, planId: id, operation: payload.input.operation, domain: payload.input.domain,
          status: 'applied', providerStateVerified: true, originalWriteConfirmation: 'unknown',
          verificationSource: 'observed_during_reconciliation', publicPropagation: 'unverified', appliedAt: new Date().toISOString() })
      }
      return { serverId, planId: id, operation: payload.input.operation, status: change.status,
        expiresAt: new Date(change.expires).toISOString(), code: change.code ?? null, result: change.result ?? null }
    } finally { store.close() }
  }
  async apply(reference: string | number, id: string, previewHash: string, access: AccessContext) {
    const serverId = this.authorize(reference, access), store = new ChangeStore(this.settings.changeStateFile || 'data/changes.sqlite')
    let sent = false
    let change
    try {
      const existing = store.get(id, access.actor, serverId), payload = existing.payload as Prepared
      this.authorize(serverId, access, payload.input.operation)
      if (payload.previewHash !== previewHash) throw new HostingError('PREVIEW_MISMATCH', 'The preview fingerprint does not match this stored change.')
      change = store.reserve(id, access.actor, serverId)
      if (change.status === 'applied') return change.result!
      const fresh = await this.prepare(serverId, payload.input)
      if (fresh.snapshot !== payload.snapshot || fingerprint(fresh.params) !== fingerprint(payload.params))
        throw new HostingError('STALE_PLAN', 'Hosting/DNS state changed after the preview. Prepare and review a new plan.')
      sent = true
      await this.dns.transport.postForm(serverId, payload.path, payload.params)
      const verified = await this.verify(serverId, payload)
      if (!verified) throw new HostingError('WRITE_OUTCOME_UNKNOWN', 'The write response arrived but the expected provider state could not be verified. Inspect before retrying.')
      const result = { serverId, planId: id, operation: payload.input.operation, domain: payload.input.domain,
        status: 'applied', providerStateVerified: true, publicPropagation: 'unverified', appliedAt: new Date().toISOString() }
      store.finish(change, 'applied', result)
      return result
    } catch (error) {
      if (change) store.finish(change, sent ? 'unknown' : 'failed', undefined, error instanceof HostingError ? error.code : 'REQUEST_FAILED')
      if (sent && !(error instanceof HostingError && error.code === 'WRITE_OUTCOME_UNKNOWN'))
        throw new HostingError('WRITE_OUTCOME_UNKNOWN', 'A write was sent but its outcome is uncertain. Inspect the receipt and provider state; do not retry blindly.')
      throw error
    } finally { store.close() }
  }
}

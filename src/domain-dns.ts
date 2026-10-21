import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import { resolveServer, type Settings } from './config.js'
import { DirectAdminClient, domainSchema } from './directadmin.js'
import { DirectAdminTransport } from './directadmin-http.js'
import { HostingError } from './hosting-error.js'
import { PublicDns, dnsName, publicTypes, type PublicType } from './public-dns.js'

export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const recordSchema = z.object({ type: z.string().regex(/^[A-Z][A-Z0-9]{0,15}$/), name: z.string().min(1).max(254),
  value: z.string().max(8192), ttl: z.coerce.number().int().nonnegative().max(2147483647) })
export type ZoneRecord = z.infer<typeof recordSchema> & { id: string; rawName: string }
const flag = (value: unknown) => ['ON', 'yes', '1', true, 1].includes(value as string | boolean | number)

export class DomainDnsClient {
  readonly hosting: DirectAdminClient
  readonly transport: DirectAdminTransport
  readonly publicDns: PublicDns
  constructor(readonly settings: Settings, request: typeof fetch = fetch) {
    this.hosting = new DirectAdminClient(settings, request)
    this.transport = new DirectAdminTransport(settings, request)
    this.publicDns = new PublicDns(request)
  }
  async owned(reference: string | number, inputDomain: string) {
    const { serverId } = resolveServer(this.settings.accounts, reference), domain = domainSchema.parse(inputDomain)
    if (!(await this.hosting.listDomains(serverId)).domains.includes(domain))
      throw new HostingError('DOMAIN_NOT_ON_SERVER', 'Select a domain from list_domains on this account.')
    return { serverId, domain }
  }
  async getDomainInfo(reference: string | number, inputDomain: string) {
    const { serverId, domain } = await this.owned(reference, inputDomain)
    const raw = await this.transport.getText(serverId, '/CMD_API_ADDITIONAL_DOMAINS', { action: 'view', domain })
    let data: Record<string, unknown>
    try { data = raw.trimStart().startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)) }
    catch { throw new HostingError('INVALID_RESPONSE', 'Invalid domain settings returned by DirectAdmin.') }
    if (data.domain !== domain || ['1', 1, true].includes(data.error as string | number | boolean))
      throw new HostingError('INVALID_RESPONSE', 'Domain settings could not be verified.')
    const limit = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9 ._/-]{1,100}$/.test(value) ? value : null
    return { serverId, domain, active: flag(data.active), suspended: flag(data.suspended),
      phpEnabled: flag(data.php), sslEnabled: flag(data.ssl), forceSsl: flag(data.force_ssl), hsts: flag(data.hsts),
      ip: typeof data.ip === 'string' && isIP(data.ip) ? data.ip : null,
      providerReported: { bandwidth: limit(data.bandwidth), quota: limit(data.quota), unitsAndUsageVsLimit: 'provider_display_values' },
      documentRoot: null, documentRootStatus: 'not_queried', source: 'directadmin_domain_settings', untrustedContent: true }
  }
  async zone(reference: string | number, inputDomain: string) {
    const { serverId, domain } = await this.owned(reference, inputDomain)
    const raw = await this.transport.getText(serverId, '/CMD_API_DNS_CONTROL', { domain, json: 'yes', full_mx_records: 'yes' })
    let data: { records: z.infer<typeof recordSchema>[]; dns_ttl?: unknown }
    try { data = z.object({ records: z.array(recordSchema).max(2000), dns_ttl: z.unknown().optional() }).parse(JSON.parse(raw)) }
    catch { throw new HostingError('INVALID_RESPONSE', 'Invalid DNS zone returned by DirectAdmin.') }
    const records: ZoneRecord[] = data.records.map(record => ({ ...record, rawName: record.name,
      name: dnsName(record.name, domain), id: fingerprint({ serverId, domain, record }) })).sort((a, b) => a.id.localeCompare(b.id))
    if (new Set(records.map(record => record.id)).size !== records.length)
      throw new HostingError('INVALID_RESPONSE', 'Duplicate DNS records cannot be safely identified.')
    return { serverId, domain, records, perRecordTtl: flag(data.dns_ttl), version: fingerprint(records) }
  }
  async listRecords(reference: string | number, domain: string) {
    const zone = await this.zone(reference, domain)
    return { ...zone, records: zone.records.map(({ rawName, ...record }) => record),
      source: 'directadmin_local_zone', activePublicZone: 'unverified', untrustedContent: true }
  }
  async check(reference: string | number, inputDomain: string, inputName = '@', fresh = false) {
    const zone = await this.zone(reference, inputDomain), name = dnsName(inputName, zone.domain)
    const queryTypes = (Object.keys(publicTypes) as PublicType[]).filter(type => !(type === 'NS' && name === zone.domain))
    const [authority, entries, dmarc] = await Promise.all([
      this.publicDns.authority(zone.domain, this.settings.accounts[zone.serverId]!.dnsNameservers, fresh),
      Promise.all(queryTypes.map(async type => [type, await this.publicDns.query(name, type, fresh)] as const)),
      this.publicDns.query(`_dmarc.${zone.domain}`, 'TXT', fresh),
    ])
    if (name === zone.domain) entries.push(['NS', authority.observation])
    const publicRecords = Object.fromEntries(entries)
    const comparable = (type: string, value: string) => {
      if (type === 'TXT') return value.replace(/"\s+"/g, '').replace(/^"|"$/g, '')
      if (['CNAME', 'NS', 'MX'].includes(type)) return value.toLowerCase().replace(/\.$/, '')
      return value
    }
    const comparisons = entries.map(([type, observation]) => {
      const local = zone.records.filter(record => record.name === name && record.type === type).map(record => comparable(type, record.value)).sort()
      const observed = observation.values.map(value => comparable(type, value)).sort()
      return { type, status: observation.status === 'failed' || observation.status === 'nxdomain' ? 'unverified'
        : JSON.stringify(local) === JSON.stringify(observed) ? 'matches' : 'differs' }
    })
    const spf = publicRecords.TXT?.values.filter(value => /v=spf1\b/i.test(value)) ?? []
    const warnings: string[] = []
    if (!authority.matchesHosting) warnings.push('Local hosting DNS is not confirmed active; edit records at the authoritative DNS provider.')
    if (spf.length > 1) warnings.push('Multiple SPF policies observed at this name.')
    if (publicRecords.CNAME?.values.length && zone.records.some(record => record.name === name && record.type !== 'CNAME')) warnings.push('Public CNAME and local non-CNAME data differ; inspect the active provider.')
    return { serverId: zone.serverId, domain: zone.domain, name, authority, publicRecords, comparisons,
      mailPolicy: { spfPoliciesAtName: spf.length, dmarc }, warnings,
      coverage: 'one_recursive_resolver_not_global_propagation_or_full_mail_audit', untrustedContent: true }
  }
}

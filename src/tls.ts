import { z } from 'zod'
import type { Settings } from './config.js'
import { DomainDnsClient, fingerprint } from './domain-dns.js'
import { domainSchema } from './directadmin.js'
import { HostingError } from './hosting-error.js'

// Never fetch certificate files or CMD_API_SSL: both can expose private keys.
const name = z.string().min(1).max(254)
const acmeSchema = z.object({ enabled: z.boolean(), provider: z.enum(['', 'letsencrypt', 'letsencrypt-staging', 'zerossl']),
  keyType: z.enum(['ec256', 'ec384', 'rsa2048', 'rsa3072', 'rsa4096', 'rsa8192']), preferWildcard: z.boolean(),
  dnsProvider: z.string().max(256), dnsEnvironment: z.record(z.string().max(8192)), skipDNSNames: z.array(name).max(2000),
  externalAccountKeyID: z.string().max(256).optional(), externalAccountHMAC: z.string().max(256).optional(),
}).strict()
const certsSchema = z.object({ certIds: z.array(z.string().max(256)).max(2000), missingDNSNames: z.array(name).max(2000),
  certs: z.array(z.object({ id: z.string().min(1).max(256), autorenewEnabled: z.boolean(), validationError: z.string().max(16384),
    certificate: z.object({ dnsNames: z.array(name).max(2000), notBefore: z.string().datetime({ offset: true }),
      notAfter: z.string().datetime({ offset: true }) }).optional(),
  })).max(2000),
})
export const covers = (pattern: string, host: string) => {
  pattern = pattern.toLowerCase().replace(/\.$/, '')
  return pattern === host || pattern.startsWith('*.') && host.split('.').length === pattern.split('.').length && host.endsWith(pattern.slice(1))
}
const certificateName = name.refine(value => domainSchema.safeParse(value.replace(/^\*\./, '').replace(/\.$/, '')).success, 'Expected a certificate DNS name')
const namedCert = z.object({ certID: z.string().min(1).max(256), dnsNames: z.array(certificateName).min(1).max(2000) })
const requestSchema = namedCert.extend({ challengeType: z.string().min(1).max(64) })
const failures = { dnsNamesFailedCAA: z.array(certificateName).max(2000), dnsNamesFailedChallenge: z.array(certificateName).max(2000), dnsNamesSkipped: z.array(certificateName).max(2000) }
const previewSchema = z.object({ acmeEnabled: z.boolean(), acmeInProgress: z.boolean(), ratelimitReached: z.boolean(),
  certsFulfilled: z.array(namedCert).max(2000), certsObsolete: z.array(namedCert).max(2000), certsPending: z.array(requestSchema).max(2000), ...failures })
// Deliberately omit the raw provisioning output; it can contain diagnostics/secrets.
const provisionSchema = z.object({ certsFulfilled: z.array(namedCert).max(2000), certsRemoved: z.array(namedCert).max(2000),
  provisionResults: z.array(z.object({ request: requestSchema, success: z.boolean() })).max(2000), ...failures })
export const provisionRequestKey = (request: z.infer<typeof requestSchema>) => fingerprint({ certID: request.certID,
  challengeType: request.challengeType, dnsNames: [...request.dnsNames].sort() })
export const provisioningHostingState = (state: { sslEnabled: boolean; forceHttps: boolean; hsts: boolean; suspended: boolean; subdomains: string[] }) =>
  fingerprint({ ssl: state.sslEnabled, forceHttps: state.forceHttps, hsts: state.hsts, suspended: state.suspended, subdomains: [...state.subdomains].sort() })
export class TlsClient {
  readonly domains: DomainDnsClient
  constructor(settings: Settings, request: typeof fetch = fetch) { this.domains = new DomainDnsClient(settings, request) }
  async previewProvision(serverId: string, domain: string) {
    await this.domains.owned(serverId, domain)
    const raw = await this.domains.transport.postTlsProvision(serverId, domain, true)
    try {
      const preview = previewSchema.parse(JSON.parse(raw))
      for (const request of [...preview.certsPending, ...preview.certsObsolete]) for (const value of request.dnsNames) {
        const hostname = domainSchema.parse(value.replace(/^\*\./, '').replace(/\.$/, ''))
        if (hostname !== domain && !hostname.endsWith('.' + domain)) throw new Error('foreign certificate scope')
      }
      preview.certsPending.sort((a,b) => provisionRequestKey(a).localeCompare(provisionRequestKey(b)))
      if (new Set(preview.certsPending.map(provisionRequestKey)).size !== preview.certsPending.length)
        throw new Error('duplicate certificate requests')
      return preview
    } catch { throw new HostingError('INVALID_RESPONSE', 'Invalid or out-of-domain certificate provisioning preview.') }
  }
  async provision(serverId: string, domain: string, onSend: () => void) {
    await this.domains.owned(serverId, domain)
    onSend()
    const raw = await this.domains.transport.postTlsProvision(serverId, domain, false)
    try { return provisionSchema.parse(JSON.parse(raw)) }
    catch { throw new HostingError('WRITE_OUTCOME_UNKNOWN', 'Certificate provisioning returned incomplete metadata. Inspect the receipt and TLS state, without retrying.') }
  }
  async state(reference: string | number, inputDomain: string) {
    const info = await this.domains.getDomainInfo(reference, inputDomain)
    const { serverId, domain } = info
    const subdomains = (await this.domains.hosting.listSubdomains(serverId, domain)).subdomains
    let acme: z.infer<typeof acmeSchema>, certificates: z.infer<typeof certsSchema>
    try {
      acme = acmeSchema.parse(JSON.parse(await this.domains.transport.getText(serverId, `/api/domain-tls/${domain}/acme-config`, {})))
      certificates = certsSchema.parse(JSON.parse(await this.domains.transport.getText(serverId, `/api/domain-tls/${domain}/certs`, {})))
    } catch (error) {
      if (error instanceof HostingError) throw error
      throw new HostingError('INVALID_RESPONSE', 'Invalid TLS metadata returned by DirectAdmin.')
    }
    const now = Date.now()
    const certs = certificates.certs.map(item => ({
      id: item.id, autorenewEnabled: item.autorenewEnabled, validationError: Boolean(item.validationError),
      dnsNames: item.certificate?.dnsNames ?? [], notBefore: item.certificate?.notBefore ?? null,
      notAfter: item.certificate?.notAfter ?? null,
      providerValidNow: Boolean(item.certificate && certificates.certIds.includes(item.id) && !item.validationError
        && Date.parse(item.certificate.notBefore) <= now && Date.parse(item.certificate.notAfter) > now + 300000),
    }))
    const webHosts = [...new Set([domain, ...subdomains].flatMap(host => [host, `www.${host}`]))].sort()
    const uncoveredWebHosts = webHosts.filter(host => !certs.some(cert => cert.providerValidNow && cert.dnsNames.some(pattern => covers(pattern, host))))
    const redirectReady = info.sslEnabled && !info.suspended && uncoveredWebHosts.length === 0 && certificates.missingDNSNames.length === 0
    const publicState = { serverId, domain, scope: 'domain_and_all_subdomains', subdomains, webHosts,
      sslEnabled: info.sslEnabled, suspended: info.suspended, forceHttps: info.forceSsl, hsts: info.hsts,
      acme: { enabled: acme.enabled, provider: acme.provider || 'server_default', keyType: acme.keyType,
        preferWildcard: acme.preferWildcard, externalDnsProviderConfigured: Boolean(acme.dnsProvider),
        externalAccountBindingConfigured: Boolean(acme.externalAccountKeyID || acme.externalAccountHMAC), skippedNames: acme.skipDNSNames },
      certificates: certs, missingDnsNames: certificates.missingDNSNames, uncoveredWebHosts, redirectReady,
      verification: 'provider_metadata_only_not_live_tls_or_browser_trust', untrustedContent: true }
    // Only hashes and safe projections may enter a saved plan. dnsEnvironment stays in memory.
    return { acme, publicState, snapshot: fingerprint({ acme, info, subdomains, certificates }) }
  }
  async getInfo(reference: string | number, domain: string, hostname?: string) {
    const state = await this.state(reference, domain)
    if (hostname) {
      hostname = domainSchema.parse(hostname)
      if (hostname !== state.publicState.domain && !state.publicState.subdomains.includes(hostname))
        throw new HostingError('DOMAIN_NOT_ON_SERVER', 'Select the parent domain and a hostname from list_subdomains on this account.')
    }
    return { ...state.publicState, ...(hostname ? { requestedHostname: hostname,
      hostnameCovered: state.publicState.certificates.some(cert => cert.providerValidNow && cert.dnsNames.some(pattern => covers(pattern, hostname!))) } : {}) }
  }
}

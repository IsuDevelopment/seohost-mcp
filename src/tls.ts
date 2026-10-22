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
}).strict()
const certsSchema = z.object({ certIds: z.array(z.string().max(256)).max(2000), missingDNSNames: z.array(name).max(2000),
  certs: z.array(z.object({ id: z.string().min(1).max(256), autorenewEnabled: z.boolean(), validationError: z.string().max(16384),
    certificate: z.object({ dnsNames: z.array(name).max(2000), notBefore: z.string().datetime({ offset: true }),
      notAfter: z.string().datetime({ offset: true }) }).optional(),
  })).max(2000),
})
const covers = (pattern: string, host: string) => {
  pattern = pattern.toLowerCase().replace(/\.$/, '')
  return pattern === host || pattern.startsWith('*.') && host.split('.').length === pattern.split('.').length && host.endsWith(pattern.slice(1))
}
export class TlsClient {
  readonly domains: DomainDnsClient
  constructor(settings: Settings, request: typeof fetch = fetch) { this.domains = new DomainDnsClient(settings, request) }
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
      sslEnabled: info.sslEnabled, forceHttps: info.forceSsl, hsts: info.hsts,
      acme: { enabled: acme.enabled, provider: acme.provider || 'server_default', keyType: acme.keyType,
        preferWildcard: acme.preferWildcard, externalDnsProviderConfigured: Boolean(acme.dnsProvider), skippedNames: acme.skipDNSNames },
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

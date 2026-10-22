import { isIP } from 'node:net'
import { z } from 'zod'
import type { Settings } from './config.js'
import { DomainDnsClient, fingerprint } from './domain-dns.js'
import { domainSchema } from './directadmin.js'
import { HostingError } from './hosting-error.js'

// Literal paths only. Do not pass regexes, Apache directives or ambiguous escapes.
export const redirectPath = z.string().min(1).max(1024).regex(/^\/[a-zA-Z0-9/._~-]*$/)
  .refine(value => !value.includes('//') && value.split('/').every(part => part !== '.' && part !== '..'))
export const redirectDestination = z.string().min(1).max(2048).refine(value => {
  if (/[\s\u0000-\u001f\u007f"'`<>\\]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|22|27|5c)/i.test(value)) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !url.port
      && !isIP(url.hostname) && domainSchema.safeParse(url.hostname).success
  } catch { return false }
}, 'Use an absolute HTTP(S) domain URL without credentials, query, fragment, custom port or unsafe characters')
  .transform(value => new URL(value).href)
export const redirectType = z.union([z.literal(301), z.literal(302), z.literal(303)])
export type RedirectRule = { id: string; from: string; to: string; type: number }
export const redirectVersion = (rules: Pick<RedirectRule, 'from' | 'to' | 'type'>[]) => fingerprint(
  rules.map(({ from, to, type }) => ({ from, to, type })).sort((a, b) => a.from.localeCompare(b.from)))
const normalizedTarget = (value: string) => { try { return new URL(value).href } catch { return value } }
export const projectRedirect = (rule: RedirectRule) => {
  let destination: string | null = null, destinationRedacted = false
  try {
    const url = new URL(rule.to)
    if (['http:', 'https:'].includes(url.protocol)) {
      destinationRedacted = Boolean(url.username || url.password || url.search || url.hash)
      url.username = ''; url.password = ''; url.search = ''; url.hash = ''
      destination = url.href
    }
  } catch { /* Do not expose arbitrary non-URL provider text. */ }
  return { redirectId: rule.id, from: rule.from, type: rule.type, destination, destinationRedacted,
    manageable: redirectPath.safeParse(rule.from).success && redirectType.safeParse(rule.type).success }
}

export class RedirectsClient {
  readonly domains: DomainDnsClient
  constructor(settings: Settings, request: typeof fetch = fetch) { this.domains = new DomainDnsClient(settings, request) }
  async state(reference: string | number, inputDomain: string) {
    const { serverId, domain } = await this.domains.owned(reference, inputDomain)
    const raw = await this.domains.transport.getText(serverId, '/CMD_API_REDIRECT', { domain, apitype: 'yes' })
    const entries = [...new URLSearchParams(raw)]
    if (entries.some(([key]) => key === 'error'))
      throw new HostingError('INVALID_RESPONSE', 'DirectAdmin did not return a redirect inventory.')
    if (entries.length > 2000 || new Set(entries.map(([key]) => key)).size !== entries.length)
      throw new HostingError('INVALID_RESPONSE', 'Redirect inventory is oversized or contains ambiguous duplicate paths.')
    const rules: RedirectRule[] = entries.map(([from, encoded]) => {
      const data = [...new URLSearchParams(encoded)]
      if (!from.startsWith('/') || from.length > 1024 || /[\u0000-\u001f\u007f]/.test(from)
        || data.length !== 2 || !data.some(([key]) => key === 'to') || !data.some(([key]) => key === 'type'))
        throw new HostingError('INVALID_RESPONSE', 'Invalid redirect inventory returned by DirectAdmin.')
      const to = data.find(([key]) => key === 'to')![1], type = data.find(([key]) => key === 'type')![1]
      if (!to || to.length > 8192 || !/^[1-5]\d\d$/.test(type))
        throw new HostingError('INVALID_RESPONSE', 'Invalid redirect destination or status returned by DirectAdmin.')
      return { from, to: normalizedTarget(to), type: Number(type), id: fingerprint({ serverId, domain, from, to, type }) }
    }).sort((a, b) => a.from.localeCompare(b.from))
    return { serverId, domain, rules, version: redirectVersion(rules) }
  }
  async list(reference: string | number, domain: string) {
    const state = await this.state(reference, domain)
    return { serverId: state.serverId, domain: state.domain, redirects: state.rules.map(projectRedirect), version: state.version,
      source: 'directadmin_site_redirects', coverage: 'provider_managed_rules_not_all_htaccess_application_or_proxy_redirects',
      liveHttpVerified: false, untrustedContent: true }
  }
}

import { z } from 'zod'
import { domainToASCII } from 'node:url'
import { resolveServer, type Settings } from './config.js'

export { HostingError } from './hosting-error.js'
import { HostingError } from './hosting-error.js'
import { DirectAdminTransport } from './directadmin-http.js'

export const domainSchema = z.string().trim().min(1).max(253).refine(value => !/[\s\/:?#@%\\]/.test(value), 'Use a domain name only').transform(value => domainToASCII(value.toLowerCase())).refine(value => {
  const labels = value.split('.')
  return value.length <= 253 && labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
}, 'Use a domain name only, without a URL, port, path or query')

const MAX_OUTPUT_BYTES = 64 * 1024

export function redactLog(text: string): string {
  return text
    // All URL query values, including referers. Keep parameter names for diagnosis.
    .replace(/([?&][^\s="'<>?&]{1,128}=)[^\s&"'<>]*/g, '$1[REDACTED]')
    .replace(/((?:%3f|%26)[a-z0-9_.-]{1,128}%3d).*?(?=%26|[\s"']|$)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, '$1 [REDACTED]')
    .replace(/\b((?:set-cookie|cookie|authorization)\s*:\s*).*$/gim, '$1[REDACTED]')
    // PHP print_r, JSON and common WordPress/environment credential names.
    .replace(/^(\s*\[(?:password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|db[_-]?(?:password|pass)|(?:secure[_-]auth|logged[_-]in|auth|nonce)[_-](?:key|salt))\]\s*=>\s*).*$/gim, '$1[REDACTED]')
    .replace(/\b((?:password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|db[_-]?(?:password|pass)|(?:secure[_-]auth|logged[_-]in|auth|nonce)[_-](?:key|salt))\b["']?\]?\s*(?:=>|[=:])\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

function parseLegacyList(raw: string): unknown[] {
  if (!raw.trim() || /^list(?:%5b%5d|\[\])?=$/i.test(raw.trim())) return []
  if (/^\s*[\[{]/.test(raw)) {
    let data: unknown
    try { data = JSON.parse(raw) } catch { throw new HostingError('INVALID_RESPONSE', 'Invalid hosting list response.') }
    if (Array.isArray(data)) return data
    if (data && typeof data === 'object') {
      const value = data as Record<string, unknown>
      if (['1', 1, true].includes(value.error as string | number | boolean))
        throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected this list request.')
      if (Array.isArray(value.list)) return value.list
    }
  } else {
    const data = new URLSearchParams(raw)
    if (data.get('error') === '1') throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected this list request.')
    if (data.has('list[]')) return data.getAll('list[]')
  }
  throw new HostingError('INVALID_RESPONSE', 'Unrecognized hosting list response.')
}

export class DirectAdminClient {
  private readonly transport: DirectAdminTransport
  constructor(private readonly settings: Settings, request: typeof fetch = fetch) {
    this.transport = new DirectAdminTransport(settings, request)
  }

  async listDomains(reference: string | number) {
    const { serverId } = resolveServer(this.settings.accounts, reference)
    const raw = await this.transport.getText(serverId, '/CMD_API_SHOW_DOMAINS', {})
    const values = parseLegacyList(raw)
    const domains: string[] = []
    for (const value of values) {
      const parsed = domainSchema.safeParse(value)
      if (!parsed.success) throw new HostingError('INVALID_RESPONSE', 'DirectAdmin returned an invalid domain name.')
      domains.push(parsed.data)
    }
    return { serverId, domains: [...new Set(domains)].sort() }
  }

  async readWebLog(input: { serverId: string | number; domain: string; logType: 'access' | 'error'; lines?: number; contains?: string }) {
    const { serverId } = resolveServer(this.settings.accounts, input.serverId)
    const domain = domainSchema.parse(input.domain)
    const requestedLines = z.number().int().min(1).max(1000).parse(input.lines ?? 100)
    const logType = z.enum(['access', 'error']).parse(input.logType)
    const contains = z.string().min(1).max(200).optional().parse(input.contains)
    // Fresh ownership check on this account; never infer a server from a domain.
    if (!(await this.listDomains(serverId)).domains.includes(domain))
      throw new HostingError('DOMAIN_NOT_ON_SERVER', 'This domain is not listed on the selected hosting account. Call list_domains for that server.')
    const raw = await this.transport.getText(serverId, '/CMD_SHOW_LOG', { domain, type: logType === 'access' ? 'log' : 'error', lines: String(requestedLines), json: 'yes' })
    if (/^error=1(?:&|$)/.test(raw.trim())) throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected this log request.')
    if (/^\s*\{/.test(raw)) {
      // Error envelopes must not masquerade as raw log records.
      try { const data = JSON.parse(raw); if (data.error !== undefined) throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected this log request.') } catch (e) { if (e instanceof HostingError) throw e }
    }
    const tail = raw.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').filter((line, i, all) => !(all.length === 1 && line === '')).slice(-requestedLines)
    const knownSecrets = [this.settings.authToken, this.settings.writeAuthToken, ...Object.values(this.settings.credentials).map(value => value?.loginKey)].filter((value): value is string => Boolean(value))
    const selected = tail.filter(line => !contains || line.toLowerCase().includes(contains.toLowerCase())).map(line => {
      for (const secret of knownSecrets) line = line.split(secret).join('[REDACTED]')
      return redactLog(line)
    })
    let bytes = 0
    const output: string[] = []
    // Keep the most recent complete records when enforcing the output byte cap.
    for (let i = selected.length - 1; i >= 0; i--) {
      const line = selected[i]!, size = Buffer.byteLength(line) + 1
      if (bytes + size > MAX_OUTPUT_BYTES) break
      output.unshift(line); bytes += size
    }
    return { serverId, domain, logType, requestedLines, scannedLines: tail.length, returnedLines: output.length, truncated: output.length < selected.length, filterScope: 'last_requested_lines', redaction: 'best_effort', untrustedContent: true, fetchedAt: new Date().toISOString(), lines: output }
  }

  async listSubdomains(reference: string | number, inputDomain: string) {
    const { serverId } = resolveServer(this.settings.accounts, reference)
    const domain = domainSchema.parse(inputDomain)
    if (!(await this.listDomains(serverId)).domains.includes(domain))
      throw new HostingError('DOMAIN_NOT_ON_SERVER', 'This domain is not listed on the selected hosting account.')
    const raw = await this.transport.getText(serverId, '/CMD_API_SUBDOMAINS', { domain })
    const values = parseLegacyList(raw)
    const subdomains = values.map(value => {
      if (typeof value !== 'string') throw new HostingError('INVALID_RESPONSE', 'Invalid subdomain name.')
      const label = value.toLowerCase()
      const parsed = domainSchema.safeParse(label.endsWith('.' + domain) ? label : `${label}.${domain}`)
      if (!parsed.success || parsed.data === domain) throw new HostingError('INVALID_RESPONSE', 'Invalid subdomain name.')
      return parsed.data
    })
    return { serverId, domain, subdomains: [...new Set(subdomains)].sort() }
  }
}

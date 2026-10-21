import { z } from 'zod'
import { domainToASCII } from 'node:url'
import { resolveServer, type Settings } from './config.js'

export class HostingError extends Error {
  constructor(public readonly code: string, message: string) { super(message) }
}

export const domainSchema = z.string().trim().min(1).max(253).refine(value => !/[\s\/:?#@%\\]/.test(value), 'Use a domain name only').transform(value => domainToASCII(value.toLowerCase())).refine(value => {
  const labels = value.split('.')
  return value.length <= 253 && labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
}, 'Use a domain name only, without a URL, port, path or query')

const MAX_RESPONSE_BYTES = 512 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024

export function redactLog(text: string): string {
  return text
    // All URL query values, including referers. Keep parameter names for diagnosis.
    .replace(/([?&][^\s="'<>?&]{1,128}=)[^\s&"'<>]*/g, '$1[REDACTED]')
    .replace(/((?:%3f|%26)[a-z0-9_.-]{1,128}%3d).*?(?=%26|[\s"']|$)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, '$1 [REDACTED]')
    .replace(/\b((?:set-cookie|cookie|authorization)\s*:\s*).*$/gim, '$1[REDACTED]')
    .replace(/\b((?:password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

async function boundedText(response: Response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new HostingError('RESPONSE_TOO_LARGE', 'Hosting response is too large. Request fewer log lines.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new HostingError('RESPONSE_TOO_LARGE', 'Hosting response is too large. Request fewer log lines.')
      }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}

export class DirectAdminClient {
  constructor(private readonly settings: Settings, private readonly request: typeof fetch = fetch) {}

  private async get(serverId: string, path: '/CMD_API_SHOW_DOMAINS' | '/CMD_SHOW_LOG', params: Record<string, string>) {
    const account = this.settings.accounts[serverId]!, credentials = this.settings.credentials[serverId]
    if (!credentials) throw new HostingError('CREDENTIALS_MISSING', 'Hosting credentials are not configured for this server. Configure its username and Login Key privately.')
    const url = new URL(path, account.baseUrl)
    url.search = new URLSearchParams(params).toString()
    try {
      const response = await this.request(url, {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: 'Basic ' + Buffer.from(credentials.username + ':' + credentials.loginKey).toString('base64'), Accept: 'application/json, text/plain, application/x-www-form-urlencoded' },
      })
      if (!response.ok) {
        await response.body?.cancel()
        if ([401, 403].includes(response.status)) throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected this Login Key or its command permissions.')
        throw new HostingError('UPSTREAM_HTTP_ERROR', `DirectAdmin returned HTTP ${response.status}. No redirects or retries were followed.`)
      }
      const raw = await boundedText(response)
      if (/^\s*(?:<!doctype\s+html|<html|<head|<body|<script)/i.test(raw) || /You cannot execute that command/i.test(raw))
        throw new HostingError('ACCESS_DENIED', 'DirectAdmin returned a login page or command permission error instead of data.')
      return raw
    } catch (error) {
      if (error instanceof HostingError) throw error
      throw new HostingError('CONNECTION_FAILED', 'Could not read DirectAdmin within the timeout. Check this server connection and TLS configuration.')
    }
  }

  async listDomains(reference: string | number) {
    const { serverId } = resolveServer(this.settings.accounts, reference)
    const raw = await this.get(serverId, '/CMD_API_SHOW_DOMAINS', {})
    let values: unknown[]
    if (raw.trimStart().startsWith('{') || raw.trimStart().startsWith('[')) {
      let data: any
      try { data = JSON.parse(raw) } catch { throw new HostingError('INVALID_RESPONSE', 'Invalid domain list response from DirectAdmin.') }
      if (data && ['1', 1, true].includes(data.error)) throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected domain listing.')
      values = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : []
      if (!Array.isArray(data) && !Array.isArray(data?.list)) throw new HostingError('INVALID_RESPONSE', 'Unrecognized domain list response from DirectAdmin.')
    } else {
      const data = new URLSearchParams(raw)
      if (data.get('error') === '1') throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected domain listing.')
      values = data.getAll('list[]')
      if (raw.trim() && !data.has('list[]') && !/^list(?:%5b%5d|\[\])?=$/i.test(raw.trim()))
        throw new HostingError('INVALID_RESPONSE', 'Unrecognized domain list response from DirectAdmin.')
    }
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
    const raw = await this.get(serverId, '/CMD_SHOW_LOG', { domain, type: logType === 'access' ? 'log' : 'error', lines: String(requestedLines), json: 'yes' })
    if (/^error=1(?:&|$)/.test(raw.trim())) throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected this log request.')
    if (/^\s*\{/.test(raw)) {
      // Error envelopes must not masquerade as raw log records.
      try { const data = JSON.parse(raw); if (data.error !== undefined) throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected this log request.') } catch (e) { if (e instanceof HostingError) throw e }
    }
    const tail = raw.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').filter((line, i, all) => !(all.length === 1 && line === '')).slice(-requestedLines)
    const knownSecrets = [this.settings.authToken, ...Object.values(this.settings.credentials).map(value => value?.loginKey)].filter((value): value is string => Boolean(value))
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
}

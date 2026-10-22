import type { Settings } from './config.js'
import { HostingError } from './hosting-error.js'

type ReadPath = '/CMD_API_SHOW_USER_USAGE' | '/CMD_API_SHOW_USER_CONFIG' | '/api/resource-usage/latest' | '/api/resource-usage/history'
  | '/api/db-show/databases' | `/api/db-show/databases/${string}`
  | '/CMD_API_SHOW_DOMAINS' | '/CMD_SHOW_LOG' | '/CMD_API_SUBDOMAINS'
  | '/CMD_API_REDIRECT' | '/CMD_API_ADDITIONAL_DOMAINS' | '/CMD_API_DNS_CONTROL'
  | `/api/domain-tls/${string}/acme-config` | `/api/domain-tls/${string}/certs`
  | '/api/wordpress/locations' | '/api/filemanager/list' | '/api/filemanager/download'
  | `/api/wordpress/locations/${string}/wordpress`
export const MAX_RESPONSE_BYTES = 512 * 1024
export type WritePath = '/CMD_API_REDIRECT' | '/CMD_API_DOMAIN' | '/CMD_API_SUBDOMAINS' | '/CMD_API_DNS_CONTROL'

async function boundedBytes(response: Response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new HostingError('RESPONSE_TOO_LARGE', 'Hosting response exceeds the bounded read limit.')
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new HostingError('RESPONSE_TOO_LARGE', 'Hosting response exceeds the bounded read limit.')
      }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks)
}

// Internal provider adapter. Paths are fixed by application code, never tool inputs.
export class DirectAdminTransport {
  constructor(private readonly settings: Settings, private readonly request: typeof fetch = fetch) {}

  async getText(serverId: string, path: ReadPath, params: Record<string, string>) {
    return (await this.read(serverId, path, params, false)).text
  }

  async downloadLog(serverId: string, path: string) {
    return this.read(serverId, '/api/filemanager/download', { path }, true)
  }

  async databaseInfo(serverId: string, database: string) {
    return this.getText(serverId, `/api/db-show/databases/${encodeURIComponent(database)}`, {})
  }

  async wordpressInfo(serverId: string, siteId: string) {
    return this.getText(serverId, `/api/wordpress/locations/${encodeURIComponent(siteId)}/wordpress`, {})
  }

  // Internal only: callers enforce write authorization, allowlists and stored plans.
  // Never retry a POST: a lost response can still mean a completed mutation.
  async postForm(serverId: string, path: WritePath, params: Record<string, string>) {
    const credentials = this.settings.credentials[serverId]
    if (!credentials) throw new HostingError('CREDENTIALS_MISSING', 'Hosting credentials are missing.')
    try {
      const response = await this.request(new URL(path, this.settings.accounts[serverId]!.baseUrl), {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: 'Basic ' + Buffer.from(credentials.username + ':' + credentials.loginKey).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json, application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      })
      if (response.status !== 200) { await response.body?.cancel(); throw new Error('Uncertain provider result') }
      const raw = (await boundedBytes(response)).toString('utf8')
      let result: Record<string, unknown>
      try { result = JSON.parse(raw) } catch { result = Object.fromEntries(new URLSearchParams(raw)) }
      if (result && [0, '0', false].includes(result.error as number | string | boolean)) return
      // Even explicit errors may follow partial provider changes; require reconciliation.
      throw new Error('Provider did not confirm success')
    } catch {
      throw new HostingError('WRITE_OUTCOME_UNKNOWN', 'The provider did not confirm the write. Inspect current state; do not retry blindly.')
    }
  }

  // Fixed ACME settings route only; no certificate/key files, arbitrary verbs or retries.
  async putAcmeConfig(serverId: string, domain: string, config: unknown) {
    const credentials = this.settings.credentials[serverId]
    if (!credentials) throw new HostingError('CREDENTIALS_MISSING', 'Hosting credentials are missing.')
    try {
      const response = await this.request(new URL(`/api/domain-tls/${encodeURIComponent(domain)}/acme-config`, this.settings.accounts[serverId]!.baseUrl), {
        method: 'PUT', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: 'Basic ' + Buffer.from(credentials.username + ':' + credentials.loginKey).toString('base64'),
          'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(config),
      })
      await response.body?.cancel()
      if (response.status !== 204) throw new Error('Uncertain provider result')
    } catch {
      throw new HostingError('WRITE_OUTCOME_UNKNOWN', 'The provider did not confirm the ACME change. Inspect current state; do not retry blindly.')
    }
  }

  private async read(serverId: string, path: ReadPath, params: Record<string, string>, range: boolean) {
    const account = this.settings.accounts[serverId]!, credentials = this.settings.credentials[serverId]
    if (!credentials) throw new HostingError('CREDENTIALS_MISSING', 'Hosting credentials are not configured for this server. Configure its username and Login Key privately.')
    const url = new URL(path, account.baseUrl)
    url.search = new URLSearchParams(params).toString()
    try {
      const response = await this.request(url, {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: 'Basic ' + Buffer.from(credentials.username + ':' + credentials.loginKey).toString('base64'),
          Accept: 'application/json, text/plain, application/x-www-form-urlencoded',
          ...(range ? { Range: `bytes=-${MAX_RESPONSE_BYTES}`, 'Accept-Encoding': 'identity' } : {}),
        },
      })
      if (!response.ok) {
        await response.body?.cancel()
        if ([401, 403].includes(response.status)) throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected this Login Key or its command permissions.')
        if (response.status === 404) throw new HostingError('NOT_FOUND', 'The requested hosting resource is not available.')
        throw new HostingError('UPSTREAM_HTTP_ERROR', `DirectAdmin returned HTTP ${response.status}. No redirects or retries were followed.`)
      }
      if ((!range && response.status !== 200) || (range && ![200, 206].includes(response.status))) {
        await response.body?.cancel()
        throw new HostingError('INVALID_RESPONSE', 'Unexpected hosting response status.')
      }
      let partial = false, expectedBytes: number | undefined
      if (range && response.status === 206) {
        const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
        const [start, end, total] = match ? match.slice(1).map(Number) : []
        if (start === undefined || end === undefined || total === undefined
          || ![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start
          || end !== total - 1 || end - start + 1 > MAX_RESPONSE_BYTES) {
          await response.body?.cancel()
          throw new HostingError('INVALID_RESPONSE', 'Invalid hosting log byte range.')
        }
        partial = start > 0; expectedBytes = end - start + 1
      }
      const bytes = await boundedBytes(response)
      if (expectedBytes !== undefined && bytes.length !== expectedBytes)
        throw new HostingError('INVALID_RESPONSE', 'Incomplete hosting log byte range.')
      // A suffix may begin inside a UTF-8 character or record. Discard that record.
      const complete = partial ? bytes.subarray(bytes.indexOf(10) < 0 ? bytes.length : bytes.indexOf(10) + 1) : bytes
      const text = complete.toString('utf8')
      if (/^\s*(?:<!doctype\s+html|<html|<head|<body|<script)/i.test(text) || /You cannot execute that command/i.test(text))
        throw new HostingError('ACCESS_DENIED', 'DirectAdmin returned a login page or command permission error instead of data.')
      return { text, partial }
    } catch (error) {
      if (error instanceof HostingError) throw error
      throw new HostingError('CONNECTION_FAILED', 'Could not read DirectAdmin within the timeout. Check this server connection and TLS configuration.')
    }
  }
}

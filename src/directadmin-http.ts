import type { Settings } from './config.js'
import { HostingError } from './hosting-error.js'

type ReadPath = '/CMD_API_SHOW_DOMAINS' | '/CMD_SHOW_LOG' | '/CMD_API_SUBDOMAINS'
  | '/api/wordpress/locations' | '/api/filemanager/list' | '/api/filemanager/download'
export const MAX_RESPONSE_BYTES = 512 * 1024

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

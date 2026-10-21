import { z } from 'zod'
import { resolveServer, type Settings } from './config.js'
import { DirectAdminTransport } from './directadmin-http.js'
import { redactLog } from './directadmin.js'
import { HostingError } from './hosting-error.js'

// This is a single fixed account-relative file, never an arbitrary-file API.
const filename = 'log.txt'
const metadataSchema = z.object({
  canonicalPath: z.string(), filesMatched: z.number().int().nonnegative().safe().optional(),
  files: z.array(z.object({ name: z.string(), type: z.string(), symlink: z.boolean(),
    sizeBytes: z.number().int().nonnegative().safe() })).max(10),
})

export class AccountLogClient {
  private readonly transport: DirectAdminTransport
  constructor(private readonly settings: Settings, request: typeof fetch = fetch) {
    this.transport = new DirectAdminTransport(settings, request)
  }

  async readLog(input: { serverId: string | number; lines?: number; contains?: string }) {
    const { serverId } = resolveServer(this.settings.accounts, input.serverId)
    const requestedLines = z.number().int().min(1).max(1000).parse(input.lines ?? 100)
    const contains = z.string().min(1).max(200).optional().parse(input.contains)
    const raw = await this.transport.getText(serverId, '/api/filemanager/list', {
      path: '', query: filename, limit: '10', offset: '0',
    })
    let listing: z.infer<typeof metadataSchema>
    try { listing = metadataSchema.parse(JSON.parse(raw)) }
    catch { throw new HostingError('INVALID_RESPONSE', 'Invalid account log metadata returned by DirectAdmin.') }
    // DirectAdmin represents the account home as ".". Reject other resolved roots.
    if (!['.', ''].includes(listing.canonicalPath))
      throw new HostingError('LOG_PATH_DENIED', 'The account log parent resolved outside the account root.')
    const matches = listing.files.filter(file => file.name === filename)
    if (!matches.length) {
      if ((listing.filesMatched !== undefined && listing.filesMatched > listing.files.length)
        || (listing.filesMatched === undefined && listing.files.length === 10))
        throw new HostingError('INCOMPLETE_METADATA', 'The account log listing is incomplete; absence could not be established.')
      throw new HostingError('LOG_NOT_FOUND', 'No log.txt file was found in this hosting account root.')
    }
    if (matches.length !== 1 || matches[0]!.symlink || matches[0]!.type !== 'file')
      throw new HostingError('LOG_PATH_DENIED', 'Account log reads require a regular file without a symlink.')
    const downloaded = matches[0]!.sizeBytes === 0 ? { text: '', partial: false }
      : await this.transport.downloadLog(serverId, filename)
    try {
      const envelope = JSON.parse(downloaded.text)
      if (envelope && typeof envelope === 'object' && ('error' in envelope
        || ['ACCESS_DENIED', 'NOT_FOUND', 'BAD_REQUEST', 'INTERNAL_ERROR'].includes(envelope.type)))
        throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected this account log read.')
    } catch (error) { if (error instanceof HostingError) throw error }
    const tail = downloaded.text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
      .filter((line, i, all) => !(all.length === 1 && line === '')).slice(-requestedLines)
    const secrets = [this.settings.authToken, this.settings.writeAuthToken, ...Object.values(this.settings.credentials).map(value => value?.loginKey)]
    const selected = tail.filter(line => !contains || line.toLowerCase().includes(contains.toLowerCase())).map(line => {
      for (const secret of secrets) if (secret) line = line.split(secret).join('[REDACTED]')
      return redactLog(line)
    })
    let bytes = 0
    const lines: string[] = []
    for (let i = selected.length - 1; i >= 0; i--) {
      const line = selected[i]!, size = Buffer.byteLength(line) + 1
      if (bytes + size > 64 * 1024) break
      lines.unshift(line); bytes += size
    }
    return { serverId, logType: 'account_log', logName: filename, requestedLines,
      scannedLines: tail.length, returnedLines: lines.length, lines,
      truncated: downloaded.partial || lines.length < selected.length, byteWindowLimited: downloaded.partial,
      filterScope: 'last_requested_lines_within_byte_window', redaction: 'best_effort',
      untrustedContent: true, fetchedAt: new Date().toISOString() }
  }
}

import { z } from 'zod'
import { relativeHostingPath, resolveServer, type Settings } from './config.js'
import { DirectAdminTransport, MAX_RESPONSE_BYTES } from './directadmin-http.js'
import { domainSchema, redactLog } from './directadmin.js'
import { HostingError } from './hosting-error.js'

export const siteIdSchema = z.string().min(1).max(256).refine(value =>
  value !== '.' && value !== '..' && !/[/\\%?#\u0000-\u001f\u007f]/.test(value),
  'Expected an opaque provider site ID without path separators, encoding or control characters')
const wordpressInstanceSchema = z.object({
  version: z.string().max(100), title: z.string().max(500),
  siteURL: z.string().max(2048), template: z.string().max(200), error: z.string().max(8192),
})
const locationSchema = z.object({
  id: siteIdSchema,
  host: domainSchema,
  filePath: z.string().min(1).max(1024),
  webPath: z.string().max(1024),
  wordpress: wordpressInstanceSchema.nullable().optional(),
})
type Location = z.infer<typeof locationSchema>

export class WordPressClient {
  private readonly transport: DirectAdminTransport
  constructor(private readonly settings: Settings, request: typeof fetch = fetch) {
    this.transport = new DirectAdminTransport(settings, request)
  }

  private mask(text: string) {
    for (const secret of [this.settings.authToken, this.settings.writeAuthToken, ...Object.values(this.settings.credentials).map(v => v?.loginKey)]) {
      if (secret) text = text.split(secret).join('[REDACTED]')
    }
    return redactLog(text)
  }

  private async locations(serverId: string): Promise<Location[]> {
    const raw = await this.transport.getText(serverId, '/api/wordpress/locations', {})
    try {
      const locations = z.array(locationSchema).max(2000).parse(JSON.parse(raw))
      if (new Set(locations.map(v => v.id)).size !== locations.length) throw Error('duplicate ID')
      return locations
    } catch { throw new HostingError('INVALID_RESPONSE', 'Invalid WordPress inventory returned by DirectAdmin.') }
  }

  async listSites(input: { serverId: string | number; offset?: number; limit?: number }) {
    const { serverId } = resolveServer(this.settings.accounts, input.serverId)
    const offset = z.number().int().min(0).max(2000).parse(input.offset ?? 0)
    const limit = z.number().int().min(1).max(100).parse(input.limit ?? 50)
    const locations = (await this.locations(serverId)).filter(v => v.wordpress)
      .sort((a, b) => a.id.localeCompare(b.id))
    const sites = locations.slice(offset, offset + limit).map(location => ({
      siteId: location.id, host: location.host, webPath: this.mask(location.webPath),
      title: this.mask(location.wordpress!.title), version: this.mask(location.wordpress!.version),
      diagnosticError: Boolean(location.wordpress!.error),
    }))
    const nextOffset = offset + sites.length < locations.length ? offset + sites.length : null
    return { serverId, sites, offset, limit, total: locations.length, nextOffset,
      source: 'directadmin_wordpress_manager', coverage: 'provider_known_installations', untrustedContent: true }
  }

  private async installedLocation(serverId: string, siteId: string) {
    const location = (await this.locations(serverId)).find(v => v.id === siteId)
    if (!location?.wordpress) throw new HostingError('UNKNOWN_SITE', 'Select an installed WordPress site from list_wordpress_sites on this server.')
    return location
  }

  // Internal export mapping only. Config secrets never leave the transport adapter.
  async databaseForExport(serverId: string, siteId: string) {
    await this.installedLocation(serverId, siteIdSchema.parse(siteId))
    return this.transport.wordpressDatabaseName(serverId, siteId)
  }

  async getInfo(input: { serverId: string | number; siteId: string }) {
    const { serverId } = resolveServer(this.settings.accounts, input.serverId)
    const siteId = siteIdSchema.parse(input.siteId)
    const location = await this.installedLocation(serverId, siteId)
    const raw = await this.transport.wordpressInfo(serverId, siteId)
    let info: z.infer<typeof wordpressInstanceSchema> & { autoUpdateMajor: boolean; autoUpdateMinor: boolean }
    try {
      info = wordpressInstanceSchema.extend({ autoUpdateMajor: z.boolean(), autoUpdateMinor: z.boolean() }).parse(JSON.parse(raw))
    } catch { throw new HostingError('INVALID_RESPONSE', 'Invalid WordPress details returned by DirectAdmin.') }
    let siteURL: string | null = null
    try {
      const url = new URL(info.siteURL)
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
        url.search = ''; url.hash = ''; siteURL = this.mask(url.href)
      }
    } catch { /* Broken installations may not report a valid site URL. */ }
    return { serverId, siteId, host: location.host, webPath: this.mask(location.webPath),
      title: this.mask(info.title), version: this.mask(info.version), template: this.mask(info.template), siteURL,
      autoUpdates: { major: info.autoUpdateMajor, minor: info.autoUpdateMinor },
      diagnosticError: Boolean(info.error), source: 'directadmin_wordpress_manager',
      untrustedContent: true, fetchedAt: new Date().toISOString() }
  }

  async readLog(input: { serverId: string | number; siteId: string; lines?: number; contains?: string }) {
    const { serverId } = resolveServer(this.settings.accounts, input.serverId)
    const siteId = siteIdSchema.parse(input.siteId)
    const requestedLines = z.number().int().min(1).max(1000).parse(input.lines ?? 100)
    const contains = z.string().min(1).max(200).optional().parse(input.contains)
    const inspected = await this.inspectLog(serverId, siteId)
    if (!inspected.file) throw new HostingError('LOG_NOT_FOUND', 'No existing WordPress log was found at the configured location. Logging may be disabled or use a different path.')
    const downloaded = inspected.file.sizeBytes === 0 ? { text: '', partial: false }
      : await this.transport.downloadLog(serverId, inspected.logPath)
    return this.logResult(serverId, siteId, requestedLines, contains, downloaded)
  }

  async getLogInfo(input: { serverId: string | number; siteId: string }) {
    const { serverId } = resolveServer(this.settings.accounts, input.serverId)
    const siteId = siteIdSchema.parse(input.siteId)
    const { file, customPath } = await this.inspectLog(serverId, siteId)
    return { serverId, siteId, logType: 'wordpress_debug', exists: Boolean(file),
      state: file ? (file.sizeBytes === 0 ? 'empty' : 'present') : 'missing',
      sizeBytes: file?.sizeBytes ?? null, modifiedAt: file?.modifyTime ?? null,
      pathSource: customPath ? 'private_site_configuration' : 'standard_wordpress_path',
      requiresRangeForBoundedRead: file ? file.sizeBytes > MAX_RESPONSE_BYTES : null,
      rangeSupport: 'unverified', debugEnabled: 'unknown', contentRead: false,
      fetchedAt: new Date().toISOString() }
  }

  private async inspectLog(serverId: string, siteId: string) {
    const account = this.settings.accounts[serverId]!
    const roots = account.wordpressLogRoots ?? []
    if (!roots.length) throw new HostingError('WORDPRESS_LOGS_DISABLED', 'WordPress log reads require explicit wordpressLogRoots configuration for this account.')
    // Refresh provider ownership/installation data on every read; never accept caller paths.
    const location = await this.installedLocation(serverId, siteId)
    const root = relativeHostingPath.safeParse(location.filePath)
    if (!root.success || !roots.some(value => root.data === value || root.data.startsWith(value + '/')))
      throw new HostingError('LOG_PATH_DENIED', 'The installation is outside the configured WordPress log roots.')
    const logPath = account.wordpressLogPaths?.[siteId] ?? `${root.data}/wp-content/debug.log`
    if (!relativeHostingPath.safeParse(logPath).success || !logPath.endsWith('.log')
      || !roots.some(value => logPath.startsWith(value + '/')))
      throw new HostingError('LOG_PATH_DENIED', 'The configured WordPress log is outside the allowed roots.')
    const parts = logPath.split('/'), filename = parts.pop()!, parent = parts.join('/')
    // Require a canonical, unchanged parent and a regular, non-symlink log file.
    // Provider metadata and download are separate operations, not an atomic filesystem lock.
    const raw = await this.transport.getText(serverId, '/api/filemanager/list', {
      path: parent, query: filename, limit: '10', offset: '0',
    })
    let listing: { canonicalPath: string; filesMatched?: number; files: { name: string; type: string; symlink: boolean; sizeBytes: number; modifyTime?: string }[] }
    try {
      listing = z.object({ canonicalPath: z.string(), filesMatched: z.number().int().nonnegative().safe().optional(), files: z.array(z.object({
        name: z.string(), type: z.string(), symlink: z.boolean(), sizeBytes: z.number().int().nonnegative().safe(),
        modifyTime: z.string().datetime({ offset: true }).optional(),
      })).max(10) }).parse(JSON.parse(raw))
    } catch { throw new HostingError('INVALID_RESPONSE', 'Invalid WordPress log metadata returned by DirectAdmin.') }
    if (listing.canonicalPath !== parent) throw new HostingError('LOG_PATH_DENIED', 'The WordPress log parent resolved to a different path.')
    const matches = listing.files.filter(v => v.name === filename)
    if (!matches.length && ((listing.filesMatched !== undefined && listing.filesMatched > listing.files.length)
      || (listing.filesMatched === undefined && listing.files.length === 10)))
      throw new HostingError('INCOMPLETE_METADATA', 'The provider file listing is incomplete; WordPress log presence could not be established.')
    if (matches.length > 1 || matches[0]?.symlink || (matches[0] && matches[0].type !== 'file'))
      throw new HostingError('LOG_PATH_DENIED', 'WordPress log reads require a regular file without a symlink.')
    return { logPath, file: matches[0], customPath: Boolean(account.wordpressLogPaths?.[siteId]) }
  }

  private logResult(serverId: string, siteId: string, requestedLines: number, contains: string | undefined,
    downloaded: { text: string; partial: boolean }) {
    // Do not present API error envelopes as log records.
    try {
      const envelope = JSON.parse(downloaded.text)
      if (envelope && typeof envelope === 'object' && ('error' in envelope
        || ['ACCESS_DENIED', 'NOT_FOUND', 'BAD_REQUEST', 'INTERNAL_ERROR'].includes(envelope.type)))
        throw new HostingError('ACCESS_DENIED', 'DirectAdmin rejected this WordPress log read.')
    } catch (error) { if (error instanceof HostingError) throw error }
    const tail = downloaded.text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
      .filter((v, i, all) => !(all.length === 1 && v === '')).slice(-requestedLines)
    const selected = tail.filter(line => !contains || line.toLowerCase().includes(contains.toLowerCase())).map(line => this.mask(line))
    let bytes = 0
    const lines: string[] = []
    for (let i = selected.length - 1; i >= 0; i--) {
      const line = selected[i]!, size = Buffer.byteLength(line) + 1
      if (bytes + size > 64 * 1024) break
      lines.unshift(line); bytes += size
    }
    return { serverId, siteId, logType: 'wordpress_debug', requestedLines, scannedLines: tail.length,
      returnedLines: lines.length, truncated: downloaded.partial || lines.length < selected.length,
      byteWindowLimited: downloaded.partial, filterScope: 'last_requested_lines_within_byte_window',
      redaction: 'best_effort', untrustedContent: true, fetchedAt: new Date().toISOString(), lines }
  }
}

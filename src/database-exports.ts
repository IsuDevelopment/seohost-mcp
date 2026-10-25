import { constants } from 'node:fs'
import { mkdir, lstat, open, readdir, realpath, rm, rename } from 'node:fs/promises'
import { resolve, join, isAbsolute } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { z } from 'zod'
import { resolveServer, type Settings } from './config.js'
import type { AccessContext } from './auth.js'
import { HostingError } from './hosting-error.js'
import { AccountDiagnostics, databaseName } from './account-diagnostics.js'
import { DirectAdminTransport } from './directadmin-http.js'
import { WordPressClient, siteIdSchema } from './wordpress.js'

export const MAX_EXPORT_BYTES = 100 * 1024 * 1024
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
const TTL = 60 * 60 * 1000
const MAX_FILES = 10
export const exportIdSchema = z.string().regex(/^[a-f0-9]{48}$/)
const manifestSchema = z.object({ serverId: z.string().max(64), actor: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive(), sizeBytes: z.number().int().positive().max(MAX_EXPORT_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const activeRoots = new Set<string>()
const cleanupTasks = new Map<string, Promise<void>>()
const actorHash = (actor: string) => createHash('sha256').update(actor).digest('hex')
const notFound = () => new HostingError('EXPORT_NOT_FOUND', 'The export is unavailable, expired or belongs to a different caller.')

// Private single-process artifact store, shared across stateless HTTP tool instances.
// The installation owner controls the directory and its parents; never use a web root.
export class DatabaseExports {
  constructor(private readonly settings: Settings, private readonly request: typeof fetch = fetch) {}

  private async root() {
    const configured = this.settings.databaseExportDirectory
    if (!configured || !isAbsolute(configured))
      throw new HostingError('EXPORTS_DISABLED', 'Configure an absolute private MCP_DATABASE_EXPORT_DIRECTORY outside the web root.')
    const root = resolve(configured)
    await mkdir(root, { recursive: true, mode: 0o700 })
    const stat = await lstat(root)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
      || (process.getuid && stat.uid !== process.getuid()) || await realpath(root) !== root)
      throw new HostingError('EXPORT_STORAGE_UNSAFE', 'Export storage must be a private owner-controlled directory without symlink parents.')
    return root
  }

  private async metadata(directory: string) {
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw notFound()
    const file = await open(join(directory, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) !== 0) throw notFound()
      return manifestSchema.parse(JSON.parse(await file.readFile('utf8')))
    } finally { await file.close() }
  }

  private async prune(root: string) {
    const entries = await readdir(root, { withFileTypes: true })
    if (entries.length > 100) throw new HostingError('EXPORT_STORAGE_FULL', 'Export storage requires operator cleanup.')
    let retained = 0
    for (const entry of entries) {
      if (!exportIdSchema.safeParse(entry.name).success || !entry.isDirectory()) continue
      const directory = join(root, entry.name)
      let expired = false
      try { expired = (await this.metadata(directory)).expiresAt <= Date.now() }
      catch { expired = (await lstat(directory)).mtimeMs + TTL <= Date.now() }
      if (expired) await rm(directory, { recursive: true })
      else retained++
    }
    return retained
  }

  async cleanup() {
    if (!this.settings.databaseExportDirectory) return
    const root = await this.root()
    if (activeRoots.has(root)) return
    const existing = cleanupTasks.get(root)
    if (existing) return existing
    const task = this.prune(root).then(() => {})
    cleanupTasks.set(root, task)
    try { await task } finally { cleanupTasks.delete(root) }
  }

  // Local artifact housekeeping only, never provider polling. Unref permits clean shutdown.
  startCleanup() {
    const clean = () => { void this.cleanup().catch(() => console.error('Database export cleanup failed; check private storage')) }
    clean()
    const timer = setInterval(clean, 60_000)
    timer.unref()
    return () => clearInterval(timer)
  }

  async create(input: { serverId: string | number; siteId?: string; database?: string }, access: AccessContext) {
    const { serverId, account } = resolveServer(this.settings.accounts, input.serverId)
    if (!account.databaseExports) throw new HostingError('EXPORTS_DISABLED', 'Database exports must be explicitly enabled for this account.')
    if (Boolean(input.siteId) === Boolean(input.database))
      throw new HostingError('INVALID_SELECTION', 'Choose exactly one installed siteId or account-owned database.')
    if (input.siteId !== undefined) siteIdSchema.parse(input.siteId)
    if (input.database !== undefined) databaseName.parse(input.database)
    const root = await this.root()
    // Housekeeping is not a competing export. Wait for it before atomically
    // taking the export reservation; real concurrent exports still fail busy.
    try { while (cleanupTasks.has(root)) await cleanupTasks.get(root) }
    catch { throw new HostingError('EXPORT_FAILED', 'Private export housekeeping did not complete safely.') }
    if (activeRoots.has(root)) throw new HostingError('EXPORT_BUSY', 'Another database export is in progress. Try again after it completes.')
    activeRoots.add(root)
    let directory: string | undefined
    let providerResponse: Response | undefined
    try {
      if (await this.prune(root) >= MAX_FILES) throw new HostingError('EXPORT_STORAGE_FULL', 'Ten retained exports already exist. Wait for expiry or clean up privately.')
      const transport = new DirectAdminTransport(this.settings, this.request)
      const database = databaseName.parse(input.database ?? await new WordPressClient(this.settings, this.request).databaseForExport(serverId, input.siteId!))
      // Refresh database ownership even when a WordPress configuration named it.
      await new AccountDiagnostics(this.settings, this.request).databaseInfo(serverId, database)
      const exportId = randomBytes(24).toString('hex')
      directory = join(root, exportId)
      await mkdir(directory, { mode: 0o700 })
      const response = providerResponse = await transport.databaseExport(serverId, database)
      if (!response.body) throw new HostingError('INVALID_RESPONSE', 'The database export was empty.')
      const length = response.headers.get('content-length')
      if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_EXPORT_BYTES)) {
        await response.body.cancel()
        throw new HostingError('EXPORT_TOO_LARGE', 'The compressed database export exceeds 100 MiB or has an invalid length.')
      }
      const hash = createHash('sha256')
      let sizeBytes = 0
      const part = join(directory, 'export.part')
      const file = await open(part, 'wx', 0o600)
      const reader = response.body.getReader()
      async function* chunks() {
        try {
          while (true) {
            const part = await reader.read()
            if (part.done) return
            sizeBytes += part.value.byteLength
            if (sizeBytes > MAX_EXPORT_BYTES) throw new HostingError('EXPORT_TOO_LARGE', 'The compressed database export exceeds 100 MiB.')
            hash.update(part.value)
            yield part.value
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      }
      try {
        await pipeline(Readable.from(chunks()), file.createWriteStream(), { signal: AbortSignal.timeout(120_000) })
      } finally { await file.close() }
      if (sizeBytes === 0 || (length !== null && Number(length) !== sizeBytes))
        throw new HostingError('INVALID_RESPONSE', 'The database export was empty or incomplete.')
      // Verify gzip CRC/trailer and bound decompression; never return decompressed SQL.
      const compressed = await open(part, constants.O_RDONLY | constants.O_NOFOLLOW)
      let expanded = 0
      try {
        await pipeline(compressed.createReadStream(), createGunzip(), new Writable({
          write(chunk: Buffer, _encoding, callback) {
            expanded += chunk.length
            callback(expanded > MAX_EXPANDED_BYTES ? new HostingError('EXPORT_TOO_LARGE', 'Expanded database export exceeds 1 GiB.') : undefined)
          },
        }), { signal: AbortSignal.timeout(30_000) })
      } finally { await compressed.close() }
      if (!expanded) throw new HostingError('INVALID_RESPONSE', 'The database export contained no data.')
      const manifest = { serverId, actor: actorHash(access.actor), expiresAt: Date.now() + TTL, sizeBytes, sha256: hash.digest('hex') }
      await rename(part, join(directory, 'export.sql.gz'))
      const metadata = await open(join(directory, 'manifest.json'), 'wx', 0o600)
      try { await metadata.writeFile(JSON.stringify(manifest)) } finally { await metadata.close() }
      return { serverId, ...(input.siteId ? { siteId: input.siteId } : {}), database, exportId,
        filename: `${exportId}.sql.gz`, sizeBytes, sha256: manifest.sha256, expiresAt: new Date(manifest.expiresAt).toISOString(),
        downloadUrl: new URL(`/exports/${exportId}`, this.settings.publicUrl).href, downloadAuthentication: 'same_caller_bearer_header',
        ...(access.actor === 'stdio-owner' ? { localPath: join(directory, 'export.sql.gz') } : {}),
        scope: 'entire_database', consistency: 'provider_export_no_cross_file_snapshot_guarantee',
        warning: 'Includes all tables in the database, including other installations or multisite sites sharing it. Contains sensitive data. Not a complete site backup.' }
    } catch (error) {
      await providerResponse?.body?.cancel().catch(() => {})
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => console.error('Database export partial cleanup failed; check private storage'))
      if (error instanceof HostingError) throw error
      throw new HostingError('EXPORT_FAILED', 'The export could not be safely completed. No artifact was published; no SQL or provider diagnostics are returned.')
    } finally { activeRoots.delete(root) }
  }

  async download(exportId: string, access: AccessContext) {
    exportIdSchema.parse(exportId)
    const root = await this.root(), directory = join(root, exportId)
    try {
      const manifest = await this.metadata(directory)
      if (manifest.actor !== actorHash(access.actor) || !this.settings.accounts[manifest.serverId]?.databaseExports) throw notFound()
      if (manifest.expiresAt <= Date.now()) {
        await rm(directory, { recursive: true }); throw notFound()
      }
      const file = await open(join(directory, 'export.sql.gz'), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size !== manifest.sizeBytes || (stat.mode & 0o077) !== 0) throw notFound()
      } catch (error) { await file.close(); throw error }
      return { file, ...manifest, filename: `${exportId}.sql.gz` }
    } catch { throw notFound() }
  }
}

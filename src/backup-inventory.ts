import { z } from 'zod'
import { resolveServer, type Settings } from './config.js'
import { DirectAdminTransport } from './directadmin-http.js'
import { fingerprint } from './domain-dns.js'
import { HostingError } from './hosting-error.js'

const listingSchema = z.object({ canonicalPath: z.string(), filesMatched: z.number().int().nonnegative().safe(),
  files: z.array(z.object({ name: z.string().min(1).max(255), type: z.string(), symlink: z.boolean(),
    sizeBytes: z.number().int().nonnegative().safe(), modifyTime: z.string().datetime({ offset: true }).optional() })).max(100) })
export class BackupInventory {
  private readonly transport: DirectAdminTransport
  constructor(private readonly settings: Settings, request: typeof fetch = fetch) { this.transport = new DirectAdminTransport(settings, request) }
  async list(reference: string | number, rootIndex = 0, offset = 0, limit = 50) {
    const { serverId, account } = resolveServer(this.settings.accounts, reference)
    rootIndex = z.number().int().min(0).max(4).parse(rootIndex)
    offset = z.number().int().min(0).max(10000).parse(offset); limit = z.number().int().min(1).max(100).parse(limit)
    const root = account.backupRoots?.[rootIndex]
    if (!root) throw new HostingError('BACKUP_ROOTS_DISABLED', 'Configure narrow private backupRoots for this account; callers cannot choose filesystem paths.')
    const raw = await this.transport.getText(serverId, '/api/filemanager/list', { path: root, limit: String(limit), offset: String(offset) })
    let listing: z.infer<typeof listingSchema>
    try { listing = listingSchema.parse(JSON.parse(raw)) } catch { throw new HostingError('INVALID_RESPONSE', 'Invalid backup file metadata returned by DirectAdmin.') }
    if (listing.canonicalPath !== root) throw new HostingError('BACKUP_PATH_DENIED', 'The backup directory resolved to a different path.')
    if (new Set(listing.files.map(file=>file.name)).size !== listing.files.length || listing.files.length > limit
      || listing.filesMatched < offset + listing.files.length && listing.files.length > 0)
      throw new HostingError('INVALID_RESPONSE', 'Backup listing counts or entries are inconsistent.')
    if (listing.files.length === 0 && offset < listing.filesMatched)
      throw new HostingError('INCOMPLETE_METADATA', 'The provider omitted entries; backup absence cannot be established.')
    const archives = listing.files.filter(file => file.type === 'file' && !file.symlink
      && /^[a-zA-Z0-9_.-]+\.(?:zip|tar|tar\.gz|tgz|gz|sql|sql\.gz)$/i.test(file.name)).map(file => ({
        backupId: fingerprint({ serverId, root, file }), filename: file.name, sizeBytes: file.sizeBytes, modifiedAt: file.modifyTime ?? null,
      }))
    const next = offset + listing.files.length < listing.filesMatched ? offset + listing.files.length : null
    const paginationLimitReached = next !== null && next > 10000
    return { serverId, rootIndex, configuredRootCount: account.backupRoots!.length, archives, offset, limit,
      scannedEntries: listing.files.length, totalDirectoryEntries: listing.filesMatched,
      nextOffset: paginationLimitReached ? null : next, paginationLimitReached,
      coverage: 'archive_candidates_in_one_configured_directory_page', backupIntegrity: 'unverified', restoreTested: false,
      contentsRead: false, untrustedContent: true }
  }
}

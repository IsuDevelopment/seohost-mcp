import { z } from 'zod'
import { resolveServer, type Settings } from './config.js'
import { DirectAdminTransport } from './directadmin-http.js'
import { HostingError } from './hosting-error.js'

const number = z.number().finite().nonnegative()
const count = number.int().safe()
export const databaseName = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_][a-zA-Z0-9_$-]*$/)
const databaseEntry = z.object({ database: databaseName, sizeBytes: count, tableCount: count, userCount: count, definerIssues: count })
const metadata = databaseEntry.extend({ defaultCharset: z.string().max(100).regex(/^[a-zA-Z0-9_]+$/),
  defaultCollation: z.string().max(100).regex(/^[a-zA-Z0-9_]+$/), eventCount: count, routineCount: count, triggerCount: count, viewCount: count })
const metricFields = { tasks: number, cpuRate: number, cpuPressureRate: number, memoryBytes: number, memoryPressureRate: number,
  diskReadBytesPerSec: number, diskReadOpsPerSec: number, diskWriteBytesPerSec: number, diskWriteOpsPerSec: number, diskPressureRate: number }
const limits = z.object({ tasks: number, cpuRate: number, memoryHighBytes: number, memoryMaxBytes: number,
  diskReadBytesPerSec: number, diskReadOpsPerSec: number, diskWriteBytesPerSec: number, diskWriteOpsPerSec: number })
const latest = z.object({ limits, metrics: z.object(metricFields) })
const seriesFields = Object.fromEntries(Object.keys(metricFields).map(key => [key, z.array(number.nullable()).max(240).optional()])) as {
  [K in keyof typeof metricFields]: z.ZodOptional<z.ZodArray<z.ZodNullable<z.ZodNumber>>>
}
const history = z.object({ limits, timestamps: z.array(count).max(240), ...seriesFields })
const parse = <T>(schema: z.ZodType<T>, raw: string): T => {
  try { return schema.parse(JSON.parse(raw)) }
  catch { throw new HostingError('INVALID_RESPONSE', 'Invalid diagnostic metadata returned by DirectAdmin.') }
}
const legacy = (raw: string) => {
  const values = [...new URLSearchParams(raw)]
  if (!values.length || new Set(values.map(([key]) => key)).size !== values.length || values.some(([key]) => key === 'error' || !/^[a-zA-Z0-9_]+$/.test(key)))
    throw new HostingError('INVALID_RESPONSE', 'Invalid account statistics returned by DirectAdmin.')
  return Object.fromEntries(values)
}
const numeric = (value: string | undefined) => value !== undefined && /^\d+(?:\.\d+)?$/.test(value)
  && Number.isFinite(Number(value)) && Number(value) <= Number.MAX_SAFE_INTEGER ? Number(value) : null
const flag = (value: string | undefined) => value === 'yes' || value === 'ON' ? true : value === 'no' || value === 'OFF' ? false : null

export class AccountDiagnostics {
  readonly transport: DirectAdminTransport
  constructor(private readonly settings: Settings, request: typeof fetch = fetch) { this.transport = new DirectAdminTransport(settings, request) }
  async usage(reference: string | number) {
    const { serverId } = resolveServer(this.settings.accounts, reference)
    const used = legacy(await this.transport.getText(serverId, '/CMD_API_SHOW_USER_USAGE', {}))
    const config = legacy(await this.transport.getText(serverId, '/CMD_API_SHOW_USER_CONFIG', {}))
    if (numeric(used.quota) === null || numeric(used.bandwidth) === null
      || !['quota','bandwidth'].every(key => config[key] === 'unlimited' || numeric(config[key]) !== null))
      throw new HostingError('INVALID_RESPONSE', 'Account disk/bandwidth usage could not be verified.')
    const fields = { quota: 'MiB', bandwidth: 'MiB', inode: 'count', vdomains: 'count', nsubdomains: 'count', mysql: 'count', nemails: 'count', ftp: 'count' }
    const resources = Object.entries(fields).map(([name, unit]) => {
      const usage = numeric(used[name]), base = config[name] === 'unlimited' ? 'unlimited' : numeric(config[name])
      const extra = name === 'bandwidth' && config.additional_bandwidth !== undefined ? numeric(config.additional_bandwidth) : 0
      const limit = typeof base === 'number' ? (extra !== null && base + extra <= Number.MAX_SAFE_INTEGER ? base + extra : null) : base
      const percent = usage !== null && typeof limit === 'number' && limit > 0 ? Math.round(usage / limit * 10000) / 100 : null
      return { name, unit, used: usage, limit, percent, nearLimit: percent === null ? null : percent >= 90 }
    })
    return { serverId, resources, suspended: flag(config.suspended), enabled: flag(config.account),
      source: 'directadmin_account_tally', freshness: 'provider_tally_not_live_filesystem_measurement', fetchedAt: new Date().toISOString() }
  }
  async resources(reference: string | number, hours?: number, points = 60, aggregation: 'avg' | 'max' = 'max') {
    const { serverId } = resolveServer(this.settings.accounts, reference)
    if (hours === undefined) return { serverId, ...parse(latest, await this.transport.getText(serverId, '/api/resource-usage/latest', {})),
      source: 'directadmin_user_resource_metrics', cpuUnit: 'cores', zeroLimit: 'provider_reports_no_limit', fetchedAt: new Date().toISOString() }
    hours = z.number().int().min(1).max(168).parse(hours)
    points = z.number().int().min(1).max(240).parse(points)
    aggregation = z.enum(['avg', 'max']).parse(aggregation)
    const to = new Date(), from = new Date(to.getTime() - hours * 3600000)
    const data = parse(history, await this.transport.getText(serverId, '/api/resource-usage/history', {
      from: from.toISOString(), to: to.toISOString(), agg: aggregation, n: String(points),
    }))
    for (const key of Object.keys(metricFields)) {
      const values = data[key as keyof typeof metricFields]
      if (values && values.length !== data.timestamps.length)
        throw new HostingError('INVALID_RESPONSE', 'Resource series lengths do not match provider timestamps.')
    }
    return { serverId, ...data, requestedFrom: from.toISOString(), requestedTo: to.toISOString(), aggregation,
      source: 'directadmin_user_resource_metrics', timestampUnit: 'provider_native', cpuUnit: 'cores', zeroLimit: 'provider_reports_no_limit' }
  }
  private async inventory(serverId: string) {
    const values = parse(z.array(databaseEntry).max(2000), await this.transport.getText(serverId, '/api/db-show/databases', { 'no-size': 'false' }))
    if (new Set(values.map(value => value.database)).size !== values.length)
      throw new HostingError('INVALID_RESPONSE', 'Database inventory contains duplicate names.')
    return values.sort((a, b) => a.database.localeCompare(b.database))
  }
  async databases(reference: string | number, offset = 0, limit = 50) {
    const { serverId } = resolveServer(this.settings.accounts, reference)
    offset = z.number().int().min(0).max(2000).parse(offset); limit = z.number().int().min(1).max(100).parse(limit)
    const data = await this.inventory(serverId), databases = data.slice(offset, offset + limit)
    return { serverId, databases, total: data.length, offset, limit, nextOffset: offset + databases.length < data.length ? offset + databases.length : null,
      source: 'directadmin_account_databases', siteMapping: 'not_inferred', untrustedContent: true }
  }
  async databaseInfo(reference: string | number, input: string) {
    const { serverId } = resolveServer(this.settings.accounts, reference), database = databaseName.parse(input)
    if (!(await this.inventory(serverId)).some(value => value.database === database))
      throw new HostingError('DATABASE_NOT_ON_SERVER', 'Select a database from list_databases on this account.')
    const info = parse(metadata, await this.transport.databaseInfo(serverId, database))
    if (info.database !== database) throw new HostingError('INVALID_RESPONSE', 'Database metadata does not match the selected database.')
    return { serverId, ...info, source: 'directadmin_database_metadata', contentsRead: false, untrustedContent: true }
  }
}

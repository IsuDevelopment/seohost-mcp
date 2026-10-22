import { DirectAdminClient, redactLog } from './directadmin.js'
import type { Settings } from './config.js'

const timestamp = (line: string) => line.match(/\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}/)?.[0]
  ?? line.match(/\[([^\]]*\d{2}:\d{2}:\d{2}[^\]]*)\]/)?.[1] ?? null
const patterns: [string, RegExp][] = [
  ['php_fatal', /PHP (?:Fatal|Parse) error|Uncaught (?:\w*Error|\w*Exception)|Allowed memory size.*exhausted/i],
  ['php_warning', /PHP Warning:/i], ['php_notice_or_deprecation', /PHP (?:Notice|Deprecated):/i],
  ['waf', /ModSecurity|mod_security/i], ['missing_file', /File not found|No such file or directory/i],
  ['directory_listing_denied', /Auto Index is disabled/i], ['request_aborted', /Abort request processing|abort.*LSAPI/i],
  ['timeout', /timed?\s*out|timeout/i], ['other', /./],
]
// Example messages are diagnostic excerpts, not raw log lines or instructions.
const safeExample = (line: string) => redactLog(line.match(/PHP (?:Fatal|Parse) error:[\s\S]*/i)?.[0] ?? line)
  .replace(/\/home\/[^/\s]+/g, '[account-home]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[IP]')
  .replace(/\[[^\]]*(?:client|remote)[^\]]*\]/gi, '[client]').slice(0,400)

export class LogSummaryClient {
  private readonly hosting: DirectAdminClient
  constructor(settings: Settings, request: typeof fetch = fetch) { this.hosting = new DirectAdminClient(settings, request) }
  async summarize(input: { serverId: string | number; domain: string; logType: 'access' | 'error'; lines?: number }) {
    // One bounded log fetch; do not fetch once per severity or lose rare fatal entries in top-N groups.
    const log = await this.hosting.readWebLogForSummary({ ...input, lines: input.lines ?? 500 })
    const base = { serverId: log.serverId, domain: log.domain, logType: log.logType, requestedLines: log.requestedLines,
      analyzedLines: log.returnedLines, scannedLines: log.scannedLines, truncated: log.truncated,
      coverage: 'bounded_returned_tail_not_complete_history', fetchedAt: log.fetchedAt, untrustedContent: true }
    if (input.logType === 'access') {
      const statuses: Record<string, number> = {}, paths = new Map<string, number>()
      let parsed = 0, serverErrors = 0, clientErrors = 0
      for (const line of log.lines) {
        const match = line.match(/"([A-Z]+) ([^\s"]+) HTTP\/[0-9.]+" ([1-5]\d\d) /)
        if (!match) continue
        parsed++; const status = Number(match[3]); statuses[status] = (statuses[status] ?? 0) + 1
        if (status >= 500) serverErrors++; else if (status >= 400) clientErrors++
        // Paths only; omit query/fragment, authority, headers and all IP/user identities.
        let path = match[2]!.split(/[?#]/)[0]!
        if (/^https?:\/\//i.test(path)) { try { path = new URL(path).pathname } catch { continue } }
        if (!path.startsWith('/') || path.length > 300) continue
        path = redactLog(path).replace(/[a-f0-9]{24,}/gi, '[opaque-id]'); paths.set(path, (paths.get(path) ?? 0) + 1)
      }
      return { ...base, parsedRequests: parsed, unparsedLines: log.lines.length - parsed, statuses, serverErrors, clientErrors,
        topPaths: [...paths].sort((a, b) => b[1] - a[1]).slice(0,10).map(([path, count]) => ({ path, count })),
        firstTimestamp: log.lines.length ? timestamp(log.lines[0]!) : null, lastTimestamp: log.lines.length ? timestamp(log.lines.at(-1)!) : null,
        timestampTimezone: 'provider_log_not_inferred' }
    }
    const categories = new Map<string, { category: string; lineCount: number; firstTimestamp: string | null; lastTimestamp: string | null }>()
    const wafRules = new Map<string, number>(), fatalExamples: string[] = []
    for (const line of log.lines) {
      const category = patterns.find(([, pattern]) => pattern.test(line))?.[0] ?? 'other', time = timestamp(line)
      const found = categories.get(category) ?? { category, lineCount: 0, firstTimestamp: time, lastTimestamp: time }
      found.lineCount++; if (time) found.lastTimestamp = time; categories.set(category, found)
      for (const id of line.matchAll(/\[id\s+"(\d{1,12})"\]/g)) wafRules.set(id[1]!, (wafRules.get(id[1]!) ?? 0) + 1)
      if (category === 'php_fatal' && fatalExamples.length < 5) fatalExamples.push(safeExample(line))
    }
    return { ...base, categories: [...categories.values()].sort((a, b) => patterns.findIndex(v=>v[0]===a.category) - patterns.findIndex(v=>v[0]===b.category)),
      fatalLines: categories.get('php_fatal')?.lineCount ?? 0, fatalExamples,
      wafRules: [...wafRules].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([ruleId, matchedLines])=>({ruleId, matchedLines})),
      counting: 'matching_log_lines_not_distinct_incidents', timestampTimezone: 'provider_log_not_inferred',
      interpretation: 'heuristic_classification_not_uptime_or_infection_proof' }
  }
}

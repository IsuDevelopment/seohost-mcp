import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const envName = z.string().regex(/^[A-Z][A-Z0-9_]*$/)
export const writeOperations = ['create_domain', 'create_subdomain', 'add_dns_record', 'update_dns_record', 'delete_dns_record', 'set_free_certificate', 'set_https_redirect', 'add_redirect', 'delete_redirect'] as const
export type WriteOperation = typeof writeOperations[number]
export const relativeHostingPath = z.string().min(1).max(1024).refine(value =>
  value.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'),
  'Expected a normalized path relative to the hosting account home')
const accountSchema = z.object({
  label: z.string().min(1).max(100),
  aliases: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)).max(20).default([]),
  baseUrl: z.string().url().refine(value => {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash
  }, 'Expected an HTTPS origin without credentials or path'),
  usernameEnv: envName,
  loginKeyEnv: envName,
  writeOperations: z.array(z.enum(writeOperations)).max(writeOperations.length).optional(),
  dnsNameservers: z.array(z.string().max(253).transform(value => value.toLowerCase().replace(/\.$/, ''))
    .refine(value => value.includes('.') && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)), 'Expected an exact nameserver hostname')).max(10).optional(),
  backupRoots: z.array(relativeHostingPath).max(5).optional(),
  wordpressLogRoots: z.array(relativeHostingPath).max(20).optional(),
  wordpressLogPaths: z.record(z.string().min(1).max(256), relativeHostingPath.refine(value => value.endsWith('.log'),
    'Explicit WordPress log paths must end in .log')).optional(),
}).strict()
const fileSchema = z.object({
  servers: z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), accountSchema),
}).strict()
export type Account = z.infer<typeof accountSchema>
export interface Settings {
  host: string
  port: number
  publicUrl: URL
  accounts: Record<string, Account>
  credentials: Record<string, { username: string; loginKey: string } | undefined>
  authToken?: string
  writeAuthToken?: string
  changeStateFile?: string
  oauth?: { issuer: string; audience: string; subjects: string[] }
  localOAuth?: import('./local-oauth.js').LocalOAuthConfig
  allowedOrigins: Set<string>
}

export async function loadSettings(env: NodeJS.ProcessEnv = process.env, http = true): Promise<Settings> {
  const accounts = fileSchema.parse(JSON.parse(await readFile(env.MCP_CONFIG_FILE || 'config/servers.example.json', 'utf8'))).servers
  validateServerAliases(accounts)
  const credentials: Settings['credentials'] = Object.create(null)
  for (const [id, account] of Object.entries(accounts)) {
    const username = env[account.usernameEnv], loginKey = env[account.loginKeyEnv]
    if (username && loginKey) {
      if (username.includes(':') || /[\r\n]/.test(username + loginKey)) throw new Error('Invalid hosting credentials')
      credentials[id] = { username, loginKey }
    }
  }
  const publicUrl = new URL(env.MCP_PUBLIC_URL || 'http://127.0.0.1:3000/mcp')
  if (publicUrl.pathname !== '/mcp' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
    throw new Error('MCP_PUBLIC_URL must end in /mcp without credentials, query or fragment')
  }
  const localHosts = ['localhost', '127.0.0.1', '[::1]']
  if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && localHosts.includes(publicUrl.hostname))) {
    throw new Error('Public MCP endpoints require HTTPS')
  }
  const port = z.coerce.number().int().min(0).max(65535).parse(env.PORT || '3000')
  const authToken = env.MCP_AUTH_TOKEN || undefined
  if (authToken && authToken.length < 32) throw new Error('MCP_AUTH_TOKEN must contain at least 32 characters')
  const writeAuthToken = env.MCP_WRITE_AUTH_TOKEN || undefined
  if (writeAuthToken && (writeAuthToken.length < 32 || writeAuthToken === authToken)) throw new Error('The write token must be distinct and at least 32 characters')
  const issuer = env.MCP_OAUTH_ISSUER || undefined
  const audience = env.MCP_OAUTH_AUDIENCE || undefined
  const subjects = (env.MCP_OAUTH_SUBJECTS || '').split(',').map(x => x.trim()).filter(Boolean)
  let oauth: Settings['oauth']
  if (issuer || audience || subjects.length) {
    if (!issuer || !audience || !subjects.length) throw new Error('OAuth requires issuer, audience and explicit allowed subjects')
    const issuerUrl = new URL(issuer)
    if (issuerUrl.protocol !== 'https:' || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) throw new Error('Invalid OAuth issuer')
    if (audience !== publicUrl.href) throw new Error('OAuth audience must equal MCP_PUBLIC_URL')
    oauth = { issuer: issuer.replace(/\/?$/, '/'), audience, subjects }
  }
  let localOAuth: Settings['localOAuth']
  if (env.MCP_LOCAL_OAUTH === 'true') {
    const passwordHash = env.MCP_OWNER_PASSWORD_HASH || ''
    const redirects = (env.MCP_OAUTH_REDIRECT_URIS || '').split(',').filter(Boolean)
    if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash) || !env.MCP_OWNER_USERNAME || !redirects.length) throw new Error('Local OAuth requires owner credentials and explicit redirect URIs')
    for (const uri of redirects) { const u = new URL(uri); if (u.protocol !== 'https:' || u.hash || u.username || u.password) throw new Error('Redirect URIs must use HTTPS') }
    if (oauth) throw new Error('Select local or external OAuth')
    localOAuth = { file: env.MCP_OAUTH_STATE_FILE || 'data/oauth.sqlite', passwordHash, username: env.MCP_OWNER_USERNAME, redirects,
      allowWrites: Object.values(accounts).some(account => account.writeOperations?.length) }
  }
  if (http && !authToken && !writeAuthToken && !oauth && !localOAuth) throw new Error('Configure MCP_AUTH_TOKEN or OAuth before starting HTTP')
  const allowedOrigins = new Set([publicUrl.origin])
  for (const value of (env.MCP_ALLOWED_ORIGINS || '').split(',').filter(Boolean)) {
    const url = new URL(value.trim())
    if (url.origin !== value.trim() || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid allowed origin')
    allowedOrigins.add(url.origin)
  }
  return { host: env.HOST || '127.0.0.1', port, publicUrl, accounts, credentials, authToken, writeAuthToken,
    changeStateFile: env.MCP_CHANGE_STATE_FILE || 'data/changes.sqlite', oauth, localOAuth, allowedOrigins }
}

export function normalizeServerReference(value: string | number): string {
  return String(value).normalize('NFKC').trim().toLowerCase().replace(/^(?:server|serwer)[\s:-]+/, '')
}

export function serverReferences(id: string, account: Account): string[] {
  return [...new Set([id, ...account.aliases, ...(/^h\d+$/.test(id) ? [id.slice(1)] : [])])]
}

export function validateServerAliases(accounts: Record<string, Account>) {
  const references = new Map<string, string>()
  for (const [id, account] of Object.entries(accounts)) {
    for (const alias of serverReferences(id, account)) {
      const key = normalizeServerReference(alias)
      if (references.has(key) && references.get(key) !== id) throw new Error('Ambiguous server alias in configuration')
      references.set(key, id)
    }
  }
}

export function resolveServer(accounts: Record<string, Account>, reference: string | number) {
  const normalized = normalizeServerReference(reference)
  const matches = Object.entries(accounts).filter(([id, account]) => serverReferences(id, account).some(v => normalizeServerReference(v) === normalized))
  if (matches.length !== 1) throw new Error('Unknown or ambiguous server. Call list_servers and select a configured serverId.')
  return { serverId: matches[0]![0], account: matches[0]![1] }
}

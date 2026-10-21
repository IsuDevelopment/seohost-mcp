import { resolveServer, type Settings } from './config.js'

// Configuration requirements only. This catalog never probes provider permissions.
export const TOOL_REQUIREMENTS = {
  get_server_info: { credentials: false, wordpressLogs: false },
  list_servers: { credentials: false, wordpressLogs: false },
  resolve_server: { credentials: false, wordpressLogs: false },
  get_server_capabilities: { credentials: false, wordpressLogs: false },
  list_domains: { credentials: true, wordpressLogs: false },
  list_subdomains: { credentials: true, wordpressLogs: false },
  read_web_log: { credentials: true, wordpressLogs: false },
  read_account_log: { credentials: true, wordpressLogs: false },
  list_wordpress_sites: { credentials: true, wordpressLogs: false },
  get_wordpress_info: { credentials: true, wordpressLogs: false },
  get_wordpress_log_info: { credentials: true, wordpressLogs: true },
  read_wordpress_log: { credentials: true, wordpressLogs: true },
} as const
export const TOOL_NAMES = Object.keys(TOOL_REQUIREMENTS)

export function getServerCapabilities(settings: Settings, reference: string | number) {
  const { serverId } = resolveServer(settings.accounts, reference)
  const credentialsConfigured = Boolean(settings.credentials[serverId])
  const wordpressLogRootsConfigured = Boolean(settings.accounts[serverId]!.wordpressLogRoots?.length)
  const tools = Object.entries(TOOL_REQUIREMENTS).map(([name, requirements]) => {
    const missingConfiguration: string[] = []
    if (requirements.credentials && !credentialsConfigured) missingConfiguration.push('hosting_credentials')
    if (requirements.wordpressLogs && !wordpressLogRootsConfigured) missingConfiguration.push('wordpress_log_roots')
    return { name, configurationReady: missingConfiguration.length === 0, missingConfiguration,
      providerPermission: requirements.credentials ? 'unverified' : 'not_applicable', readOnly: true }
  })
  return { serverId, credentialsConfigured, wordpressLogRootsConfigured,
    source: 'installation_configuration', providerContacted: false,
    authorizationModel: 'single_owner_all_configured_accounts', hostingWritesEnabled: false, tools }
}

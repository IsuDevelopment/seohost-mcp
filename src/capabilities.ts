import { resolveServer, type Settings } from './config.js'

// Configuration requirements only. This catalog never probes provider permissions.
export const TOOL_REQUIREMENTS = {
  plan_wordpress_stage: {credentials:true,wordpressLogs:false,write:true,stage:true},
  apply_wordpress_stage: {credentials:true,wordpressLogs:false,write:true,stage:true},
  get_wordpress_stage: {credentials:false,wordpressLogs:false,write:true},
  get_server_info: { credentials: false, wordpressLogs: false },
  list_servers: { credentials: false, wordpressLogs: false },
  resolve_server: { credentials: false, wordpressLogs: false },
  get_server_capabilities: { credentials: false, wordpressLogs: false },
  get_account_usage: { credentials: true, wordpressLogs: false },
  get_resource_usage: { credentials: true, wordpressLogs: false },
  list_databases: { credentials: true, wordpressLogs: false },
  get_database_info: { credentials: true, wordpressLogs: false },
  export_database: { credentials: true, wordpressLogs: false, databaseExport: true },
  summarize_web_log: { credentials: true, wordpressLogs: false },
  list_backup_files: { credentials: true, wordpressLogs: false, backupMetadata: true },
  list_domains: { credentials: true, wordpressLogs: false },
  list_subdomains: { credentials: true, wordpressLogs: false },
  read_web_log: { credentials: true, wordpressLogs: false },
  read_account_log: { credentials: true, wordpressLogs: false },
  get_domain_info: { credentials: true, wordpressLogs: false },
  list_redirects: { credentials: true, wordpressLogs: false },
  get_tls_info: { credentials: true, wordpressLogs: false },
  list_dns_records: { credentials: true, wordpressLogs: false },
  check_dns: { credentials: true, wordpressLogs: false },
  plan_hosting_change: { credentials: true, wordpressLogs: false, write: true },
  apply_hosting_change: { credentials: true, wordpressLogs: false, write: true },
  get_hosting_change: { credentials: false, wordpressLogs: false, write: true },
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
    if ('stage' in requirements && (!settings.accounts[serverId]!.wordpressProvisioning || !settings.localOAuth || !settings.accounts[serverId]!.writeOperations?.includes('create_wordpress_stage') || !settings.accounts[serverId]!.writeOperations?.includes('create_subdomain'))) missingConfiguration.push('wordpress_provisioning')
    if ('backupMetadata' in requirements && !settings.accounts[serverId]!.backupRoots?.length) missingConfiguration.push('backup_roots')
    if ('databaseExport' in requirements) {
      if (!settings.accounts[serverId]!.databaseExports) missingConfiguration.push('account_database_exports')
      if (!settings.databaseExportDirectory) missingConfiguration.push('database_export_directory')
    }
    if ('write' in requirements && !['get_hosting_change','get_wordpress_stage'].includes(name) && !settings.accounts[serverId]!.writeOperations?.length) missingConfiguration.push('account_write_operations')
    return { name, configurationReady: missingConfiguration.length === 0, missingConfiguration,
      providerPermission: requirements.credentials ? 'unverified' : 'not_applicable',
      requiredScope: 'write' in requirements ? 'mcp:write' : 'mcp:read',
      readOnly: !['plan_hosting_change', 'apply_hosting_change', 'get_hosting_change', 'export_database'].includes(name) }
  })
  return { serverId, credentialsConfigured, wordpressLogRootsConfigured,
    source: 'installation_configuration', providerContacted: false,
    authorizationModel: 'single_owner_all_configured_accounts', hostingWritesEnabled: Boolean(settings.accounts[serverId]!.writeOperations?.length),
    enabledWriteOperations: settings.accounts[serverId]!.writeOperations ?? [],
    backupRootsConfigured: Boolean(settings.accounts[serverId]!.backupRoots?.length),
    dnsWriteAuthorityConfigured: Boolean(settings.accounts[serverId]!.dnsNameservers?.length), tools }
}

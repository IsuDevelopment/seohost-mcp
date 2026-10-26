# SeoHost MCP

MCP integration with read-only defaults and reviewed domain/DNS/TLS changes for **standard SeoHost shared hosting** accounts using
DirectAdmin.

Version 0.18.0: a standalone TypeScript/Node.js server with HTTP and stdio transports,
Bearer and built-in OAuth authentication, domain/subdomain and WordPress inventory,
account/database/backup metadata diagnostics, opt-in private database exports, owner-confirmed fresh WordPress staging, single-read log summaries,
bounded reads of web-server logs, account-root `log.txt` and existing WordPress debug logs,
plus local/public DNS diagnostics and separately authorized domain/DNS changes, free certificate automation, HTTPS enforcement and site redirect rules.

## Hosting scope

This project targets account-level features of standard SeoHost shared hosting.
It does not provide VPS provisioning, root access or operating-system administration.
**VPS compatibility has not been tested.** DirectAdmin can also be available on a
VPS, but equivalent endpoint availability and permissions must be verified for that
installation; having a VPS alone does not establish compatibility.
See [SeoHost's explanation of hosting panels](https://seohost.pl/pomoc/panel-klienta-directadmin).

The bundled deployment workflow targets an existing CloudLinux Node.js application
on shared hosting. It does not provision a server or constitute a generic VPS
deployment procedure. Individual hosting reads still require configured Login Keys
and separately verified permissions.

## Working with Codex and Claude

Start with [AGENTS.md](AGENTS.md) and the [agent context](.agents/README.md).
Both agents share the code map, architecture, decisions and project status.
Review this context for every change; update affected documents in the same commit.
Write project documentation and agent instructions in English.
See the [AI capability catalog](.agents/CAPABILITIES.md) for tools and development operations.

## Getting started

```sh
nvm use
npm ci
npm run setup:local
npm run check
npm start
```

Test the running HTTP server with `npm run smoke`. Available tools:
`get_server_info`, `list_servers`, `resolve_server`, `get_server_capabilities`,
`get_account_usage`, `get_resource_usage`, `list_databases`, `get_database_info`,
`list_backup_files`, `summarize_web_log`, `list_domains`, `list_subdomains`, `list_wordpress_sites`, `get_wordpress_info`,
`get_wordpress_log_info`, `read_account_log`, `read_web_log`, `read_wordpress_log`,
`get_domain_info`, `get_tls_info`, `list_redirects`, `list_dns_records`, `check_dns`, `plan_hosting_change`,
`apply_hosting_change`, `get_hosting_change`, `export_database`,
`plan_wordpress_stage`, `apply_wordpress_stage` and `get_wordpress_stage`.
See [logs, aliases and key setup](docs/LOGS.md),
[WordPress inventory and logs](docs/WORDPRESS.md) and
[configuration and deployment](docs/DEPLOYMENT.md). MIT license.

To verify live domain/subdomain lists and access/error log reads for one explicit
account/domain, use `npm run smoke:hosting -- --server primary --domain example.com`.
It reports counts/status without printing logs; see [hosting verification](docs/LOGS.md#verify-live-hosting-reads).

[Diagnostics](docs/DIAGNOSTICS.md) distinguish loaded configuration readiness from
unverified provider permissions and inspect WordPress details/log metadata safely.
[Account/log/database/backup diagnostics](docs/HOSTING-DIAGNOSTICS.md) add compact
read-only troubleshooting tools; CPU/RAM metrics and Softaculous access remain
provider-dependent. Backup file metadata needs private roots and does not prove
backup integrity.

[Database exports](docs/DATABASE-EXPORTS.md) save an entire owned database as a
private gzip file, with actor-authenticated one-hour downloads and a local download
helper. Enable per account and configure private storage outside web roots. No SQL
is returned in chat; native WordPress mapping is optional and provider-dependent.
[Staging/promotion requirements](docs/WORDPRESS-MIGRATIONS.md) record the next
workflow: fresh confirmation per operation and retained DB/files backups before
overwrite. [Fresh WordPress staging](docs/WORDPRESS-STAGE.md) now implements new
subdomain + separate DB + pinned core via a fixed local WP-CLI adapter and separate
owner-login approval. Clone/promotion and general CLI operations remain unavailable.

Domain/subdomain creation and individual DNS record edits use expiring previews,
separate write authorization and per-account operation allowlists. Existing read
tokens remain read-only. See [domain/DNS workflow](docs/DOMAIN-DNS.md) and [certificates/HTTPS](docs/TLS.md).
Certificate automation and redirects are parent-wide, including subdomains. Agents
can chain them after explicitly requested creation; pending issuance delays HTTPS.
[Site redirects](docs/REDIRECTS.md) support reads and planned add/delete operations
with explicit 301/302/303 codes. Editing uses separate delete/add plans; partial
failure is reported, with no assumed overwrite or automatic rollback.

## Deployment

Each installation needs its own configuration and authentication. Hosting tools
require separate Login Keys for the selected accounts. Account configuration,
secrets and OAuth state remain private.

[GitHub Actions: checks and SSH deployment](docs/GITHUB-ACTIONS.md).
Deployment is started manually from `main`; it backs up the previous code,
restarts one application and checks HTTPS.

For built-in OAuth without an external identity provider, see
[setup and limitations](docs/OAUTH.md).
Setup command: `npm run setup:oauth -- .env.production`.

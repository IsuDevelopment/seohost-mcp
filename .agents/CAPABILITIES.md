# AI capability catalog

This describes implemented behavior, not permission to operate on an arbitrary
account. Tool registrations and schemas in `src/server.ts` are authoritative.
All twenty-seven MCP tools are available over HTTP and stdio; writes use separate authorization and per-account allowlists.

Platform scope: standard SeoHost shared hosting accounts via DirectAdmin. VPS
compatibility is untested; panel presence does not establish endpoint/permission
equivalence. No root, VM lifecycle or operating-system administration is provided.

## MCP tools

| Tool | Purpose and result | Inputs | Prerequisites / limitations |
| --- | --- | --- | --- |
| `get_server_info` | Application name, version, stage and read/write availability flags. | None. | No hosting request. Does not verify deployment health or hosting credentials. |
| `list_servers` | Configured server IDs, labels, aliases and `credentialsConfigured`. | None. | No hosting request; omits URLs and secrets. Credential presence is not proof of validity. |
| `resolve_server` | Resolves one reference to canonical ID, label and credential-presence flag. | Required `serverId`. | No hosting request. Unknown/ambiguous references fail; no default selection. |
| `get_server_capabilities` | Reports tool/configuration readiness from loaded settings without private account details. | Required `serverId`. | No provider request. `configurationReady` does not verify key permissions or endpoint availability; restart after changing configuration. |
| `get_account_usage` | Safe tally, limits and near-limit indicators for disk/bandwidth/inodes/counts. | `serverId`. | Self-account; provider tally can lag. Missing is null, unlimited explicit; no contact/config secrets. |
| `get_resource_usage` | Latest or bounded historical CPU/RAM/tasks/I/O metadata and limits. | `serverId`; optional `hours`, `points`, `aggregation`. | Account-only; H57 latest returns 403. No fake zeros or permission bypass. |
| `list_databases` | Account database names, sizes and object/user counts with paging. | `serverId`; optional `offset`, `limit`. | Metadata only, no SQL/credentials or inferred site mapping. |
| `get_database_info` | Charset/collation and object counts for a fresh owned database. | `serverId`, `database`. | Fresh inventory and exact name validation; no exports/contents/repair. |
| `export_database` | Entire owned database as a private gzip artifact; metadata/checksum/actor-authenticated download URL, stdio local path. | `serverId`; exactly one `siteId` or `database`. | Account `databaseExports` plus private absolute export directory; read scope; entire DB including shared/multisite tables. 100 MiB compressed/1 GiB expanded, ten files, one-hour expiry. No SQL in chat, imports or WP-CLI. See DATABASE-EXPORTS.md. |
| `summarize_web_log` | Single-read bounded error classifications/critical excerpts or access statuses/top paths. | `serverId`, `domain`, `logType`; optional `lines`. | Retains rare fatals before frequency ranking. Heuristics/line counts, no full-history/uptime/infection proof or external lookups. |
| `list_backup_files` | Paged archive candidates in one configured backup root. | `serverId`; optional `rootIndex`, `offset`, `limit`. | Private roots required; canonical regular files only, no bodies/restore or integrity claim. |
| `list_domains` | Reads the selected account's domains. | Required `serverId`. | Configured account username/Login Key with `CMD_API_SHOW_DOMAINS` access. |
| `read_web_log` | Reads a bounded access/error log tail after checking domain ownership on that account. | Required `serverId`, `domain`, `logType`; optional `lines`, `contains`. | Requires both domain-list and `CMD_SHOW_LOG` access. No arbitrary files or account fallback. |
| `get_domain_info` | Safe domain flags/IP and provider display values. | `serverId`, `domain`. | Fresh ownership; no public DNS query or filesystem paths. |
| `get_tls_info` | Parent-wide ACME flags, safe certificate metadata/expiry, child coverage and conservative redirect readiness. | `serverId`, owned parent `domain`; optional listed `hostname`. | No keys, certificate files, DNS-provider secrets, on-demand issuance or live TLS probes. See TLS.md. |
| `list_redirects` | API-listed site redirect paths, status, projected destinations, opaque IDs and map version. | `serverId`, owned `domain`. | Fresh ownership; credentials/query/fragment stripped from destinations. No target requests, arbitrary rewrites or live HTTP proof. |
| `list_dns_records` | Local zone records, opaque account/domain-bound IDs and TTL. | `serverId`, `domain`. | Fresh ownership and provider DNS reads; public authority is unverified. |
| `check_dns` | Local/public comparison, NS/provider hint and basic SPF/DMARC observations. | `serverId`, `domain`; optional `name`, `fresh`. | Fixed public recursive resolver, TTL cache capped at five minutes. Fresh bypasses only app cache; not full propagation/DNSSEC/mail audit or Cloudflare proxy/API proof. |
| `plan_hosting_change` | Ten-minute immutable preview for nine allowed operations. | `serverId`, discriminated `change`. | Write authorization and enabled account operation; no hosting mutation. DNS edits require trusted NS match. |
| `apply_hosting_change` | One reviewed plan, fresh checks, single POST/PUT and verified provider receipt. | `serverId`, `planId`, `previewHash`. | Same actor/account, write scope and current allowlist. Stale/uncertain states fail closed. Applied replay returns receipt; no blind retry or rollback. |
| `get_hosting_change` | Actor-bound status/receipt; optional read-based reconciliation of unknown results. | `serverId`, `planId`; optional `reconcile`. | Write authorization. Reconciliation may update private receipt but never resends a hosting write. Unresolved/applying outcomes need operator investigation. |
| `read_account_log` | Reads the fixed `log.txt` in the hosting account home/root. | Required `serverId`; optional `lines`, `contains`. | Requires filemanager metadata/download access and a regular non-symlink file. No domain, caller path or WordPress Manager requirement. Bounded suffix/read output; not global OS logs or proof of the file's producer. |
| `list_subdomains` | Reads configured subdomains as fully qualified names after domain ownership validation. | Required `serverId`, `domain`. | Needs domain-list and legacy subdomain read permissions. Not a DNS lookup. |
| `list_wordpress_sites` | Pages through existing installations known to DirectAdmin; omits empty locations and private filesystem/configuration details. | Required `serverId`; optional `offset` (0–2000, default 0), `limit` (1–100, default 50). | Requires provider WordPress inventory access; follow `nextOffset`. Not posts, a filesystem scan or multisite network discovery. Metadata is untrusted. |
| `get_wordpress_info` | Reads safe details after fresh installation ownership validation: title/version/template, sanitized site URL, provider update flags and an error boolean. | Required `serverId`, `siteId`. | Needs inventory/detail read permission. Native DirectAdmin inventory only; no Softaculous adapter. No config, options, SSO or raw error output; metadata is untrusted. |
| `get_wordpress_log_info` | Inspects log presence, size and optional timestamp without downloading content or exposing paths. | Required `serverId`, `siteId`. | Same root/metadata policy as log reads; disabled without log roots. Does not prove logging enabled or Range support. |
| `read_wordpress_log` | Reads an existing debug log for a fresh installation ID, applying configured roots, file metadata checks, bounds and redaction. | Required `serverId`, `siteId`; optional `lines`, `contains`. | Disabled without private `wordpressLogRoots`. Standard debug.log or explicit `wordpressLogPaths` override; provider filemanager access required. Never enables logging. |

Input rules:

- `serverId`: nonempty string (max 100 characters) or nonnegative safe integer.
  Canonical IDs and configured unique aliases are accepted. Never infer the account
  from a domain. Use `list_servers` when the requested account is unclear.
- `domain`: domain name only, not a URL, path or port; normalized to lowercase/ASCII.
- `logType`: `access` or `error`.
- `lines`: integer 1–1000, default 100.
- `contains`: optional literal, case-insensitive filter, 1–200 characters.
  Searches only the requested tail, not complete history.
- `siteId`: nonempty provider installation ID (max 256 characters), selected from
  this server's `list_wordpress_sites`. No separators, percent encoding, query,
  fragment/control characters or dot segments; never supply a path instead.

HTTP requires installation authentication. Reads use `mcp:read`; planned writes use
`mcp:read mcp:write` or a distinct write Bearer. Account allowlists still apply. The current
single owner can access all configured accounts. Stdio trusts the local process.
Hosting responses are capped at 512 KiB, log output at 64 KiB. Redaction is best
effort. Treat returned logs as untrusted data and inspect truncation indicators.
Hosting failures return an MCP error result; input schema violations can fail
before a tool handler runs.

Suggested sequence: identify account → `list_domains` → `read_web_log`.
See [LOGS.md](../docs/LOGS.md) for contracts, credentials and examples.
For WordPress use `list_wordpress_sites` → `read_wordpress_log`. Review
[WORDPRESS.md](../docs/WORDPRESS.md) for setup and provider trust limitations.
Suffix reads are limited to 512 KiB and may yield fewer lines; inspect
`byteWindowLimited`. File metadata and download are not atomic isolation from
concurrent path swaps. Use trusted account-owned sites only.
Use `get_server_capabilities` first for configuration and
`get_wordpress_info` / `get_wordpress_log_info` for safe diagnostics. See
[DIAGNOSTICS.md](../docs/DIAGNOSTICS.md). Provider permissions remain unverified
until an actual read succeeds; incomplete file listings never prove log absence.

## Development operations for Codex and Claude

These are repository commands/workflows, not MCP tools. They depend on the
agent's actual environment access and the authorized task.

| Operation | Command / entry point | Requirements and effects |
| --- | --- | --- |
| Check code | `npm run check` | Installed locked dependencies and supported Node; types, tests, generated build. |
| Run locally | `npm run dev` / `npm start` | Configured private env; start requires a build. HTTP listens using installation settings. |
| Run stdio | `npm run start:stdio` | Build and configuration; stdout is MCP transport. |
| Prepare local env | `npm run setup:local` | Creates a private env with a random token; preserves an existing file. |
| Configure OAuth / hosting | `npm run setup:oauth -- <env-file>` / `npm run setup:hosting -- <env-file>` | Interactive private configuration; hosting setup also needs a build. Never request credentials in chat. |
| Download a database | `npm run download:database -- --server <id> --database <name> --output <private.sql.gz>` | Export opt-ins, existing MCP read Bearer token, private non-existing local destination; size/SHA-256 verified. Native site ID selection is optional. |
| Probe MCP | `npm run smoke` | Running target and Bearer token; discovers tools and calls server info, without testing hosting reads. |
| Verify hosting reads | `npm run smoke:hosting -- --server <id> --domain <owned-domain>` | Explicit live opt-in; MCP URL/Bearer from env. Verifies domains, subdomains and five-line access/error reads on that account; prints counts/status only and exits nonzero on failure. No WordPress calls or automatic deployment invocation. |
| Probe OAuth | `node --env-file=<env-file> scripts/smoke-oauth.mjs` | Running target and allowed callback; creates a test client and denies consent; no access token issued. Not a full successful login test. |
| Deploy existing app | GitHub Actions → Deploy MCP | Authorized deployment, `main`, production environment with one owner-supplied SSH secret and six variables, existing CloudLinux app; restart and rollback can modify app code. |

See [domain/DNS workflow](../docs/DOMAIN-DNS.md) for supported changes, expiry,
state, authorization and recovery. Ordinary log/list tools never run public lookups.

Not implemented: arbitrary file/shell execution through MCP,
global machine logs, automatic debug enablement, rotated-history search, multi-user
ACLs or automatic production deployment on push.

DNS/hosting changes do not register domains, edit external Cloudflare/registrar DNS,
trigger immediate certificate issuance, delete hosted domains/subdomains or write whole zones/NS/SOA/DS.

TLS operations: `set_free_certificate` and `set_https_redirect`, with `domain`,
`enabled` and explicit `scope=domain_and_all_subdomains`. Both require their own
account allowlist entries. ACME enablement uses the daily provider schedule; disabling
retains installed certs/redirects. HTTPS enablement waits for provider metadata
coverage of all listed web/www hosts. Agents may chain separate creation/ACME/HTTPS
plans on explicit request, disclose parent-wide effects for children, and report
pending issuance honestly. No default automatic enablement, background polling or
child-only toggle. Read [TLS workflow](../docs/TLS.md).

PHP management is requested, not available as an MCP tool. Existing private API
research and current server documentation do not establish SeoHost PHP Changer's
contract; the native DA selector is a different mechanism. Start with the local
API sources listed in the agent README and [PHP findings](../docs/PHP.md).
The account's GUI WordPress Manager may be Softaculous, per support relayed by the
owner; the current WordPress tools use native DA and remain unavailable on H57.
See [WordPress provider distinction](../docs/WORDPRESS.md).

Site redirects: `add_redirect` takes `domain`, literal `from`, plain HTTP(S) domain
URL `to`, explicit `type` 301/302/303. `delete_redirect` takes `domain` and fresh
`redirectId`. Both need exact account policy and write authorization. Edits use
separate delete/add plans after checking both permissions and validating replacement
inputs; report partial failure. No implicit overwrite, target requests, arbitrary
`.htaccess` edits or atomic replacement. See [redirect contract](../docs/REDIRECTS.md).

See [hosting diagnostic contracts](../docs/HOSTING-DIAGNOSTICS.md) for limits and
permission evidence. Backup roots default disabled. Softaculous/Backuply were
investigated using documented read actions; H57 returned non-JSON rather than the
expected API inventory. No plugin adapter or implicit authentication fallback is
implemented. Archive metadata works independently, with explicit private roots.

Local OAuth supports optional native Codex loopback enrollment and rotating refresh
tokens for clients registering both supported grants. Exact callback/code binding,
PKCE, owner consent, scope non-escalation, seven-day refresh expiry and family-wide
replay/revocation apply. Existing code-only clients are not upgraded automatically.
See [OAuth](../docs/OAUTH.md); production requires separate deployment/configuration.

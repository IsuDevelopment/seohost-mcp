# AI capability catalog

This describes implemented behavior, not permission to operate on an arbitrary
account. Tool registrations and schemas in `src/server.ts` are authoritative.
All eight MCP tools are available over HTTP and stdio.

## MCP tools

| Tool | Purpose and result | Inputs | Prerequisites / limitations |
| --- | --- | --- | --- |
| `get_server_info` | Application name, version, stage and read/write availability flags. | None. | No hosting request. Does not verify deployment health or hosting credentials. |
| `list_servers` | Configured server IDs, labels, aliases and `credentialsConfigured`. | None. | No hosting request; omits URLs and secrets. Credential presence is not proof of validity. |
| `resolve_server` | Resolves one reference to canonical ID, label and credential-presence flag. | Required `serverId`. | No hosting request. Unknown/ambiguous references fail; no default selection. |
| `list_domains` | Reads the selected account's domains. | Required `serverId`. | Configured account username/Login Key with `CMD_API_SHOW_DOMAINS` access. |
| `read_web_log` | Reads a bounded access/error log tail after checking domain ownership on that account. | Required `serverId`, `domain`, `logType`; optional `lines`, `contains`. | Requires both domain-list and `CMD_SHOW_LOG` access. No arbitrary files or account fallback. |
| `list_subdomains` | Reads configured subdomains as fully qualified names after domain ownership validation. | Required `serverId`, `domain`. | Needs domain-list and legacy subdomain read permissions. Not a DNS lookup. |
| `list_wordpress_sites` | Pages through existing installations known to DirectAdmin; omits empty locations and private filesystem/configuration details. | Required `serverId`; optional `offset` (0–2000, default 0), `limit` (1–100, default 50). | Requires provider WordPress inventory access; follow `nextOffset`. Not posts, a filesystem scan or multisite network discovery. Metadata is untrusted. |
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
  this server's `list_wordpress_sites`. Never supply a filesystem path instead.

HTTP requires installation authentication. OAuth uses `mcp:read`; the current
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
| Probe MCP | `npm run smoke` | Running target and Bearer token; discovers tools and calls server info, without testing hosting reads. |
| Probe OAuth | `node --env-file=<env-file> scripts/smoke-oauth.mjs` | Running target and allowed callback; creates a test client and denies consent; no access token issued. Not a full successful login test. |
| Deploy existing app | GitHub Actions → Deploy MCP | Authorized deployment, `main`, production environment with one owner-supplied SSH secret and six variables, existing CloudLinux app; restart and rollback can modify app code. |

Not implemented: hosting writes, arbitrary file/shell execution through MCP,
global machine logs, automatic debug enablement, rotated-history search, multi-user
ACLs, refresh tokens or automatic production deployment on push.

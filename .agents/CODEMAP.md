# Code map

Navigation by responsibility, not a function or class inventory. Update when
module responsibilities or important flows change; keep this map short.

| File / directory | Responsibility and purpose |
| --- | --- |
| `src/http.ts` | HTTP entry point, Host/Origin checks, health/discovery, authentication, per-request MCP transport and cleanup. |
| `src/stdio.ts` | Local process entry point; stdout reserved for MCP, trusts the process owner. |
| `src/server.ts` | Version, eleven tool registrations, input schemas, MCP results/errors and safe auditing. |
| `src/capabilities.ts` | Shared tool/configuration-requirement catalog and honest configuration-only readiness; smoke tests verify names against the catalog. |
| `src/config.ts` | Validates env/JSON, origins and aliases; resolves explicit accounts without a default account. |
| `src/directadmin.ts` | Domain/subdomain reads, ownership checks and bounded/redacted web-log results. |
| `src/directadmin-http.ts` | Shared account-bound GET transport: credentials, fixed routes, timeout, response caps, redirect refusal and log suffix validation. |
| `src/hosting-error.ts` | Shared safe provider error codes/messages; no raw upstream diagnostics. |
| `src/wordpress.ts` | Provider-known installations, safe details, pagination, shared log inspection/read policy, metadata, bounds and redaction. |
| `src/auth.ts` | Bearer with constant-time hash comparison; external RS256/JWKS JWT, subject and `mcp:read` checks. |
| `src/local-oauth.ts` | Owner OAuth: registration, consent, PKCE, tokens and revocation; private SQLite state. |
| `config/servers.example.json`, `.env.example` | Public templates without real accounts or secrets. |
| `scripts/setup-{local,oauth,hosting}.mjs` | Local setup of private environment files and credentials. |
| `scripts/smoke.mjs`, `scripts/smoke-oauth.mjs` | Real MCP client / OAuth probes against the configured environment. |
| `.github/workflows/check.yml` | Push/PR: locked installation, type checks, tests and build. |
| `.github/workflows/deploy.yml` | Manual deployment from `main`, production environment, SSH with a trusted host key. |
| `deploy/package.sh` | Runtime archive from an explicit allowlist, excluding private configuration. |
| `scripts/check-runtime-dependencies.mjs` | Checks production lockfile graphs and installed versions before copying. |
| `deploy/remote.sh` | Code backup, copy, single-app restart, verification and rollback. |
| `deploy/start.cjs`, `deploy/verify.mjs` | CloudLinux bootstrap with env / HTTPS health and unauthenticated rejection probes. |
| `test/server.test.ts` | HTTP auth, Host/Origin, method/body limits, real HTTP SDK and stdio. |
| `test/directadmin.test.ts` | Account isolation, aliases, domain validation, provider failures, limits, plain/JSON/PHP WordPress credential redaction and SDK. |
| `test/wordpress.test.ts` | Subdomain ownership, installation projection/paging, cross-account IDs, root boundaries, file metadata, suffix ranges, output caps and custom log paths. |
| `test/diagnostics.test.ts` | Configuration-only readiness, catalog/registration agreement, safe detail projection, ID encoding, account isolation and metadata inspection without downloads. |
| `test/oauth.test.ts` | Consent, CSRF, PKCE, single-use codes, shared SQLite, MCP and revocation. |
| `test/deploy.test.ts` | Dependency graph, archive contents, release/rollback and private file preservation. |
| `docs/`, `SECURITY.md` | Operator contracts, setup and security limitations. |
| `AGENTS.md`, `CLAUDE.md`, `.agents/` | Codex/Claude entry points and shared memory; `CAPABILITIES.md` catalogs AI operations, optional `tasks/` holds temporary handoffs. |

## Flows

- HTTP → `loadSettings` → Host/Origin → OAuth/discovery/health or MCP auth →
  new `createMcpServer` + stateless transport → tool → DirectAdmin adapter.
- Stdio → `loadSettings(..., false)` → the same tool server → the same adapter.
- Log → explicit account → fresh domain list for that account → GET `CMD_SHOW_LOG` →
  response bound → tail/filter/redaction → bounded output. No account fallback.
- Subdomains → fresh account domain ownership → legacy subdomain GET → validated FQDNs.
- WordPress → fresh provider inventory → existing installation ID → private root/path
  policy → canonical parent + regular-file metadata → bounded download → redacted tail.
  Metadata and download are separate provider operations, not atomic filesystem isolation.
- WordPress details → fresh inventory ownership → encoded single-ID detail GET →
  safe projection; no configuration, SSO or raw provider diagnostics.
- Log diagnostics → shared inspection policy → missing/empty/present metadata;
  no download. Incomplete listings do not establish absence.
- Capabilities → loaded settings + tool requirement catalog → missing configuration;
  no provider calls, permission checks or implied network success.
- Deploy → check → allowlisted archive → SSH → dependency compatibility → code
  backup → restart → HTTPS + optional Bearer smoke; failure after copying begins → rollback.

`dist/` is generated from TypeScript; do not edit it manually. `node_modules/`,
`data/` and real configuration are installation runtime, not versioned project memory.

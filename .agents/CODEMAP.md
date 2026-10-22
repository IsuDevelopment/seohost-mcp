# Code map

Navigation by responsibility, not a function or class inventory. Update when
module responsibilities or important flows change; keep this map short.

| File / directory | Responsibility and purpose |
| --- | --- |
| `src/http.ts` | HTTP entry point, Host/Origin checks, health/discovery, authenticated actor/write context, per-request MCP transport and cleanup. |
| `src/stdio.ts` | Local process entry point; stdout reserved for MCP, owner write context still subject to account operation policy. |
| `src/server.ts` | Version, twenty tool registrations, input schemas, MCP results/errors and safe auditing. |
| `src/capabilities.ts` | Shared tool/configuration-requirement catalog and honest configuration-only readiness; smoke tests verify names against the catalog. |
| `src/config.ts` | Validates env/JSON, origins, aliases, distinct read/write tokens, account write operations and trusted NS; selects private state files and resolves explicit accounts. |
| `src/directadmin.ts` | Domain/subdomain reads, ownership checks and bounded/redacted web-log results. |
| `src/domain-dns.ts` | Account-owned domain settings, local DNS records/IDs/snapshots and contextual diagnostics. |
| `src/redirects.ts` | Typed legacy site-redirect inventory, opaque selection, secret-safe URL projection, literal input policy and rule-map snapshots. |
| `src/tls.ts` | Owned parent-domain ACME/certificate metadata, safe projections, secret-preserving config snapshots and conservative all-web-host redirect readiness. |
| `src/public-dns.ts` | Fixed-origin public recursive DNS observations, TTL cache, NS/provider hints; no lookups in log/list flows. |
| `src/hosting-changes.ts` | Validated operation previews/apply/reconciliation, write gates, stale checks, provider verification and no blind retries. |
| `src/change-store.ts` | Private persistent SQLite previews, actor binding, account reservations and receipts across stateless MCP requests. |
| `src/account-log.ts` | Fixed account-root `log.txt` policy, file metadata checks and bounded/redacted reads independent of WordPress. |
| `src/directadmin-http.ts` | Shared account-bound GET and fixed form-POST/ACME-PUT transport: credentials, fixed routes, timeout, response caps, redirect refusal and log suffix validation. |
| `src/hosting-error.ts` | Shared safe provider error codes/messages; no raw upstream diagnostics. |
| `src/wordpress.ts` | Provider-known installations, safe details, pagination, shared log inspection/read policy, metadata, bounds and redaction. |
| `src/auth.ts` | Distinct read/write Bearer contexts; external RS256/JWKS JWT, subject and scope checks. |
| `src/local-oauth.ts` | Owner OAuth: registration, scope-specific consent, PKCE, tokens and revocation; private SQLite state. |
| `config/servers.example.json`, `.env.example` | Public templates without real accounts or secrets. |
| `scripts/setup-{local,oauth,hosting}.mjs` | Local setup of private environment files and credentials. |
| `scripts/smoke.mjs`, `scripts/smoke-oauth.mjs` | Real MCP client / OAuth probes against the configured environment. |
| `scripts/smoke-hosting.mjs` | Explicit account/domain live verification of domain/subdomain lists and five-line access/error reads; prints counts/status only. |
| `.github/workflows/check.yml` | Push/PR: locked installation, type checks, tests and build. |
| `.github/workflows/deploy.yml` | Manual deployment from `main`, production environment, SSH with a trusted host key. |
| `deploy/package.sh` | Runtime archive from an explicit allowlist, excluding private configuration. |
| `scripts/check-runtime-dependencies.mjs` | Checks production lockfile graphs and installed versions before copying. |
| `deploy/remote.sh` | Code backup, copy, single-app restart, verification and rollback. |
| `deploy/start.cjs`, `deploy/verify.mjs` | CloudLinux bootstrap with env / HTTPS health and unauthenticated rejection probes. |
| `test/server.test.ts` | HTTP auth, Host/Origin, method/body limits, real HTTP SDK and stdio. |
| `test/directadmin.test.ts` | Account isolation, aliases, domain validation, provider failures, limits, plain/JSON/PHP WordPress credential redaction and SDK. |
| `test/domain-dns.test.ts`, `test/hosting-changes.test.ts` | Provider projection, contextual DNS/cache/failure handling, scopes/allowlists, stale/actor/expiry checks, exact record selectors, replay/uncertainty and concurrent reservations. |
| `test/redirects.test.ts` | Typed decoding, secret projection, exact delete/add edits, authorization, stale/full-state checks, uncertainty/replay and SDK discovery. |
| `test/tls.test.ts` | Parent-wide scope/write gates, config-secret preservation, certificate coverage/date checks, stale state, PUT uncertainty/reconciliation and MCP projection. |
| `test/account-log.test.ts` | Fixed-file/account isolation, unsafe/missing/incomplete metadata, suffix bounds, redaction and real SDK reads. |
| `test/wordpress.test.ts` | Subdomain ownership, installation projection/paging, cross-account IDs, root boundaries, file metadata, suffix ranges, output caps and custom log paths. |
| `test/diagnostics.test.ts` | Configuration-only readiness, catalog/registration agreement, safe detail projection, ID encoding, account isolation and metadata inspection without downloads. |
| `test/oauth.test.ts` | Separate read/read-write consent, scope non-escalation, CSRF, PKCE, single-use codes, shared SQLite, HTTP context propagation and revocation. |
| `test/deploy.test.ts` | Dependency graph, archive contents, release/rollback and private file preservation. |
| `test/smoke-hosting.test.ts` | Real HTTP SDK/subprocess smoke: explicit selection, bounded log requests, payload-free output and nonzero failure status. |
| `docs/`, `SECURITY.md` | Operator contracts, setup and security limitations; `PHP.md` records the pending plugin API contract, `WORDPRESS.md` distinguishes native DA from Softaculous. Private ignored `docs/api/` is the API research entry point listed in the agent README. |
| `AGENTS.md`, `CLAUDE.md`, `.agents/` | Codex/Claude entry points and shared memory; `CAPABILITIES.md` catalogs operations, `REVIEW.md` guides the next peer review, optional `tasks/` holds temporary handoffs. |

## Flows

- HTTP → `loadSettings` → Host/Origin → OAuth/discovery/health or MCP auth →
  actor + `canWrite` → new `createMcpServer` + stateless transport → tool → adapter.
- Stdio → `loadSettings(..., false)` → owner context → the same tool server and
  adapters; explicit account write policy is still enforced.
- Log → explicit account → fresh domain list for that account → GET `CMD_SHOW_LOG` →
  response bound → tail/filter/redaction → bounded output. No account fallback.
- Subdomains → fresh account domain ownership → legacy subdomain GET → validated FQDNs.
- Account log → explicit account → root canonical/regular-file metadata → fixed
  `log.txt` suffix download → redacted tail; no domain or WordPress inventory.
- WordPress → fresh provider inventory → existing installation ID → private root/path
  policy → canonical parent + regular-file metadata → bounded download → redacted tail.
  Metadata and download are separate provider operations, not atomic filesystem isolation.
- WordPress details → fresh inventory ownership → encoded single-ID detail GET →
  safe projection; no configuration, SSO or raw provider diagnostics.
- Log diagnostics → shared inspection policy → missing/empty/present metadata;
  no download. Incomplete listings do not establish absence.
- Capabilities → loaded settings + tool requirement catalog → missing configuration;
  no provider calls, permission checks or implied network success.
- DNS diagnostics → fresh local ownership/zone → fixed public resolver/cache → observed NS and local/public comparison.
- Changes → write scope + account allowlist → actor-bound preview in SQLite →
  review → account reservation → fresh state/NS checks → one fixed POST/PUT → provider read
  verification → persistent receipt. `applying`/`unknown` reserve the whole account.
  Explicit reconciliation can move `unknown` to `applied` only after observing the
  expected provider state, without another POST. Interrupted `applying` needs review.
- Explicit creation+TLS request → separate create receipt → parent-wide ACME plan →
  daily provider issuance / later metadata check → HTTPS plan only when ready. No
  automatic child-to-parent consent, on-demand issuance or background polling.
- Site redirect edit → API-listed opaque rule ID → separately authorized delete
  receipt → refreshed inventory → add receipt. No assumed overwrite or atomic edit;
  failure after deletion is partial completion. No destination HTTP requests.
- Deploy → check → allowlisted archive → SSH → dependency compatibility → code
  backup → restart → HTTPS + optional Bearer smoke; failure after copying begins → rollback.

## State boundaries

| State | Default location / lifetime | Owner |
| --- | --- | --- |
| Account settings and keys | Ignored config and env, loaded at startup | `config.ts`; never include real values in project memory. |
| OAuth grants/tokens/consents | Private `data/oauth.sqlite`, persistent local disk | `local-oauth.ts`; old tokens default to read scope. |
| Change previews/locks/receipts | Private `data/changes.sqlite`, persistent local disk | `change-store.ts`; ten-minute ready plans, up to 200 retained changes, unknown/applying locks survive expiry/restart. |
| Positive public DNS observations | Process memory, minimum answer TTL capped at 300 seconds | `public-dns.ts`; at most 256 keys, fresh bypasses app cache, failures/negative/zero-TTL results are not cached. |

See [review handoff](REVIEW.md) for the release comparison and critical code paths.
`dist/` is generated from TypeScript; do not edit it manually. `node_modules/`,
`data/` and real configuration are installation runtime, not versioned project memory.

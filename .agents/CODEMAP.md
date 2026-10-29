# Code map

Navigation by responsibility, not a function or class inventory. Update when
module responsibilities or important flows change; keep this map short.

| File / directory | Responsibility and purpose |
| --- | --- |
| `src/http.ts` | HTTP entry point, Host/Origin checks, health/discovery, authenticated actor/write context, per-request MCP transport and cleanup. |
| `src/stdio.ts` | Local process entry point; stdout reserved for MCP, owner write context still subject to account operation policy. |
| `src/server.ts` | Version, tool registrations, input schemas, MCP results/errors and safe auditing. |
| `src/wordpress-stage.ts` | Hostname-derived DB names and bounded HTML-only admin credential reader; Placement-specific immutable stage/recovery and existing-provider-root production plans, initial reviewed template-preservation policy, shared account reservation, secret-free background checkpoints/results and no retries. |
| `src/wordpress-stage-maintenance.ts` | Verified-install-only cleanup of fixed downloaded/extracted core copies; preserves credentials, manifests and all original backups. |
| `src/wordpress-stage-recovery.ts` | Bounded fixed-template metadata/hash snapshot, verified private copies, retained-backup proof and journaled relocation of originals; no deletion or arbitrary path input. |
| `src/wordpress-core-repair.ts` | Normal fresh pinned archive download/extraction and same-job core repair: official archive MD5, bounded safe system tar, candidate checksums, exact tree comparison, private truncated originals and missing-file exclusive writes. |
| `src/wordpress-stage-provider.ts` | Local UID/home/host binding, canonical/absent target, separate-domain or nested hosting creation, post-create allowlisted template preservation, exact existing-root/managed-redirect snapshot and production preparation, exact document-root and dedicated DB APIs and fixed read-only local empty-DB credential proof; fixed shell-free WP-CLI, stdin secrets and environment-specific stage/production policy. |
| `src/wordpress-stage-approval.ts` | Polish-default/English-switch owner login/logout and readable browser review/approve/deny with per-plan cookie-bound single-use challenges; completed-result WP admin password view and hash-authorized responsive CSS; no hosting writes from the page. |
| `src/capabilities.ts` | Shared tool/configuration-requirement catalog and honest configuration-only readiness; smoke tests verify names against the catalog. |
| `src/config.ts` | Validates env/JSON, origins, aliases, distinct read/write tokens, account write operations and trusted NS; selects private state files and resolves explicit accounts. |
| `src/directadmin.ts` | Domain/subdomain reads, ownership checks and bounded/redacted web-log results; public raw output stays 64 KiB, internal summaries inspect up to the 512 KiB provider bound. |
| `src/account-diagnostics.ts` | Safe self-account tally/limits, typed account resource metrics/history and fresh-owned database inventory/details; no SQL or credentials. |
| `src/log-summary.ts` | One log fetch, all-line error classification with rare fatal preservation; access status/path aggregation without request identities. |
| `src/database-exports.ts` | Fresh-owned database/site selection, bounded private gzip artifact lifecycle, actor-bound downloads, retention and single-process quota/locks. |
| `src/backup-inventory.ts` | Opt-in private root, canonical/regular-file checks and paged archive candidate metadata; no contents, recursion or restore. |
| `src/domain-dns.ts` | Account-owned domain settings, local DNS records/IDs/snapshots and contextual diagnostics. |
| `src/redirects.ts` | Typed legacy site-redirect inventory, opaque selection, secret-safe URL projection, literal input policy and rule-map snapshots. |
| `src/tls.ts` | Owned parent-domain ACME/certificate metadata, safe projections, secret-preserving config snapshots and conservative all-web-host redirect readiness. |
| `src/public-dns.ts` | Fixed-origin public recursive DNS observations, TTL cache, NS/provider hints; no lookups in log/list flows. |
| `src/hosting-changes.ts` | Validated operation previews/apply/reconciliation, write gates, stale checks, provider verification and no blind retries. |
| `src/change-store.ts` | Private persistent SQLite previews, actor binding, account reservations, hash-only owner browser sessions, atomic original-to-recovery transfer / same-job install continuation and receipts across stateless MCP requests. |
| `src/account-log.ts` | Fixed account-root `log.txt` policy, file metadata checks and bounded/redacted reads independent of WordPress. |
| `src/directadmin-http.ts` | Shared account-bound GET and fixed form-POST/ACME-PUT transport: credentials, fixed routes, timeout, response caps, redirect refusal and log suffix validation. |
| `src/hosting-error.ts` | Shared safe provider error codes/messages; no raw upstream diagnostics. |
| `src/wordpress.ts` | Provider-known installations, safe details, pagination, shared log inspection/read policy, metadata, bounds and redaction. |
| `src/auth.ts` | Distinct read/write Bearer contexts; external RS256/JWKS JWT, subject and scope checks. |
| `src/local-oauth.ts` | Owner OAuth: registration, native callback policy, scope-specific consent, PKCE, rotating token families and revocation; private SQLite state. |
| `config/servers.example.json`, `.env.example` | Public templates without real accounts or secrets. |
| `scripts/setup-{local,oauth,hosting}.mjs` | Local setup of private environment files and credentials. |
| `scripts/download-database.mjs` | Explicit local download via MCP, private non-overwriting output, fixed-origin URL and size/SHA-256 checks. |
| `scripts/smoke.mjs`, `scripts/smoke-oauth.mjs` | Real MCP client / OAuth probes against the configured environment. |
| `scripts/smoke-hosting.mjs` | Explicit account/domain live verification of domain/subdomain lists and five-line access/error reads; prints counts/status only. |
| `.github/workflows/check.yml` | Push/PR: locked installation, type checks, tests and build. |
| `.github/workflows/deploy.yml` | Manual deployment from `main`, production environment, SSH with a trusted host key. |
| `deploy/package.sh` | Runtime archive from an explicit allowlist, excluding private configuration. |
| `scripts/check-runtime-dependencies.mjs` | Checks production lockfile graphs and installed versions before copying. |
| `deploy/remote.sh` | Filesystem deploy lock, code backup/copy, single-app restart/verification/rollback; success-only cleanup outside the rollback trap. |
| `scripts/cleanup-deploy.mjs` | Exact successful-release marker, verified single private previous-code archive, validated numeric transfer pruning; no config/state or unknown folder deletion. |
| `deploy/start.cjs`, `deploy/verify.mjs` | CloudLinux bootstrap with env / HTTPS health and unauthenticated rejection probes. |
| `test/server.test.ts` | HTTP auth, Host/Origin, method/body limits, real HTTP SDK and stdio. |
| `test/directadmin.test.ts` | Account isolation, aliases, domain validation, provider failures, limits, plain/JSON/PHP WordPress credential redaction and SDK. |
| `test/domain-dns.test.ts`, `test/hosting-changes.test.ts` | Provider projection, contextual DNS/cache/failure handling, scopes/allowlists, stale/actor/expiry checks, exact record selectors, replay/uncertainty and concurrent reservations. |
| `test/wordpress-stage.test.ts` | Owner approval/CSRF/replay/expiry, write/host/path gates, secret stdin/environment, shared locks and partial failure; real child fixture and HTTP page; browser-compatible referrer policy with null/cross-site Origin rejection; remembered login persistence/expiry/rotation, cookie flags, logout and stale/cross-plan forms; DB naming and protected completed-result password reads/file boundaries/CSP hash; independent-domain placement, legacy compatibility, mode-specific permissions and locale switching; exact recovery approval, lock transfer, stale snapshot/refused file boundaries, verified private copies and no domain replay; documented SQL socket handling, exact empty-DB credential proof and no-creation install continuation. |
| `test/account-diagnostics.test.ts`, `test/log-summary.test.ts` | Tally projection/unknown limits, resource denial/series validation, fresh DB ownership, backup boundaries/pagination and single-read/rare fatal/SDK summaries. |
| `test/redirects.test.ts` | Typed decoding, secret projection, exact delete/add edits, authorization, stale/full-state checks, uncertainty/replay and SDK discovery. |
| `test/tls.test.ts` | Parent-wide scope/write gates, config-secret preservation, certificate coverage/date checks, stale state, PUT uncertainty/reconciliation and MCP projection. |
| `test/account-log.test.ts` | Fixed-file/account isolation, unsafe/missing/incomplete metadata, suffix bounds, redaction and real SDK reads. |
| `test/wordpress.test.ts` | Subdomain ownership, installation projection/paging, cross-account IDs, root boundaries, file metadata, suffix ranges, output caps and custom log paths. |
| `test/database-exports.test.ts` | Ownership/secret projection, storage modes/symlinks, compressed/decompressed limits, partial cleanup, actor/expiry/quota/concurrency and SDK/HTTP/local download helper. |
| `test/diagnostics.test.ts` | Configuration-only readiness, catalog/registration agreement, safe detail projection, ID encoding, account isolation and metadata inspection without downloads. |
| `test/oauth-desktop.test.ts` | Captured native DCR shape, loopback opt-in/exact binding, refresh scope/resource/client isolation, persistence, expiry, replay/concurrency and family revocation. |
| `test/oauth.test.ts` | Separate read/read-write consent, scope non-escalation, CSRF, PKCE, single-use codes, shared SQLite, HTTP context propagation and revocation. |
| `test/deploy.test.ts` | Dependency graph, archive contents, release/rollback and private file preservation; success-only pruning, failed-release evidence, wrong marker/symlink/private-state refusal. |
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
- Database export → account opt-in/private local directory → exactly one database/site → fresh native site/config mapping when requested (discard credentials, loopback only) → fresh DB ownership/details → bounded gzip stream/validation → private artifact/manifest → same-actor authenticated HTTP download or stdio local path. One-hour expiry; local cleanup every minute, no provider polling.
- Diagnostic reads → self-account fixed APIs → schema/projection → bounded metadata.
  Database details refresh inventory ownership. Resource denial is not zero usage.
- Log summary → one ownership/read operation → full bounded redacted tail → counts
  and critical excerpts, without fetching once per category or external lookups.
- Backup candidates → configured root index → canonical directory metadata page →
  regular archive basenames/IDs; no download or claim of backup integrity.
- Deploy → check → allowlisted archive → SSH → dependency compatibility → code
  backup → restart → HTTPS + optional Bearer smoke; failure after copying begins → rollback.

- Fresh stage → absent target + pinned core preview → separate owner-login approval →
  same-actor apply → shared account reservation → revalidation → fixed subdomain/DB/
  CLI steps + private credential file → local verification; uncertain steps retain lock.
  No clone/promotion, overwrite, generic shell or implied public DNS/TLS readiness.

## State boundaries

| State | Default location / lifetime | Owner |
| --- | --- | --- |
| Database exports | Explicit absolute private directory, one-hour expiry | `database-exports.ts`; owner-only files, ten artifacts, local startup/periodic cleanup; independent of releases. |
| Account settings and keys | Ignored config and env, loaded at startup | `config.ts`; never include real values in project memory. |
| OAuth grants/tokens/consents | Private `data/oauth.sqlite`, persistent local disk | `local-oauth.ts`; old tokens default to read scope. |
| Change previews/locks/receipts | Private `data/changes.sqlite`, persistent local disk | `change-store.ts`; ten-minute ready plans, up to 200 retained changes, unknown/applying locks survive expiry/restart. |
| Positive public DNS observations | Process memory, minimum answer TTL capped at 300 seconds | `public-dns.ts`; at most 256 keys, fresh bypasses app cache, failures/negative/zero-TTL results are not cached. |

See [review handoff](REVIEW.md) for the release comparison and critical code paths.
`dist/` is generated from TypeScript; do not edit it manually. `node_modules/`,
`data/` and real configuration are installation runtime, not versioned project memory.

Database export startup cleanup is tracked separately from export reservations:
new exports await housekeeping, while concurrent exports remain rejected.
`test/database-exports.test.ts` includes a deterministic race regression.

`test/wordpress-core-repair.test.ts` uses real tar archives to verify GNU long paths,
no overwrite of valid core, changed-byte refusal, mandatory candidate checksums and
archive-link refusal, fresh HTTPS archive streaming and bad digest/size refusal. Stage
tests cover one-approval template preservation, refusal before DB on unexpected files,
real child installation with safe long-name extraction and legacy checkpoint continuation.

D30 production entry point: plan_wordpress_install → shared owner HTML receipt →
apply_wordpress_stage/get_wordpress_stage. Existing-root templates/redirects are
snapshotted and privately preserved; hosting creation is skipped. Stage tests cover
policy separation, production browser wording/receipt, no hosting-create replay,
changed/foreign-root refusal and real child production settings. See WORDPRESS-INSTALL.

Maintenance tests: test/wordpress-stage-maintenance.test.ts exercises fixed temporary
archive/extraction removal while retaining credentials, manifests and original backups;
unsafe links/traversal are refused before any removal. See MAINTENANCE.md.

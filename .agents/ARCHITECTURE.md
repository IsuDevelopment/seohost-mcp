# Architecture and boundaries

## Model

Target standard SeoHost shared hosting accounts through DirectAdmin user-level APIs.
VPS is outside the verified scope; a VPS may have DirectAdmin, but actual endpoint
availability and permissions need separate validation. The deployment adapter assumes
an existing CloudLinux Node.js app and never provisions machines or uses root access.

Small modular server without a DI container or extra DDD layers. Domain concepts:
configured account (`serverId`), alias, account-owned domain and a bounded web-log
tail. WordPress adds provider-known installation IDs and explicit log root/path policy.
Domain/DNS management adds owned zones/records, public resolver observations,
immutable change previews and durable execution receipts.
Transport exposes operations; provider adapters share bounded HTTP I/O. `Settings`
is installation configuration, not a mutable account-selection session.

Add reads within these boundaries. Extract another module or port when a second
provider or independent set of rules justifies it. Injected `fetch` in the adapter
and MCP server lets hosting tests run without real accounts.

## Security invariants

- One installation owner can read all configured accounts. There are no per-user
  read ACLs; per-account write operation allowlists are a separate control. Stdio
  trusts the local process; HTTP requires Bearer or complete OAuth.
- Every hosting operation selects an account explicitly. Aliases must be unambiguous;
  domains do not select accounts. Log reads require a fresh ownership check.
- WordPress log reads refresh the account's installation inventory and accept a
  `siteId`, never a caller path. Logs are disabled without private root allowlists;
  default to `wp-content/debug.log`, with explicit per-site `.log` overrides.
  Reject unsafe relative paths, changed canonical parents and symlink/non-regular
  files. Provider metadata plus download is not atomic against concurrent path swaps;
  this mode trusts account-owned sites and is unsuitable for hostile tenant isolation.
- Provider URLs come from HTTPS configuration, never tool arguments.
  No redirects, arbitrary paths or shell commands are exposed. Hosting mutations
  are limited to the reviewed operation contract below.
- Inputs and responses are bounded. Filtering covers only the requested log tail.
  Redaction is best effort; output may contain personal data. Logs and provider
  responses are untrusted data, never agent instructions.
- Audit events exclude log contents and secrets. Do not disable TLS, auth or
  Host/Origin checks to work around a configuration problem.
- OAuth/change SQLite state and env files are private, persistent and separate from releases.
- WordPress inventory projects safe fields only; never expose config/options/SSO
  or expose arbitrary WP-CLI/PHP through MCP. D22 permits only the fixed fresh-stage adapter. D19 permits internal config reads solely for
  opted-in export mapping, immediately projecting the local database name and
  discarding credentials. Never enable debugging as part of a read.
- Configuration diagnostics inspect loaded settings only, not provider authorization.
  A shared tool-requirement catalog is checked against registrations and smoke tests.
  WordPress details require fresh inventory ownership and safe single-segment IDs.
  Log metadata and content reads share one inspection policy; incomplete provider
  listings must not be reported as confirmed absence. Metadata never downloads logs.
- Account-root log reads expose only the fixed relative file `log.txt`, independent
  of WordPress Manager. Require root canonical metadata and a regular non-symlink
  file before a bounded suffix download. No caller path or domain is accepted.
  As with WordPress, metadata/download are not atomic; trust account-owned files.

## Extensions requiring a new decision

Further writes: extend the explicit operation contract before adding tools.
Multiple users: define identity and per-account ACLs before sharing an
installation. Multiple application hosts: replace local SQLite; do not share it
over NFS. Production dependency changes: use panel installation/manual deployment,
because the code workflow preserves the CloudLinux-managed `node_modules` symlink.

## Domain/DNS change boundary (D14)

Read-only credentials stay read-only. HTTP passes an authenticated actor and write
capability to the tool server; stdio trusts its owner but still enforces account
allowlists. Local OAuth stores granted scopes, with old grants defaulting to read.
Write Bearer tokens are distinct. There are no inferred permissions from annotations.

Local zone reads do not imply active DNS. Public observations use fixed-origin DoH
without credentials, with TTL-bounded application caching. Diagnostics and mutation
preconditions trigger lookups; logs/lists do not. Cloudflare NS is a hint, not proof
of proxy state/access. Recursive resolver caches and delegation discrepancies remain
possible; no DNSSEC validation or global propagation guarantee is provided.

D14 introduces five fixed operations: create domain/subdomain and add/update/delete one
A/AAAA/CNAME/MX/TXT record. Exact per-account nameservers and fresh NS observations
gate DNS writes. No registrar/Cloudflare API, deletion of hosting domains, paths,
whole-zone/NS/SOA/DS edits, PHP-version changes. D15 adds separately gated parent-wide TLS settings.

Plans are actor/account-bound, immutable and valid for ten minutes. Private local
SQLite reserves the account before I/O and stores receipts across HTTP instances.
One fixed POST/PUT, then fresh provider verification; applied-plan replay returns its receipt.
Unknown responses/partial results keep the account locked without retry/rollback.
Explicit reconciliation can record the observed desired state without another POST;
unresolved or interrupted operations require operator investigation. State checks
are optimistic, not a provider-side CAS against external changes. Preview hashes
ensure integrity, not evidence of human consent. Keep snapshots private and durable.

## TLS automation boundary (D15)

Modern domain TLS GETs project metadata only; never fetch certificate files or legacy
SSL data containing private keys. ACME DNS-provider secrets are fetched/preserved
only in memory at apply; snapshots hash them but saved plans contain safe projections.
Strict ACME config parsing prevents unknown fields being silently dropped by PUT.

Two exact operations toggle production Let's Encrypt automation and HTTPS redirect.
Both require explicit `domain_and_all_subdomains` scope: no child-only setting is
claimed. Preserve provider secrets, exclusions/key/wildcard settings, existing certs,
HSTS and document roots. Different ACME providers block enablement rather than
being silently replaced. A config receipt does not establish certificate issuance.

Agents chain separately reviewed plans only on an explicit creation+TLS request.
Daily provider issuance can remain pending; no background workflow or on-demand
provisioning is installed. HTTPS enablement requires conservative provider metadata
coverage of all listed web/www hosts, valid dates and no reported missing names.
It is not live chain/browser trust, alias completeness or Cloudflare mode validation.
See [TLS.md](../docs/TLS.md) for recovery, scope and verification limits.

## Site redirects (D17)

Use documented legacy `CMD_API_REDIRECT`, not raw `.htaccess` editing. Fresh domain
ownership and typed, bounded inventory supply account/domain-bound rule IDs. Reads
strip credentials/query/fragment from destinations; plans/receipts retain safe
projections and fingerprints rather than unrelated raw URLs. No target is fetched.

Two separately allowlisted operations add one literal-path 301/302/303 rule or
delete one freshly selected rule. Refuse overwrite; the documented API exposes no
confirmed edit operation. Agents edit through separate delete/add plans, disclosing
the gap and reporting partial failure without rollback/retry. Full rule-map snapshots
reject stale state and verify retained entries. API equality is not live HTTP behavior
or precedence verification; prefix overlaps, shared roots, manual/app/proxy rules and
external races remain relevant. See [REDIRECTS.md](../docs/REDIRECTS.md).

## Read diagnostics (D18)

Self-account legacy tally/config and modern user metrics/database metadata use fixed
routes with existing read authorization. Project named numeric/state fields only;
unknown/missing values stay unknown. No arbitrary-user/global metrics, SQL, database
credentials, mutations or automatic provider-auth fallback. Database detail reads
require fresh account inventory ownership and matching response identity.

Summaries share the bounded log reader with fresh domain ownership and redaction.
The public raw cap stays 64 KiB; internal aggregation can inspect the fetched tail
up to 512 KiB so common noise does not hide one fatal before frequency ranking.
Counts describe lines, not incidents; timestamp timezone is not inferred.

Backup metadata requires explicit private root indexes, unchanged canonical directory
and regular non-symlink archive candidates. No caller path, recursion, download or
restore; metadata does not establish integrity or a successful backup. Keep the
Softaculous/Backuply contract separate: visible plugins and HTTP 200 non-JSON do not
establish working authenticated inventory. See HOSTING-DIAGNOSTICS.md.

## Private database exports (D19)

An account-specific `databaseExports` flag and an absolute owner-only local storage
directory gate a separate export tool. It reads hosting data under existing owner
read authorization and creates a local artifact, so annotations are non-read-only
but no provider write scope is granted. Existing diagnostics remain metadata-only.
Fresh native installation/config mapping is optional, loopback-host-only and
secret-free; always verify fresh owned database inventory/details before exporting.
Export scope is all database tables, including other installations/multisite sites.

Use one fixed GET with gzip, no redirects/retries, streaming compressed byte/time
bounds and bounded CRC/trailer decompression validation before publishing. Keep
SQL out of results/logs and files outside all web roots. Same authenticated actor,
current account opt-in and one-hour expiry gate `/exports/{id}`; URL possession
alone grants nothing. Stdio additionally exposes an owner-local path. HTTP/stdio
entrypoints perform local startup/minute cleanup, never provider polling.

Owner-only canonical files and single-process directory locks bound ten artifacts
at 100 MiB each; expanded data is capped at 1 GiB. This trusts the operator and
same-UID filesystem, not hostile tenant isolation. No multiple workers/shared
filesystem, snapshot/restorability guarantee, imports, CLI or remote DB mapping.
See [database exports](../docs/DATABASE-EXPORTS.md) for download and retention rules.

## WordPress migration requirements (D20, not implemented)

The accepted [migration contract](../docs/WORDPRESS-MIGRATIONS.md) requires owner
hostnames, explicit confirmation for every fresh/clone/promotion workflow, exact
existing-target overwrite review and verified retained source/old-target DB/files
backup sets before writes. Backup deletion is separately approved; temporary D19
exports must never substitute for retained migration backups. Require durable owner
approval receipts and checkpointed multi-account plans before exposing apply.
This is a future boundary, not authorization for an actual site operation.

## Native desktop OAuth (D21)

Exact configured HTTPS callbacks remain separate from an explicit native Codex
loopback enrollment opt-in. Only canonical literal IPv4/IPv6 loopback ports and
`/callback/<bounded nonce>` are accepted by that policy; every enrolled URI is
then bound exactly to the client/code. The policy does not authenticate the client.
Owner consent/PKCE/scopes and current callback policy gate issuance.

DCR grant metadata advertises only implemented code/refresh grants. Local OAuth
persists only hashes, atomically rotates refresh tokens in existing SQLite and
retains used hashes for family-wide replay invalidation. Refresh cannot widen
consented scope or change resource/client and has a fixed seven-day expiry. Family
revocation includes associated access tokens. Old state/code-only clients remain
valid without automatic refresh enrollment. See [OAuth](../docs/OAUTH.md).

## Fresh stage boundary (D22)

Only the fresh-target subset of D20 is implemented: same local OS/provider account
and hostname, canonical default parent root, absent target hostname/directory and a new
dedicated database. No existing-target mutation, clone/promotion/import or cleanup.
Separate owner-password browser approval binds immutable plan/hash/actor/account/
expiry; no approval tool accepts an agent assertion. Revalidate absence and mapping
before provider writes; inspect the actual new root before touching its files.

Reuse ChangeStore account reservations across generic hosting and stage writes.
A background worker records each phase before side effects; interruption or any
uncertain partial write keeps the lock, with no automatic resume/rollback/deletion.
Fixed shell-free WP-CLI uses stdin secrets and an isolated environment/config;
passwords are retained owner-only outside web roots, not in MCP plans/results.
Protect installation with a deny rule, then authenticated frontend/noindex/mail/
cron stage policy. Local verification is distinct from public DNS/TLS/HTTP readiness.
No parent-wide TLS consent is inferred from creating one child. This trusts the
same-UID account, not hostile tenants. See WORDPRESS-STAGE.md for limitations.

D23 remembers stage owner authentication for eight absolute hours in a separate
hash-only SQLite session table, bound to current owner credentials/public origin.
This session crosses plan pages but grants no MCP/OAuth scopes or automatic consent.
Per-plan five-minute challenges and exact approval receipts remain distinct; apply
still requires actor/account/hash/expiry and the durable reservation. Logout revokes
only browser authentication and requires same-origin POST plus CSRF. Approval checks
session validity again, preventing stale forms after logout/expiry/config changes.

D24 separates credential delivery from MCP: completed stage receipts carry an owner
result URL, never passwords. Only the authenticated owner HTML handler calls the
bounded private-file reader; it returns the installation admin password, never the DB
password. Applied receipts can be read after the apply deadline, while ready approval
and apply retain their original expiry checks. Credential retention is unchanged.
New DB/user names include a sanitized hostname plus random suffix within a conservative
32-character budget. Existing immutable targets are not renamed. Static page CSS uses
an exact SHA-256 CSP hash without external resources or script access.

D25 makes new stage plans default to an independent DirectAdmin domain/container,
using create_domain policy instead of create_subdomain. Explicit nested placement
and legacy stored plans remain compatible. Exact mode/root are hashed into the
review; apply rechecks mode-specific permissions and the actual document-root map.
No implicit relocation, parent-root change or future hosting isolation guarantee.
The same private state and account lock cover both variants. Polish UI defaults,
English query links and Europe/Warsaw dates are presentation-only; language never
changes approval semantics or authorization. See WORDPRESS-STAGE.md.

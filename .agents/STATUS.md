# Status and handoff

Updated: 2026-10-27.

## Current production-install work (D30)

Production 0.19.1 adds fresh production installation on an existing provider-only
canonical domain root, separate from protected staging. 147 tests/types/build pass.
0.19.1 deployed from 12e4525 through successful Deploy 40496535288 and Check
40496520123; independent HTTPS/SDK verified 0.19.1, 33 tools, unauthenticated 401
and read-token write rejection. Earlier 0.19.0 Deploy 40496062158 also passed. H57-only required
operations were enabled after a verified private configuration backup and single-app
restart. Read-only production planning identified an equivalent root redirect URL
without a trailing slash; 0.19.1 normalizes safe destinations for API comparison
while retaining the full original file fingerprint. Read-only live production planning now passes. The concrete immutable root
preview is ready in private operation artifacts; actual owner browser/conversation
confirmation is pending. Verified private copies of requested domains redirect
configuration are retained; source WordPress files/databases remain untouched. No live hosting
redirect or WordPress data has been changed. See WORDPRESS-INSTALL.md and the
private ignored operation artifacts for the exact requested domains/state.

## Current verified outcome

- Production 0.18.0 deployed from `641446d`, Deploy `40318949846`, Check `40318886786`;
  144 tests/types/build passed. Independent HTTPS/SDK checks confirmed 0.18.0,
  32 tools, unauthenticated 401 and read-token write rejection. Same dependencies/private config preserved.
- The owner-approved independent-domain stage finished through MCP on 0.17.1: applied,
  completed_locally, pinned WordPress 7.1.3, correct URL and indexing disabled.
  Its reservation released normally after success; domain and DB were never recreated.
- Eight provider template files have verified private copies and retained originals.
  Core repair restored 39 missing files and privately retained 33 truncated artifacts.
  Official archive MD5, safe system tar, candidate/final core checksums and complete
  tree matching passed. Correct core files were not overwritten; config is mode 600.
- Independent public HTTPS checks passed: frontend 403 with noindex,nofollow (expected
  staging login protection), wp-login 200. Owner result page returns 200/no-store;
  only the owner browser can reveal the generated password. No password entered chat.
- 0.18.0/D29 consolidates new fresh provisioning: the first reviewed scope
  includes verified private preservation of newly generated allowlisted templates;
  pinned core uses direct bounded official archive download and safe private tar,
  mandatory candidate/final checksums and exclusive writes. Domain/subdomain POSTs
  allow 60 seconds; safe failure detail and agent polling instructions are improved.
  Repeated per-file checkpoints persist only when the phase changes, avoiding
  thousands of redundant SQLite writes during a full verified-core copy.
  Local and deployment checks passed. No new live site operation is authorized
  or used as a test; existing completed staging stays untouched. Generic resume and
  uncertain-write retries remain unavailable.

## Historical investigation evidence

Earlier pending/unknown statements below describe intermediate release checkpoints
and are superseded by the successful verified outcome above. Git preserves full history.

- Production 0.16.0 deployed from `5f0ff26` through successful Deploy `40311510800`
  (134 tests in local/workflow checks). Independent SDK confirmed version and 32 tools.
  Local DB credentials/zero-object proof passed. Core download completed but checksum
  verification stopped the job before config/install. Read-only investigation proved
  full long paths exist in the archive while extracted paths are truncated at 100
  archive bytes. DB remains empty; template backups/originals are retained and verified.
- Candidate 0.17.0/D28 fixes that precise pinned-download case under the existing
  approval and reservation. Full 139 tests/types/build pass, including real tar long
  names, candidate/final checksums, no valid-file overwrite and unknown-file refusal.
- Approved recovery apply preserved and privately verified all eight template files
  and originals; empty root matches the plan. It stopped unknown at creating_database.
  Read-only inventory confirms the DB exists with zero tables and one exact
  localhost-only user; both private copy/original SHA-256 sets match. WP has not run.
  H57 server metadata reports Unix-socket SQL; the old adapter rejected documented
  socket responses. Original create response unavailable; exact failure not fully known.
- Candidate 0.16.0 adds documented SQL socket support and D27 verified remaining-install
  continuation under the same approved job/receipt/lock (32 tools). Full 134 tests/
  types/build pass, including backup corruption, credential stdin, zero-object/user/
  root checks, wrong phase/hash/actor, idempotence and no domain/DB creation replay.
  No new user scope is requested; continuation performs only already approved effects.
- Production 0.15.0 deployed from `95821d2` through successful Deploy `40308153399`;
  Check `40308094388` passed (130 tests/types/build). Workflow backup/dependency guard/
  restart/HTTPS/authenticated smoke passed. Independent SDK confirms version, 31
  tools, configured placements, unauthenticated 401 and read-token write rejection.
  Real recovery planning passed: original unknown checkpoint/receipt, exact existing
  domain/root, absent dedicated DB, eight files plus one CGI directory (81,102 bytes)
  and hashes were verified. New ready recovery preview awaits exact browser approval;
  no template copy/relocation or database/WordPress installation has run yet.
- Version 0.15.0 adds D26 controlled pre-DB recovery planning (31 tools). Full
  130-test types/build check passed: separate owner approval, same-actor/account
  original binding, atomic reservation transfer, concurrent/stale refusal, no
  domain replay, secret-free results, verified private template copies/originals
  and unknown locks after partial preservation. Production recovery not yet run.
  Owner authorized preserving the discovered templates and preparing continuation;
  exact recovery snapshot still requires its own browser approval after deployment.
- First owner-approved independent-domain apply stopped at creating_independent_domain
  with WRITE_OUTCOME_UNKNOWN. Separate read-only investigation confirmed the domain
  now exists, the actual computed public_html matches the reviewed root, and the
  dedicated database is absent (complete account DB inventory). The provider created
  eight top-level template entries: index.html, six error .shtml files and cgi-bin.
  No WP/database installation ran; no credentials were printed. The account lock
  stays unknown; no retry, resume, delete, relocation or lock override was performed.
  Preserve templates and require explicit reviewed recovery before continuing; see
  [recovery contract](../docs/WORDPRESS-STAGE.md). The original POST failure cause
  is unknown: do not assume an API error/timeout/parser mismatch without evidence.
- Production 0.14.0 deployed from `cb606e8` through successful Deploy `40208957293`;
  Check `40204918957` passed (123 tests/types/build). Backup/dependency guard/restart/
  HTTPS and authenticated smoke passed. Independent SDK confirms 0.14.0, 30 tools,
  both configured placements, unauthenticated 401 and read-token write rejection.
  Public pages verify Polish default, English switch, correct CSP hash and no-store.
  Real H57 independent-domain preflight produced a fresh unapproved ready plan with
  the requested separate domain container/root and readable DB name. That preflight
  did not create resources; the later partial live apply is recorded above.
- Historical production 0.13.1 brand patch deployed from `c8e6c91` through Deploy `40204066809`;
  Check `40204059667` and full local 120-test check passed. Independent HTTPS confirmed
  0.13.1, exact requested gradient, correct CSP style hash and no-store.
- Version 0.14.0: independent-domain stage default and Polish/English UI (D25).
  Full 123-test check/types/build passed. Dummy browser verified Polish preview,
  prominent directory and English switch without re-login/approval. Adapter fixtures
  verify absent container, fixed create-domain parameters, actual-root mismatch,
  refusal of provider placeholders and untouched parent files. Legacy plans and
  mode-specific configuration/readiness are regression-tested. Safe H57 settings
  probe confirms create_domain already enabled; no private permissions were changed.
  Actual independent-domain creation/install remain awaiting separate owner approval.
- Historical production 0.13.0 deployed from `4076a87` through successful Deploy `40203604423`;
  Check `40203593539` passed (120 tests/types/build). Workflow backup/dependency guard/
  restart/HTTPS/authenticated smoke passed; independent SDK confirmed 0.13.0, 30 tools,
  unauthenticated 401 and read-token WRITE_SCOPE_REQUIRED. Configuration preserved.
  Browser CSS and credential result were verified only with dummy local data; no
  production password was read and no target installation was executed.
- Historical production 0.12.0 deployed from `c5fe087` through Deploy `40201063221`;
  Check `40201053559` passed (117 tests/types/build). Code backup, dependency guard,
  single-app restart and workflow HTTPS/authenticated MCP smoke passed. Independent
  HTTPS health confirms 0.12.0. Private configuration/state remain preserved.
  Remembered owner login and logout were browser-tested locally with dummy credentials;
  production owner authentication and actual stage installation remain unverified.
- Historical production 0.11.1 deployed from `75c40d6` through successful Deploy run
  `40193850271`; Check `40193837644` passed (112 tests/types/build). Private H57
  configuration/state preserved. A fresh production MCP plan replaces the expired
  preview and still awaits explicit owner confirmation; no target resources created.
- Version 0.11.1 fixes native owner approval/OAuth form POSTs: no-referrer made
  browsers send Origin:null, which the server correctly rejected. strict-origin
  keeps same-origin POST identity while withholding URL paths. Null/cross-site
  checks, CSRF, owner login and session/plan expiry remain enforced. All 112 tests,
  types/build pass. Real browser reproduced the failure with dummy local credentials
  and reached exact-plan review after the patch. First deploy run `40193510934`
  stopped before packaging/SSH because startup cleanup raced the first export.
  Cleanup/export reservations are now separate: exports await active housekeeping;
  real concurrent exports still fail busy. Deterministic regression added and 112
  checks pass. No target mutation performed.
- Historical production 0.11.0 was deployed from `ceab05b` through Deploy MCP run `40188810485`;
  Check run `40188798012` passed. Workflow check/package/dependency guard/backup/
  restart/HTTPS/authenticated smoke passed. Independent SDK confirmed 30 tools,
  version/401 boundary and read-token write rejection. The owner separately approved
  enabling local provisioning plus create_wordpress_stage on H57; private account
  configuration was backed up outside web roots, other accounts/operations preserved,
  and only MCP restarted. A concrete fresh-target plan is prepared, awaiting separate
  owner browser/conversational confirmation. No subdomain/database/site files created.
- Version 0.11.0 implements fresh WordPress stage planning, separate owner-login
  approval and checkpointed local-account installation (30 tools). Full check
  passes 111 tests/types/build; candidate preflight also passed on H57 without
  creating a subdomain/database/site files. Stable core version lookup and fixed
  WP-CLI execution work in the app runtime. No real stage/subdomain/database has been created.
  Softaculous end-user CLI file is accessible, but documented list commands exit
  255 without JSON under PHP 8.2/8.3/8.5; ionCube is present. No proprietary sources
  were read and no security settings weakened. WP-CLI 2.12.0 and the documented
  document-root map/OS-account identity match on H57. See WORDPRESS-STAGE.md/D22.
- Historical production 0.10.0 was deployed from `78b62b2` through successful Deploy MCP run
  `39958497210`; Check run `39958419598` passed. Workflow tests (100/100), dependency
  guard, private code backup, single-app restart, HTTPS/authentication verification
  and authenticated SDK smoke passed. Configuration, private OAuth/change state
  and hosting-managed dependencies were preserved. The owner configured native
  loopback in the app environment; no agent-side private configuration edits.
- Independent HTTPS verification confirmed 0.10.0, unauthenticated MCP rejection,
  refresh discovery and successful native Codex DCR with both grants. It reached
  the login/consent form and returned the expected denial callback with `iss` and
  state. Unsafe callbacks/unsupported grants were rejected; the refresh endpoint
  rejected a dummy token as `invalid_grant`. One verification client was created;
  no owner password or real access/refresh token was used/issued. This proves the
  reported pre-login registration failure is resolved, not a full owner login or
  real production refresh. The owner should reconnect the desktop client.
- Desktop OAuth (D21) was developed from an actual native binary DCR capture and
  independently confirmed fixed rejection labels in desktop/server logs. Refresh
  rotation, persistence, scope/resource/client isolation, expiry, concurrent replay
  and family revocation pass local tests. Exact registered callbacks and PKCE stay
  enforced. Local types, 100/100 tests, build, Markdown links, helper syntax and
  diff whitespace passed; no production `.env` or credentials were printed.
- Version 0.10.0 includes opted-in whole-database gzip exports (27 tools), private
  actor-authenticated downloads, stdio paths and a checksum-verifying local helper.
  Public H57 Swagger export/config contracts were re-read with TLS verification.
  Actual provider export/MIME behavior remains unverified; no live SQL/config was
  fetched. Native WordPress mapping remains subject to the historical H57 feature
  denial; explicit database selection avoids it. Export opt-ins/storage were not
  configured by this deployment. See DATABASE-EXPORTS.md/D19.
- Owner migration requirements (D20) are recorded in WORDPRESS-MIGRATIONS.md and
  tasks/wordpress-migrations.md: exact owner-supplied fresh stage hostname + WP/new
  DB, full live-to-stage clone and full stage-to-live promotion. Every operation
  needs fresh user confirmation, explicit existing-target wipe review and verified
  source/old-target DB/files backups retained until separately approved deletion.
  D19 temporary download artifacts cannot satisfy migration backup retention.
  Fresh-only stage tooling is added by D22; clone/promotion and backup deletion remain pending. Owner reports full key permissions;
  diagnose provider feature availability/contracts rather than asking for more rights.
- Requested next CLI scope: plugin inventories per installation/site, multisite
  site lists, user lists and staging-to-live search-replace. Not implemented. First
  verify execute/SSH/WP-CLI targeting; use fixed typed operations, bounded responses
  and deliberate user-data projection. D22 exposes only fixed new-install CLI steps. Migration writes need backup, serialized-data
  dry-run, explicit table/site/network scope and separately reviewed write plans.
- Historical production 0.9.0 was deployed from `cccf886` through successful Deploy MCP run
  `39760091947`; Check run `39754158408` also passed. Independent HTTPS health
  and authenticated SDK checks confirm version 0.9.0 and 26 tools. H57 usage,
  database inventory/details and one-fetch error summary passed. Metrics denial,
  backup-root opt-in and read-token write rejection behaved as expected. Private
  configuration/state were preserved; the original five-operation policy remains.
  TLS/redirect operations and backup roots were not enabled by this deployment.
- Version 0.9.0 adds six read-only diagnostic tools (26 total): account usage,
  user resources, database inventory/details, one-read web-log summaries and opt-in
  backup archive metadata. `npm run check` passes: 85/85 tests, types and build.
  Candidate adapter reads passed on H57 for usage, DB inventory/details, metadata
  in two known backup directories and a domain error summary. Only counts/status
  were printed; credentials stayed on hosting. Backup roots were set in process
  memory for verification, not persisted; no archive/SQL body was downloaded.
  Resource latest returns 403. Advertised Softaculous JSON installations/backups
  actions returned non-JSON HTTP 200 with the existing Login Key, so no plugin
  adapter/auth fallback is claimed. See HOSTING-DIAGNOSTICS.md. No live site
  setting change was performed. Private backupRoots remain unconfigured; enable
  them separately for archive metadata. H93 stays deferred.
- Historical candidate 0.8.0 adds API-listed site redirect reads and planned add/delete
  operations (20 tools). Editing is a non-atomic sequence, not assumed overwrite.
  Local check: types/build and 74/74 tests pass. The candidate adapter's live H57
  read found the owner's expected root 302 rule; only counts/status were printed.
  No redirect write was performed. Included in the 0.9.0 deployment; the new
  operation names stay disabled until explicitly configured.
- Historical candidate 0.7.0 adds TLS metadata and two planned parent-wide operations (19 tools):
  production Let's Encrypt automation and HTTPS redirects. Creation+TLS is an
  explicitly requested sequence; daily issuance may remain pending. No child-only
  setting, immediate provisioning or background polling is implemented. See D15/TLS.md.
- Historical 0.7.0 validation: `npm run check` (65/65 tests, types and build).
  H57 modern ACME/certificate metadata GETs returned HTTP 200, with only safe
  summary fields printed. TLS mutations and the full live create/issue/redirect
  sequence remain fixture-tested, not production-verified. Included in the 0.9.0
  deployment; the original five-operation policy remains. Enable the two new
  operation names separately in private configuration, with a backup.
- Historical release 0.6.0 was deployed from code commit `556b134` through GitHub Actions run
  `39695303040`; Check run `39695291773` and deployment both passed.
- Version 0.6.0 adds domain settings, local/public DNS diagnostics and scoped,
  per-account planned changes (18 tools). Production SDK discovery, owned-domain
  settings, local zone reads and public DNS diagnostics pass on H57. Only safe
  counts/status were printed. Five operations and trusted account nameservers are
  enabled in private H57 configuration, backed up outside the web root. OAuth
  advertises read/write scope; the existing read token still rejects previews with
  `WRITE_SCOPE_REQUIRED`. New owner consent with write scope is required to execute.
  Live mutations are not tested: no domain/subdomain or DNS record was changed
  solely for verification. Mutation behavior is covered by provider fixtures.
- Account-root `log.txt`, domain/subdomain inventory and bounded access/error
  streams remain supported. Previous H57 production SDK reads passed; WordPress
  Manager and H93 limitations are listed below.
- Historical 0.6.0 `npm run check`: types, 57/57 tests and build. Automated provider
  tests use schema fixtures and the real MCP SDK; live verification is listed below.
- Configuration readiness uses loaded settings and never probes provider access.
  WordPress details revalidate installation ownership and return safe fields only.
  Metadata inspection shares log policy without downloading bytes; incomplete
  provider listings do not establish absence.
- PHP management is requested but not implemented. Read `docs/PHP.md` and
  `tasks/php-selector.md`: existing private API research already records the missing
  SeoHost PHP Changer contract. The live Swagger was re-read (269 paths, no modern
  PHP version/INI endpoint); the native selector reports disabled on the observed
  domain. No PHP write was sent. Resolve the plugin contract before implementation.
  Owner's alternative idea is recorded in `docs/PHP.md`: optional account-local
  read-only configuration diagnostics, with any runtime helper separately designed.
  Backlog only; no helper or local filesystem adapter has been implemented.
- After the owner corrected H57 credentials, only the MCP application was restarted.
  Live `list_domains` through the production MCP SDK succeeds for H57. WordPress
  inventory remains denied with HTTP 403. Targeted diagnostics confirm the key's
  effective commands include `wordpress`, but account configuration reports
  `wordpress=OFF`; the session's general WordPress feature flag alone is insufficient.
  The owner subsequently relayed support's explanation that the GUI manager may
  be Softaculous, a separate integration. Native `wordpress=OFF` is not evidence
  of a missing key permission, and the existing adapter does not use Softaculous.
  Its separate documented API requires account-specific verification and a future
  adapter; do not assume native feature enablement is the resolution. H93 setup is deferred by the owner; it was not retried. No log contents
  were downloaded during that authentication diagnostic.
- Subsequent owner-authorized H57 checks through the production MCP SDK verified
  subdomain lists and both access/error log reads on representative owned domains.
  Active streams returned records; other streams were empty. Only counts/status
  were printed; no raw log content was published. This does not verify every
  account/domain, rotated archives or machine-wide logs.
- WordPress log access requires narrow private `wordpressLogRoots`, optional per-site
  `wordpressLogPaths`, provider filemanager access and separate live verification.
  Metadata is not an atomic lock against concurrent filesystem swaps; use trusted
  account-owned installations. No tool enables logging or accepts caller paths.
- Next: re-authorize the client with write scope before its first reviewed concrete
  change. Establish the SeoHost PHP Changer API contract; for WordPress, investigate
  documented Softaculous integration rather than repeating native permission changes.
  Native inventory/log metadata/Range remain unverified on this account. H93 credentials are deferred. Full owner OAuth
  login remains a separate client check.
- Independent review is pending. [REVIEW.md](REVIEW.md) identifies the domain/DNS and candidate TLS diffs,
  inspection order and verification gaps; it does not represent review approval.

## Recent changes

2026-10-25 — 0.11.1 (`75c40d6`, Deploy `40193850271`): fixed browser Origin:null
caused by no-referrer on stage/OAuth forms; real browser dummy login verified.
Startup housekeeping/export contention discovered in CI was fixed with a gated
regression. 112 tests/types/build and workflow pass. No owner credentials read,
no hosting installation applied. Existing expired preview replaced by a fresh plan.

2026-10-25 — D22 fresh WordPress workflow implemented and deployed (`ceab05b`, run
`40188810485`), 111 tests/types/build pass. Owner-approved H57 opt-in/config backup
and independent production checks passed. Candidate preflight and actual production
stdio MCP planning pass; owner confirmation page loads without anonymous disclosure.
No installation or target mutation yet. Softaculous CLI remains unverified after
exit-255 list probes; no proprietary source read or security-setting changes.

2026-10-23 — owner-authorized 0.10.0 deployment from `78b62b2` via run `39958497210`.
Workflow and independent native DCR/form/denial verification passed. Owner-managed
loopback flag is effective. No site migration, database export/import or backup
removal was performed. Full desktop owner login/real refresh remains a client check.

2026-10-22 — owner-authorized 0.9.0 production deployment through run `39760091947`
from `cccf886`. Workflow check/package/dependency compatibility/backup/restart/HTTPS/
authenticated smoke passed. Independent SDK verified 26 tools and supported H57
diagnostic reads, expected metrics denial, backup opt-in and read-token write
rejection. No private configuration, site setting or operation allowlist changed.

2026-10-22 — candidate 0.9.0 diagnostics (D18), owner-confirmed scope: safe account
usage, typed account resource metrics/history, fresh-owned database metadata,
single-fetch log summary and configured-root backup metadata. Six new tools;
85 tests/types/build pass. Live H57 supported reads passed; resource and Softaculous
limits are explicit rather than fabricated empty/zero results. No runtime dependency,
production config, site setting or deployment change. English memory/docs updated.

2026-10-22 — candidate 0.8.0 site redirects (D17), following local research and
legacy API documentation: typed inventory/IDs, URL projection and two fixed planned
operations. Reuses scope/policy/state/receipt controls; explicit non-atomic editing
and no target requests. Nine new redirect cases pass in the 74-test check. Live
candidate adapter read on H57 passed without installation or credential copying;
production rules and code were not changed. English docs/map/review handoff updated.

2026-10-22 — API-first workflow made explicit, with private `docs/api/` navigation
in agent context. Recorded PHP contract gaps and a pending implementation handoff;
corrected the WordPress next step using the owner's support reply (Softaculous vs
native DA). Documentation-only change: local links/consistency checked, no runtime
change or deployment. The 65-test result above remains historical TLS validation.

2026-10-22 — candidate TLS workflow (D15): metadata-only inspection, secret-preserving
ACME PUT, parent-wide scope acknowledgement and conservative certificate coverage
before redirect enablement. Existing change-store authorization/stale/replay/unknown
semantics are reused. Eight new TLS cases pass within the 65-test check. Updated
English operator/agent context and review handoff. No runtime dependencies changed,
no production certificate/redirect setting changed, no candidate deployment started.

2026-10-22 — synchronized agent navigation, module/state map, architecture wording
and D02/D14 relationship against 0.6.0; added the independent review handoff.
Documentation-only: references/tool inventory checked, no runtime or production
changes. Existing 57-test evidence is historical feature validation.

2026-10-22 — domain/DNS workflow (D14): owned domain/zone projections, contextual
TTL-cached fixed-origin public DNS, separate write authorization/OAuth consent,
per-account operations and durable actor-bound previews/receipts. Five fixed
operations, stale checks, account reservation, no retries, provider verification
and explicit read-based reconciliation. New integration tests pass locally (57).
No production hosting/DNS mutations have been performed for testing.
Deployment, read-only production SDK probes and write-scope rejection passed.
H57 private operation policy/trusted NS are configured; current tokens retain their
original scope. GitHub About description updated to match the expanded scope.

2026-10-22 — account-root `log.txt` identified and read through H57 filemanager API;
only metadata/counts were printed. Added dedicated fixed-file MCP read (D13),
account isolation/metadata/range/redaction/SDK tests and English operator/agent
documentation. No WordPress dependency, caller paths or runtime dependency changes.
Local `npm run check` passes (44 tests); production deployment and independent
MCP discovery/account-log read passed. H93 remains deferred.

2026-10-22 — verified existing domain/subdomain and access/error MCP tools on H57.
Added explicit `smoke:hosting` for repeatable live read verification without log
payload output, plus HTTP/subprocess coverage and operator instructions. Runtime
tool contracts remain at 0.4.0; this change does not redeploy the application or
enable WordPress Manager. The new helper is included in future deployment archives.
Verification: `npm run check` passes (39 tests); the new helper also passes against
production H57 with nonempty access/error streams. No runtime dependency changes.

2026-10-22 — clarified standard shared-hosting scope (D12) in README, package and
local ignored plugin descriptions, deployment documentation and agent context.
VPS compatibility remains untested, not categorically impossible. GitHub repository
About metadata also updated. Local plugin source is 0.1.2; no installed/cloud plugin
release was published. Code map reviewed: module structure and runtime unchanged.
JSON metadata, synchronized manifests, description lengths, links and exclusions
checked; application tests were not rerun for these description-only changes.

2026-10-22 — configuration and WordPress diagnostics (D11), shared tool requirement
catalog and common metadata/read inspection. Added safe site detail projection,
opaque ID route validation and honest log absence handling. Map, capabilities,
operator documentation and tests updated together. Deployment and configuration-only
MCP smoke verified. No runtime dependency changes.

2026-10-21 — deployed 0.3.0: domain/subdomain and WordPress reads (D09/D10), bounded
HTTP, opt-in log paths and structured credential redaction. SSH secret placement and
key formatting were corrected. Assess key rotation if it was stored outside Secrets;
never place key values in documentation or logs.

- Candidate 0.12.0: eight-hour remembered stage owner login, logout and readable
  per-plan preview (D23). Full check passes 117 tests/types/build. Real browser with
  dummy local credentials reached a second plan without login; logout then required
  login again. No approval button was clicked or hosting mutation executed. Session
  hash persistence, absolute expiry, credential binding, rotation, cookie flags,
  stale forms, CSRF and cross-plan isolation are regression-tested. Deployed successfully as recorded above.

- Version 0.13.0 adds hostname-derived bounded fresh DB/user names and an owner-only
  completed-result password view, plus minimal responsive hash-authorized CSS (D24).
  Full check passes 120 tests/types/build. Dummy browser login/result/reveal passed;
  no real password was displayed to the agent and no hosting target was created.
  Naming, expired applied receipt login, no-MCP-secret output, stale sessions,
  private-file mode/size/symlink/identity checks and CSP hash have regressions.
  Real provider acceptance of the new naming and actual install remain unverified.

- Patch 0.13.1 applies the owner's brand gradient (120deg, rgb(217,30,127) to
  rgb(214,31,168)) to stage-page primary buttons and brand text, with matching pink
  neutral/focus colors. Full 120-test check/types/build passes; dummy browser visual
  inspection passed. CSP still authorizes only the exact static style hash. No
  hosting path, plan, credential or authorization behavior changes.

- 0.17.1 corrects pre-write validator limits after live metadata showed a normal
  13.4 MB JS worker and comma-containing font names. The first 0.17 attempt refused
  before core-repair preparation or target writes. Same-job guarded continuation
  accepts only this pre-write refusal; archive/tree/checksum checks remain mandatory.
  Real-tar regressions include a >8 MiB file and comma-containing font path.

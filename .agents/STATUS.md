# Status and handoff

Updated: 2026-10-22.

- Production 0.9.0 is deployed from `cccf886` through successful Deploy MCP run
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

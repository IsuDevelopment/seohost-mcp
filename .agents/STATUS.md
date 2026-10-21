# Status and handoff

Updated: 2026-10-22.

- Release 0.6.0 is deployed from code commit `556b134` through GitHub Actions run
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
- Local `npm run check` passes: types, 57/57 tests and build. Automated provider
  tests use schema fixtures and the real MCP SDK; live verification is listed below.
- Configuration readiness uses loaded settings and never probes provider access.
  WordPress details revalidate installation ownership and return safe fields only.
  Metadata inspection shares log policy without downloading bytes; incomplete
  provider listings do not establish absence.
- After the owner corrected H57 credentials, only the MCP application was restarted.
  Live `list_domains` through the production MCP SDK succeeds for H57. WordPress
  inventory remains denied with HTTP 403. Targeted diagnostics confirm the key's
  effective commands include `wordpress`, but account configuration reports
  `wordpress=OFF`; the session's general WordPress feature flag alone is insufficient.
  WordPress Manager needs provider/account-level enablement before inventory can
  be verified. H93 setup is deferred by the owner; it was not retried. No log contents
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
  change. Request H57 WordPress Manager enablement, then verify WordPress inventory,
  log metadata and Range behavior. H93 credentials are deferred. Full owner OAuth
  login remains a separate client check.
- Independent review is pending. [REVIEW.md](REVIEW.md) identifies the 0.6.0 diff,
  inspection order and verification gaps; it does not represent review approval.

## Recent changes

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

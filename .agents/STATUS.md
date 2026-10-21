# Status and handoff

Updated: 2026-10-22.

- Release 0.4.0 is deployed from code commit `799738b` through GitHub Actions run
  `39686166152`; Check run `39686143680` and deployment both passed.
- Version 0.5.0 adds `read_account_log` for fixed account-root `log.txt`, bringing
  the catalog to twelve read-only tools. Production upgrade pending verification.
- Local `npm run check` passes: types, 44/44 tests and build. Automated provider
  tests use schema fixtures and the real MCP SDK; live verification is listed below.
- Configuration readiness uses loaded settings and never probes provider access.
  WordPress details revalidate installation ownership and return safe fields only.
  Metadata inspection shares log policy without downloading bytes; incomplete
  provider listings do not establish absence.
- Independent live verification on 2026-10-22 passed: HTTPS health reports 0.4.0,
  unauthenticated MCP returns 401, Bearer SDK discovers eleven tools and configuration
  diagnostics succeed for both accounts without DirectAdmin API calls.
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
- Next: request H57 WordPress Manager enablement, then verify WordPress inventory,
  log metadata and Range behavior. H93 credentials are deferred. Full owner OAuth
  login remains a separate client check.

## Recent changes

2026-10-22 — account-root `log.txt` identified and read through H57 filemanager API;
only metadata/counts were printed. Added dedicated fixed-file MCP read (D13),
account isolation/metadata/range/redaction/SDK tests and English operator/agent
documentation. No WordPress dependency, caller paths or runtime dependency changes.

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

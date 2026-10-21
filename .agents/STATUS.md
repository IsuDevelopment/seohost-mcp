# Status and handoff

Updated: 2026-10-22.

- Release 0.4.0 is deployed from code commit `799738b` through GitHub Actions run
  `39686166152`; Check run `39686143680` and deployment both passed.
- Eleven read-only MCP tools, including new `get_server_capabilities`,
  `get_wordpress_info` and `get_wordpress_log_info` diagnostics.
- Local `npm run check` passes: types, 38/38 tests and build. Automated provider
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
  inventory remains denied: a targeted provider check confirms HTTP 403, replacing
  the previous 401 authentication failure. Verify the key's effective WordPress
  permissions and account feature availability without granting unrestricted access.
  H93 was not retried; its last observed result remains HTTP 401. No log contents
  were downloaded, and subdomain/log permissions are not yet verified.
- WordPress log access requires narrow private `wordpressLogRoots`, optional per-site
  `wordpressLogPaths`, provider filemanager access and separate live verification.
  Metadata is not an atomic lock against concurrent filesystem swaps; use trusted
  account-owned installations. No tool enables logging or accepts caller paths.
- Next: resolve H57 WordPress authorization and H93 credentials, then verify
  account-specific subdomain/log permissions, WordPress inventory, log metadata
  and Range behavior. Full owner OAuth login remains a separate client check.

## Recent changes

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

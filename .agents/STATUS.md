# Status and handoff

Updated: 2026-10-22.

- Release 0.4.0 is deployed from code commit `799738b` through GitHub Actions run
  `39686166152`; Check run `39686143680` and deployment both passed.
- Eleven read-only MCP tools, including new `get_server_capabilities`,
  `get_wordpress_info` and `get_wordpress_log_info` diagnostics.
- Local `npm run check` passes: types, 38/38 tests and build. Provider behavior is
  verified with schema fixtures and real MCP SDK tests, not live Login Key calls.
- Configuration readiness uses loaded settings and never probes provider access.
  WordPress details revalidate installation ownership and return safe fields only.
  Metadata inspection shares log policy without downloading bytes; incomplete
  provider listings do not establish absence.
- Independent live verification on 2026-10-22 passed: HTTPS health reports 0.4.0,
  unauthenticated MCP returns 401, Bearer SDK discovers eleven tools and configuration
  diagnostics succeed for both accounts without DirectAdmin API calls.
- After the owner supplied Login Keys, only the MCP application was restarted.
  Loaded settings now report credentials for both accounts, but live domain and
  WordPress inventory requests return HTTP 401 / UNAUTHORIZED. Provider read access
  is not established. The owner confirmed that usernames are DirectAdmin account
  logins, not key IDs. A safe loaded-settings check found no surrounding whitespace,
  quote/escaped-newline artifacts or URL-shaped key values on either account; this
  does not verify the secrets themselves. Pending: key-value confirmation, expiry,
  remaining uses and source-IP restrictions. Avoid repeated failing probes or
  broadening permissions before resolving authentication. No log contents were downloaded.
- WordPress log access requires narrow private `wordpressLogRoots`, optional per-site
  `wordpressLogPaths`, provider filemanager access and separate live verification.
  Metadata is not an atomic lock against concurrent filesystem swaps; use trusted
  account-owned installations. No tool enables logging or accepts caller paths.
- Next: correct the rejected private credentials/restrictions, restart the
  application and verify account-specific provider permissions, WordPress inventory,
  log metadata and Range behavior. Full owner OAuth login remains a separate client
  check. Initial provider read attempts were rejected; no successful inventory reads
  are claimed.

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

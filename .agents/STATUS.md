# Status and handoff

Updated: 2026-10-22.

- Source release 0.4.0 has eleven read-only MCP tools. New diagnostics:
  `get_server_capabilities`, `get_wordpress_info` and `get_wordpress_log_info`.
- Local `npm run check` passes: types, 38/38 tests and build. Provider behavior is
  verified with schema fixtures and real MCP SDK tests, not live Login Key calls.
- Configuration readiness uses loaded settings and never probes provider access.
  WordPress details revalidate installation ownership and return safe fields only.
  Metadata inspection shares log policy without downloading bytes; incomplete
  provider listings do not establish absence.
- Latest confirmed production release is 0.3.0 from code commit `d4358b6`, deployed
  on 2026-10-21 through Actions run `39668025800`. HTTPS, unauthenticated rejection,
  Bearer MCP and eight-tool discovery passed then; hosting reads were not performed.
- The owner is configuring per-account Login Keys. Their current contents/status
  have not been inspected during this update. After editing private env/config,
  application restart is required. A configured key is not proof of read permissions.
- WordPress log access requires narrow private `wordpressLogRoots`, optional per-site
  `wordpressLogPaths`, provider filemanager access and separate live verification.
  Metadata is not an atomic lock against concurrent filesystem swaps; use trusted
  account-owned installations. No tool enables logging or accepts caller paths.
- Next: publish/verify CI for 0.4.0 and deploy through the existing manual workflow.
  Verify application discovery/configuration only while the owner supplies keys;
  live provider reads, filemanager/Range support and full owner OAuth login remain
  separate verification tasks. Preserve private env/config and OAuth state.

## Recent changes

2026-10-22 — configuration and WordPress diagnostics (D11), shared tool requirement
catalog and common metadata/read inspection. Added safe site detail projection,
opaque ID route validation and honest log absence handling. Map, capabilities,
operator documentation and tests updated together. No runtime dependency changes.

2026-10-21 — deployed 0.3.0: domain/subdomain and WordPress reads (D09/D10), bounded
HTTP, opt-in log paths and structured credential redaction. SSH secret placement and
key formatting were corrected. Assess key rotation if it was stored outside Secrets;
never place key values in documentation or logs.

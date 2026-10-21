# Status and handoff

Updated: 2026-10-21.

- Version 0.3.0 implements eight read-only MCP tools: existing server/domain/web-log
  reads plus subdomain and WordPress installation inventory and WordPress debug logs.
- WordPress logs are disabled without private `wordpressLogRoots`; optional per-site
  `wordpressLogPaths` supports custom layouts. No debug enablement or caller paths.
- Local `npm run check` passes: types, 28/28 tests and build. New APIs are verified
  against provider-schema fixtures, not live Login Key calls.
- Live authenticated MCP preflight still reports version 0.1.0 and no configured
  hosting credentials across its two accounts. No live hosting reads are verified.
- GitHub `production` has six deployment variables. First deployment run
  `39665654039` passed checks/build but stopped before SSH because
  `SEOHOST_SSH_PRIVATE_KEY` was empty. The owner reports setting a key; its location
  and name are being clarified. The workflow now reports the missing secret clearly.
- Existing local SSH access to the hosting account works. The app dependency graph
  matches the locked runtime packages; the private scripts directory is prepared.
  A deployment using this trusted connection can proceed without uploading a key.
- Next: publish/verify CI for 0.3.0, deploy and check HTTPS/MCP; configure per-account
  Login Keys privately and verify inventory, filemanager permissions and Range
  behavior before enabling narrow WordPress log roots. OAuth full owner login remains
  a separate client check. Private env/config/OAuth state must survive deployment.

## Recent changes

2026-10-21 — added provider subdomain and WordPress reads (D09/D10), shared bounded
HTTP transport, private log path policy, SDK/security tests and operator documentation.
Code map and capability catalog updated together. No new runtime dependencies.
Metadata/download checks are not atomic isolation against concurrent path swaps;
trusted account-owned sites are required. Inventory covers provider-known installs.

2026-10-21 — shared English agent memory established (D07) and deployment configured
with one owner-supplied SSH secret and six variables (D08). Initial code published
on `origin/main`; the initial 16-test suite and GitHub Check runs passed.

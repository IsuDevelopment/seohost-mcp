# Status and handoff

Updated: 2026-10-21.

- Version 0.3.0 implements eight read-only MCP tools: existing server/domain/web-log
  reads plus subdomain and WordPress installation inventory and WordPress debug logs.
- WordPress logs are disabled without private `wordpressLogRoots`; optional per-site
  `wordpressLogPaths` supports custom layouts. No debug enablement or caller paths.
- Local `npm run check` passes: types, 29/29 tests and build. New APIs are verified
  against provider-schema fixtures, not live Login Key calls.
- Live authenticated MCP preflight still reports version 0.1.0 and no configured
  hosting credentials across its two accounts. No live hosting reads are verified.
- GitHub `production` has six deployment variables and the SSH secret. The owner
  had stored the private key as a variable; it was migrated directly to Secrets and
  the plaintext variable deleted, without printing or storing its value locally.
  Assess/rotate that shared host key because variables are not secret storage.
- Deployment run `39667602508` passed checks/build but stopped before code transfer:
  the supplied key could not be parsed (`error in libcrypto`). The workflow now
  normalizes CRLF/escaped newlines and JSON-quoted key text and validates parsing
  before SSH. Ephemeral key fixtures verified all four input forms and mode 600.
- Existing local SSH access to the hosting account works. The app dependency graph
  matches the locked runtime packages; the private scripts directory is prepared.
  A deployment using this trusted connection can proceed without uploading a key.
- Next: retry the corrected workflow, deploy and check HTTPS/MCP; configure per-account
  Login Keys privately and verify inventory, filemanager permissions and Range
  behavior before enabling narrow WordPress log roots. OAuth full owner login remains
  a separate client check. Private env/config/OAuth state must survive deployment.

## Recent changes

2026-10-21 — added provider subdomain and WordPress reads (D09/D10), shared bounded
HTTP transport, private log path policy, SDK/security tests and operator documentation.
A follow-up hardens JSON/PHP/WordPress credential redaction and key input parsing.
Code map and capability catalog updated together. No new runtime dependencies.
Metadata/download checks are not atomic isolation against concurrent path swaps;
trusted account-owned sites are required. Inventory covers provider-known installs.

2026-10-21 — shared English agent memory established (D07) and deployment configured
with one owner-supplied SSH secret and six variables (D08). Initial code published
on `origin/main`; the initial 16-test suite and GitHub Check runs passed.

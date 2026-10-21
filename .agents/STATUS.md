# Status and handoff

Updated: 2026-10-21.

- Version 0.3.0 is deployed on production from code commit `d4358b6` through GitHub
  Actions run `39668025800`. Check and Deploy MCP both passed.
- Eight read-only MCP tools: server/account discovery, domains, subdomains,
  WordPress installations, web logs and explicitly enabled WordPress debug logs.
- Local and CI `npm run check`: types, 29/29 tests and build. Security/SDK fixtures
  cover isolation, path bounds, metadata, ranges and plain/JSON/PHP redaction.
- Independent live verification: HTTPS health returns 0.3.0, unauthenticated MCP
  returns 401, authenticated SDK discovers eight tools and confirms writes disabled.
  No production hosting reads were performed.
- The two configured production accounts have no hosting Login Keys yet. Domain,
  subdomain and WordPress inventory/log reads need private per-account credentials
  with verified read permissions. Do not claim successful live provider reads.
- WordPress logs remain disabled without private `wordpressLogRoots`. Optional
  `wordpressLogPaths` supports custom layouts. Verify live provider detection,
  filemanager permissions and Range behavior before enabling narrow roots.
- GitHub `production` has one SSH secret and six non-secret variables. The workflow
  normalizes multiline/CRLF/escaped/JSON-quoted key inputs and validates parsing
  before SSH. Ephemeral fixtures checked all four forms and mode 600.
- Deployment preserved private env/config, OAuth state and the CloudLinux dependency
  symlink. No new runtime dependencies or hosting mutations were introduced.
- Next: privately configure Login Keys, confirm account-specific read permissions
  and inventory, then opt in to narrowly scoped log reads. Full owner OAuth login
  remains a separate client verification; Bearer MCP was verified in production.

## Recent changes

2026-10-21 — shipped domain/subdomain and WordPress reads (D09/D10), shared bounded
HTTP transport, private log policy, tests and English operator documentation.
Map, capabilities and decisions updated together. First workflow deployment verified.
Metadata/download checks are not atomic isolation against concurrent path swaps;
use trusted account-owned sites. Inventory covers provider-known installations.

2026-10-21 — shared English agent memory (D07) and manual deployment configuration
(D08). Fixed secret placement and private-key text formatting before the successful
deployment. Assess rotation of the shared host key if it was stored outside Secrets;
key values must never enter project memory or logs.

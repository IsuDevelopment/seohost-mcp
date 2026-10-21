# Status and handoff

Updated: 2026-10-21.

- Version 0.2.0: five MCP tools, domain/log reads, HTTP/stdio and OAuth.
- Initial code and agent workflow published on `origin/main` in commit `d896abd`.
- Check and manual Deploy MCP workflows are versioned. Production deployment of
  this code/workflow has not been performed or verified in these sessions.
- Historical OAuth notes describe an earlier installation; they do not establish
  deployment of the current code. Real account details remain outside Git.
- GitHub environment `production` and all six non-secret deployment variables are
  configured. The owner still needs to set `SEOHOST_SSH_PRIVATE_KEY` using the
  existing key authorized for the hosting account. No private key was uploaded.
- SSH preflight confirmed the existing app is version 0.1.0, its installed production
  dependency graph matches the candidate lockfile, and the configured Node binary
  exists. Created the missing private `scripts` directory for the workflow backup
  precondition; no code replacement or restart was performed.
- Next operational step: add the SSH secret, then verify the manual deployment,
  HTTPS, authentication and complete OAuth client connection. OAuth-only installs
  need a separate authenticated test: without Bearer, that MCP smoke step is skipped.

## Recent changes

2026-10-21 — refined project memory, added an AI capability catalog and standardized
documentation on English. Review memory for every change; update only affected
documents. Keep a module-level code map and optional temporary task handoffs.
D07 supersedes D06's mandatory per-change STATUS entry. Updated agent entry points,
memory documents, public README and OAuth guide. Runtime behavior is unchanged.
Documentation checks cover relative links, referenced paths and whitespace.
Deployment configuration now uses one owner-supplied SSH secret and six variables
(D08); hosting access and dependency compatibility were checked without reading
the server env or modifying application code.

2026-10-21 — initial publication and shared Codex/Claude workflow.
Local `npm run check` passed: types, 16/16 tests and build. Deployment tests simulate
provider restart and HTTPS probes; they do not verify production SSH.
Those results apply to the initial code. A fresh `npm run check` also passed after
this update to documentation and deployment variable references: types, 16/16 tests
and build. Production deployment remains unverified.

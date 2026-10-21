# SeoHost MCP — agent context

Standalone MCP server for SeoHost/DirectAdmin accounts, TypeScript and Node.js >=22.23.2.
Version 0.2.0: HTTP/stdio, Bearer/OAuth, domain and web-log reads. One installation
owner can access all explicitly configured accounts. Hosting writes are unavailable.

Read in order:

1. [WORKFLOW.md](WORKFLOW.md) — work rules and completion criteria.
2. [CODEMAP.md](CODEMAP.md) — module responsibilities, important tests and flows.
3. [ARCHITECTURE.md](ARCHITECTURE.md) — boundaries, security and extension points.
4. [DECISIONS.md](DECISIONS.md) — accepted choices and their rationale.
5. [STATUS.md](STATUS.md) — current scope, verification and next steps.
6. [CAPABILITIES.md](CAPABILITIES.md) — AI-facing tools and development operations.

Operator documentation: [README](../README.md), [logs](../docs/LOGS.md),
[OAuth](../docs/OAUTH.md), [deployment](../docs/DEPLOYMENT.md),
[GitHub Actions](../docs/GITHUB-ACTIONS.md), [security](../SECURITY.md).

## Project memory

Keep concise, versioned Markdown alongside the code. The code map answers where;
architecture explains constraints; decisions explain why; status records what is
verified and what remains; capabilities describe what AI clients can actually do.
Code determines current behavior: fix documentation when it disagrees.
Git holds the detailed history.

Review memory for every change, but edit only affected documents. Avoid function
inventories, repeated rules and entries that add no useful context. Use a temporary
`.agents/tasks/<task-name>.md` for work spanning sessions; see WORKFLOW.
An external memory database or vector index is unnecessary at this project size.

Write project documentation and agent instructions in English. Everything under
`.agents/` is intended for publication with the repository. Never put secrets,
real account details or raw logs here.

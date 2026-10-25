# SeoHost MCP — agent context

Standalone MCP server for SeoHost/DirectAdmin accounts, TypeScript and Node.js >=22.23.2.
The product targets standard SeoHost shared hosting. VPS compatibility is untested;
do not infer either full support or endpoint absence from the VPS label.
Version 0.12.0: HTTP/stdio, Bearer/OAuth, inventory, configuration/site/log diagnostics,
account/database/backup metadata, owner-confirmed fresh WordPress staging, opt-in private gzip database exports, log summaries, domain/DNS diagnostics, site redirects, web-log, fixed account-root `log.txt` and explicitly enabled
WordPress debug-log reads. One installation
owner can read all configured accounts. Planned domain/DNS/TLS writes require separate
authorization and per-account operation allowlists; see D14/D15/D17 and the
[domain/DNS contract](../docs/DOMAIN-DNS.md) and [TLS contract](../docs/TLS.md).

Read in order:

1. [WORKFLOW.md](WORKFLOW.md) — work rules and completion criteria.
2. [CODEMAP.md](CODEMAP.md) — module responsibilities, important tests and flows.
3. [ARCHITECTURE.md](ARCHITECTURE.md) — boundaries, security and extension points.
4. [DECISIONS.md](DECISIONS.md) — accepted choices and their rationale.
5. [STATUS.md](STATUS.md) — current scope, verification and next steps.
6. [CAPABILITIES.md](CAPABILITIES.md) — AI-facing tools and development operations.

For the next independent code review, also read [REVIEW.md](REVIEW.md): release
baseline, inspection order, evidence requirements and verification gaps. It is a
review handoff, not an approval or proof that the implementation is correct.

Operator documentation: [README](../README.md), [logs](../docs/LOGS.md),
[OAuth](../docs/OAUTH.md), [deployment](../docs/DEPLOYMENT.md),
[WordPress reads](../docs/WORDPRESS.md),
[database exports](../docs/DATABASE-EXPORTS.md),
[fresh stage workflow](../docs/WORDPRESS-STAGE.md),
[staging/migration requirements](../docs/WORDPRESS-MIGRATIONS.md),
[diagnostics](../docs/DIAGNOSTICS.md), [hosting diagnostics](../docs/HOSTING-DIAGNOSTICS.md), [domain/DNS workflow](../docs/DOMAIN-DNS.md),
[certificates/HTTPS](../docs/TLS.md), [site redirects](../docs/REDIRECTS.md),
[GitHub Actions](../docs/GITHUB-ACTIONS.md), [security](../SECURITY.md).

## API documentation first

Before investigating or implementing a provider operation, read the existing local
API research in `docs/api/`: `00-zakres.md`, `05-indeks-api.md`, the relevant topic
and endpoint/model files, and `sources/h57-swagger.json`. For PHP, start with
`02-domeny-php.md`; for WordPress, `03-wordpress.md` and `endpoints/wordpress.md`.
This private, ignored directory exists in the owner's workspace and is intentionally
absent from public clones. Do not publish it or ask the owner for documentation
already present there. If unavailable, use official provider documentation.

The research is dated evidence, not proof that a Login Key can perform an operation.
Check contract freshness and permissions separately. Read [PHP API findings](../docs/PHP.md)
for the current missing plugin contract; do not substitute the native DA selector
for SeoHost PHP Changer. See WORKFLOW for the required evidence order.

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

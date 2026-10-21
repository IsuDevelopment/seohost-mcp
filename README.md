# SeoHost MCP

Read-only MCP integration for **standard SeoHost shared hosting** accounts using
DirectAdmin.

Version 0.4.0: a standalone TypeScript/Node.js server with HTTP and stdio transports,
Bearer and built-in OAuth authentication, domain/subdomain and WordPress inventory,
and bounded reads of web-server and existing WordPress debug logs.

## Hosting scope

This project targets account-level features of standard SeoHost shared hosting.
It does not provide VPS provisioning, root access or operating-system administration.
**VPS compatibility has not been tested.** DirectAdmin can also be available on a
VPS, but equivalent endpoint availability and permissions must be verified for that
installation; having a VPS alone does not establish compatibility.
See [SeoHost's explanation of hosting panels](https://seohost.pl/pomoc/panel-klienta-directadmin).

The bundled deployment workflow targets an existing CloudLinux Node.js application
on shared hosting. It does not provision a server or constitute a generic VPS
deployment procedure. Individual hosting reads still require configured Login Keys
and separately verified permissions.

## Working with Codex and Claude

Start with [AGENTS.md](AGENTS.md) and the [agent context](.agents/README.md).
Both agents share the code map, architecture, decisions and project status.
Review this context for every change; update affected documents in the same commit.
Write project documentation and agent instructions in English.
See the [AI capability catalog](.agents/CAPABILITIES.md) for tools and development operations.

## Getting started

```sh
nvm use
npm ci
npm run setup:local
npm run check
npm start
```

Test the running HTTP server with `npm run smoke`. Available tools:
`get_server_info`, `list_servers`, `resolve_server`, `get_server_capabilities`,
`list_domains`, `list_subdomains`, `list_wordpress_sites`, `get_wordpress_info`,
`get_wordpress_log_info`, `read_web_log` and `read_wordpress_log`.
See [logs, aliases and key setup](docs/LOGS.md),
[WordPress inventory and logs](docs/WORDPRESS.md) and
[configuration and deployment](docs/DEPLOYMENT.md). MIT license.

To verify live domain/subdomain lists and access/error log reads for one explicit
account/domain, use `npm run smoke:hosting -- --server primary --domain example.com`.
It reports counts/status without printing logs; see [hosting verification](docs/LOGS.md#verify-live-hosting-reads).

[Diagnostics](docs/DIAGNOSTICS.md) distinguish loaded configuration readiness from
unverified provider permissions and inspect WordPress details/log metadata safely.

## Deployment

Each installation needs its own configuration and authentication. Hosting tools
require separate Login Keys for the selected accounts. Account configuration,
secrets and OAuth state remain private.

[GitHub Actions: checks and SSH deployment](docs/GITHUB-ACTIONS.md).
Deployment is started manually from `main`; it backs up the previous code,
restarts one application and checks HTTPS.

For built-in OAuth without an external identity provider, see
[setup and limitations](docs/OAUTH.md).
Setup command: `npm run setup:oauth -- .env.production`.

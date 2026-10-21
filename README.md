# SeoHost MCP

Version 0.4.0: a standalone TypeScript/Node.js server with HTTP and stdio transports,
Bearer and built-in OAuth authentication, domain/subdomain and WordPress inventory,
and bounded reads of web-server and existing WordPress debug logs.

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

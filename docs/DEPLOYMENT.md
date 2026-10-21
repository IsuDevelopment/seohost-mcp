# Deployment

## Supported scope

The intended target is standard SeoHost shared hosting accounts using DirectAdmin.
VPS compatibility is untested; endpoint availability, panel configuration and Login
Key permissions must be verified independently. The bundled SSH deployment assumes
an existing CloudLinux Node.js application on shared hosting, not VPS provisioning
or root/system administration. See [hosting scope](../README.md#hosting-scope).

## Runtime

Node.js 22.23.2 or newer. No external database or OpenAI API key is required.
The application uses MCP SDK v1 stateless Streamable HTTP with JSON responses.
Version 0.4.0 exposes eleven tools, including configuration readiness, WordPress
details and log metadata [diagnostics](DIAGNOSTICS.md) alongside inventory/log reads.
Hosting operations are read-only. WordPress log access requires
private root allowlists and provider permissions; see [WORDPRESS.md](WORDPRESS.md).

## Local

```sh
nvm use
npm ci
npm run setup:local
npm run check
npm start
```

From another terminal: `npm run smoke`. Local setup creates a random token in a private
`.env` without printing it or overwriting an existing file. HTTP refuses to start without
a token or complete OAuth configuration. `/healthz` is public and contains no account data.

## Local MCP client (stdio)

Use `node --env-file-if-exists=.env /absolute/path/to/dist/src/stdio.js` with the working
directory set to the project root, or set MCP_CONFIG_FILE to an absolute JSON path.
Build first. Stdio trusts the local process owner and does not need the HTTP token.
Logs use stderr; stdout is reserved for MCP messages.

## Configuration

Copy `config/servers.example.json` to `config/servers.json`, customize accounts, then set
MCP_CONFIG_FILE. Each entry points to environment variable names for DirectAdmin
credentials. Configure an existing Login Key with `npm run setup:hosting -- .env`.
Unknown properties and invalid server IDs/URLs are rejected. Arbitrary server IDs are
supported; the public example contains placeholder domains. Numeric hosting IDs can
also be configured privately; see [LOGS.md](LOGS.md).

## SeoHost / CloudLinux Node.js

1. Prepare a dedicated domain with valid DNS and TLS.
2. Create a Node.js 22.23.2 application in production mode, app root outside public_html,
   e.g. `node-apps/seohost-mcp`. Use `deploy/start.cjs` as startup file.
3. Build locally with `npm ci && npm run check`. Upload `dist`, `deploy/start.cjs`, `config`,
   `package.json` and `package-lock.json` to that app root. No tests or TypeScript compiler
   are required at runtime; dist/test may be omitted.
4. Install production dependencies in the CloudLinux environment with
   `npm ci --omit=dev --ignore-scripts`, or the panel's NPM Install action. Respect the
   host-managed node_modules symlink. Do not upload platform-specific dev dependencies.
5. Set runtime environment variables in the panel or in a mode-600 `.env` in the app root:
   HOST=0.0.0.0, PORT=3000, MCP_PUBLIC_URL=https://your-domain/mcp,
   MCP_CONFIG_FILE=config/servers.json and a unique MCP_AUTH_TOKEN of at least 32 characters.
   Startup loads `.env` in-process; existing runtime env takes precedence.
6. Restart only this application through the Node.js panel. Never restart other apps.
7. Check `/healthz`, verify unauthenticated `/mcp` returns 401, then run the SDK smoke test
   against the public HTTPS URL using the deployment token (do not print or commit it).

The actual Host header must match MCP_PUBLIC_URL, including a nonstandard port if used.
Configure proxies to preserve Host. Do not trust arbitrary forwarded headers.
Browser Origin headers must be explicitly allowed with MCP_ALLOWED_ORIGINS; requests with
no Origin header are accepted after normal token authentication. CORS browser clients are
not implemented in this initial release.

The startup wrapper imports into the same process so Passenger/lsnode can manage the listener.
The host may need to replace its generated starter file at deploy/start.cjs with this wrapper.

## Optional OAuth

For a self-hosted login UI, configure the built-in OAuth server using
`npm run setup:oauth -- .env`. Its private SQLite state must survive deployments;
see [OAUTH.md](OAUTH.md) for configuration and limitations.

Alternatively, configure an external authorization server. The external adapter
validates access tokens issued by that provider.
Set MCP_OAUTH_ISSUER, MCP_OAUTH_AUDIENCE (exactly MCP_PUBLIC_URL), and comma-separated
MCP_OAUTH_SUBJECTS (explicit allowed user sub values). The initial adapter expects an
RS256 provider with JWKS at `<issuer>/.well-known/jwks.json`, such as the existing Auth0
pattern. Each token must contain `mcp:read`. Configure this scope and the client redirect
URL at your provider. No existing ISU panel audience or user access is inherited.

Resource metadata: `/.well-known/oauth-protected-resource/mcp`, plus
`/api/mcp/oauth-protected-resource` for hosts that intercept .well-known paths.
The 401 challenge advertises the latter. Metadata returns 503 when OAuth is not configured.
Each installation must verify its own complete OAuth client connection.
Before hosting mutations are added, extend authorization to enforce operation scopes and
allowed serverIds rather than granting every authenticated user all configured accounts.

## Open source

MIT license. The package is private to prevent accidental npm publication; this does not
restrict publishing the source repository.
Keep `.env` and real config out of git. Private deployment notes, account research and
installed plugin metadata are excluded by `.gitignore`.

## GitHub Actions

See [GITHUB-ACTIONS.md](GITHUB-ACTIONS.md) for the manual SSH deployment workflow,
required repository settings, verification and rollback behavior.

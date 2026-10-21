# Built-in OAuth for SeoHost MCP

The authorization server and protected MCP endpoint run in one application.
An external identity provider is optional. This mode supports one installation
owner and has no public user registration.

## Owner setup

With Node.js 22.23.2 or newer, run from the project directory:

```sh
npm run setup:oauth -- .env.production
```

The script asks for an owner username, exact application redirect URIs and a new
password of at least 16 characters. Password input is hidden. Only a scrypt hash
with a random salt is saved in the private configuration file; the existing MCP
token and other settings are preserved. External OAuth issuer settings are disabled.
Never send passwords in chat.

For local use, select `.env` instead of `.env.production`. Restart the application
after changes. In production, place configuration in the private `.env` inside
the application root, outside `public_html`.

Copy redirect URIs from the target client's configuration. The explicit
`MCP_OAUTH_REDIRECT_URIS` allowlist compares complete URIs without wildcards.
The server advertises authorization response issuer identification (`iss`).
Use the exact callback shown by the client when connecting, including any
connection-specific callback.

## Endpoints

| Path | Purpose |
| --- | --- |
| `/.well-known/oauth-authorization-server` | Authorization server metadata |
| `/.well-known/oauth-protected-resource/mcp` | Protected MCP resource metadata |
| `/oauth/register` | Public client registration with an allowed callback |
| `/oauth/authorize` | Owner login and consent form |
| `/oauth/consent` | Password, cookie and Origin checks; code issuance |
| `/oauth/token` | Code + PKCE exchange for an access token |
| `/oauth/revoke` | Token revocation |
| `/mcp` | Protected MCP endpoint |

Supported flow: `authorization_code`, PKCE `S256`, public clients
(`token_endpoint_auth_method=none`), scope `mcp:read`. The required `resource`
parameter must equal `MCP_PUBLIC_URL` during both authorization and code exchange.
Codes and consent forms expire after five minutes. Access tokens last one hour.
There are no refresh tokens; expiration requires another login.

## Storage and limitations

- State uses the private SQLite file selected by `MCP_OAUTH_STATE_FILE`, default
  `data/oauth.sqlite`. Node.js 22.23.2 includes the required `node:sqlite` module,
  marked experimental in that version.
- SQLite synchronizes application processes on the same host. Use local disk,
  not NFS or a shared file across hosts. State survives restart.
  Do not overwrite `data/` during updates.
- The database stores token hashes, code hashes, clients and pending consents.
  Access tokens are not stored in plaintext. The owner password is configured
  only as a hash.
- Consent requires a single-use form, a matching HttpOnly/SameSite cookie and the
  application's own Origin. HTTPS cookies use Secure. The form loads no external resources.
- Five failed logins block attempts for one minute. This is a global limit for
  the single owner and may temporarily block the owner too. Registration is
  limited to 100 clients, with at most 100 pending consents.
- There is no client management UI, multiple-user support, MFA or per-server
  permissions. Extending hosting capabilities requires reviewing authorization.
- The owner OAuth password is separate from DirectAdmin passwords and Login Keys.

## Verification

`npm run check` checks TypeScript, runs tests and builds the application.
The OAuth test covers login/consent, CSRF, invalid passwords and PKCE, single-use
codes, token reads by another instance, a real MCP SDK call and revocation.

Against an explicitly configured deployment, run:

```sh
node --env-file=.env.production scripts/smoke-oauth.mjs
```

This probes discovery, client registration, the form and consent denial.
Each run creates one test client without issuing an access token.
Full owner login and the target client connection require separate verification.
Historical installation notes do not verify deployment of the current release;
see the shared [project status](../.agents/STATUS.md). Keep account-specific
deployment notes private and excluded from Git.

## References

- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- https://developers.openai.com/plugins/build/auth

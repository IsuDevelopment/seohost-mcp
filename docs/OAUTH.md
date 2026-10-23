# Built-in OAuth for SeoHost MCP

The authorization server and protected MCP endpoint run in one application.
An external identity provider is optional. This mode supports one installation
owner and has no public user registration.

## Owner setup

With Node.js 22.23.2 or newer, run from the project directory:

```sh
npm run setup:oauth -- .env.production
```

The script asks for an owner username, exact HTTPS application redirect URIs,
optional native Codex loopback support and a new
password of at least 16 characters. Password input is hidden. Only a scrypt hash
with a random salt is saved in the private configuration file; the existing MCP
token and other settings are preserved. External OAuth issuer settings are disabled.
Never send passwords in chat.

For local use, select `.env` instead of `.env.production`. Restart the application
after changes. In production, place configuration in the private `.env` inside
the application root, outside `public_html`.

Copy redirect URIs from the target client's configuration. The explicit
`MCP_OAUTH_REDIRECT_URIS` allowlist compares complete URIs without wildcards.
Native Codex callbacks use an ephemeral loopback port and a random callback path,
so copying one observed URL into that list will not cover the next connection.
Set `MCP_OAUTH_CODEX_LOOPBACK=true` in the private configuration (or select it during
setup) to enable a separate narrowly bounded enrollment policy:
`http://127.0.0.1:<port>/callback/<nonce>` or the literal IPv6 `[::1]` equivalent.
Ports must be 1–65535 without leading zeros; the nonce must contain 12–128 ASCII
letters/digits/underscores/hyphens. No localhost DNS, alternate IP notation, remote
host, credentials, query, fragment, encoding, arbitrary path or URI scheme is
accepted. The switch is false by default; HTTPS callbacks still use the exact
allowlist. Native-only installations may leave that HTTPS list empty.

This policy allows enrollment of the actual callback; the complete URI is then
stored per client and must match **exactly**, including port and nonce, during
authorization and code exchange. It is not a wildcard redirect during login or
proof of client identity. PKCE, owner login and scope-specific consent remain
mandatory. The consent screen shows the destination. Disabling the switch blocks
new native authorization/code exchanges and native refresh grants; already-issued
access tokens retain their normal expiry unless revoked.

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
| `/oauth/token` | Code + PKCE exchange, or rotating refresh-token exchange |
| `/oauth/revoke` | Token revocation |
| `/mcp` | Protected MCP endpoint |

Supported grants: `authorization_code` and `refresh_token`, PKCE `S256`, public clients
(`token_endpoint_auth_method=none`), scope `mcp:read`. Accounts with enabled write
operations also support an explicit `mcp:read mcp:write` consent. Existing read-only
grants are never upgraded automatically, and account allowlists still apply.
Reconnect/re-authorize with the write scope to use change previews/apply. The required `resource`
parameter must equal `MCP_PUBLIC_URL` during both authorization and code exchange.
The private SeoHost MCP plugin package from version 0.1.3 requests both scopes
in its portable and compatibility MCP configurations. Updating the plugin does
not upgrade an existing grant: reconnect and verify that the consent form
explicitly includes hosting/DNS changes before using write tools. Account
operation allowlists still apply independently of that consent.
Codes and consent forms expire after five minutes. Access tokens last one hour.
Clients declaring both supported grants during DCR receive a refresh token. Grant
arrays are validated as supported sets independent of order; code-only clients
(and registrations omitting `grant_types`) retain access-token-only behavior.
Unsupported/duplicate/empty/malformed grant metadata is rejected; accepting
`refresh_token` is backed by a real token endpoint flow, not just relaxed metadata.

Refresh tokens rotate on every successful exchange, retain the original seven-day
absolute expiry, and are bound to the registered client, MCP resource, consented
scopes and callback policy. Send `grant_type=refresh_token`, `refresh_token` and
`client_id` to `/oauth/token`. The `resource` field may be omitted (the original
single resource is retained); a supplied value must match. Optional scope may
narrow existing permissions but never expand them. Disabling hosting writes
removes write scope on the next default refresh. Re-consent is required to gain it.

Only hashes are persisted. Used refresh hashes are retained until expiry to detect
replay; replay revokes the whole family, including its access tokens. Revoking an
active family access token or its refresh token also revokes the family. SQLite
transactions serialize rotation across app instances; concurrent reuse requires
reauthentication. Families are bounded at 256 refresh hashes and the store at
10,000 retained refresh hashes; reaching a rotation bound requires re-login.
New code exchanges return a temporary error at the store cap. Existing OAuth state
without refresh fields remains readable; existing clients are not silently upgraded.

## Storage and limitations

- State uses the private SQLite file selected by `MCP_OAUTH_STATE_FILE`, default
  `data/oauth.sqlite`. Node.js 22.23.2 includes the required `node:sqlite` module,
  marked experimental in that version.
- SQLite synchronizes application processes on the same host. Use local disk,
  not NFS or a shared file across hosts. State survives restart.
  Do not overwrite `data/` during updates.
- The database stores access/refresh token hashes, family/replay metadata, code hashes,
  registered grant types, clients and pending consents.
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
codes, token reads by another instance, a real MCP SDK call and revocation. Desktop
regression tests cover the captured native DCR metadata, strict loopback opt-in,
exact callback binding, refresh rotation/persistence/replay, client/resource/scope
boundaries, expiry, concurrent reuse, family revocation and legacy code-only flow.

On 2026-10-23 the installed Codex binary was run against a disposable local OAuth
capture service. It requested `authorization_code` + `refresh_token` and an ephemeral
`http://127.0.0.1:<port>/callback/<nonce>` URI. The capture intentionally rejected
registration; no production client, access token or owner login was created. Local
desktop/server logs independently confirmed the reported two-field rejection.
No production `.env` or credentials were printed during that investigation.
The subsequently authorized 0.10.0 deployment on 2026-10-23 passed workflow checks
and independent HTTPS verification: native DCR with both grants, login/consent form,
strict bad-metadata rejection, denial callback issuer/state and invalid refresh
rejection. The owner's application-level loopback setting is effective. The probe
created one verification client and issued no access/refresh token. Full desktop
owner login and actual refresh remain client checks; see project status for the
release commit/run. Existing private OAuth state and configuration were preserved.

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
- https://www.rfc-editor.org/rfc/rfc7591.html
- https://www.rfc-editor.org/rfc/rfc8252.html
- https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14

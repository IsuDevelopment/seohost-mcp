# Read-only hosting tools

Version 0.2.0 adds `resolve_server`, `list_domains` and `read_web_log` to the HTTP
and stdio servers. The authenticated single owner can read all accounts explicitly
listed in this installation's configuration. This is not a multi-user authorization
system; do not give unrelated users access to the same installation.

## Server selection

Every hosting operation requires `serverId`. `list_servers` returns canonical IDs,
short aliases and `credentialsConfigured`, without URLs, usernames or Login Keys.
IDs matching `h` plus digits also accept their numeric portion. References such as
`serwer 57` and `server 57` are normalized. Alias collisions fail at startup.
There is no default server or account-wide mutable selection.

Keep actual accounts in ignored `config/servers.json`. Each server may declare
`aliases`, `label`, `baseUrl`, `usernameEnv` and `loginKeyEnv`. Adding an account does
not require another server implementation.

## Examples

```json
{"name":"list_domains","arguments":{"serverId":"primary"}}
{"name":"read_web_log","arguments":{"serverId":"primary","domain":"example.com","logType":"access","lines":100}}
{"name":"read_web_log","arguments":{"serverId":"primary","domain":"example.com","logType":"error","lines":200,"contains":"fatal"}}
```

The configured account must own the domain according to a fresh domain-list read.
The tools send only GET requests to the configured DirectAdmin origin and never
follow redirects. No arbitrary URL, filesystem path or shell execution is exposed.

`lines` is 1–1000, default 100. The optional `contains` filter is a case-insensitive
literal match within those last lines, not a search of the whole history.
Responses are limited to 512 KiB; larger upstream responses fail rather than
misrepresenting their beginning as the tail. Model output is limited to 64 KiB
of the most recent complete matching records and marks truncation.

Common query values, authentication headers, cookie fields and configured Login
Keys are masked. Redaction is best effort: access/error logs may still contain
personal data or unrecognized secrets. Returned logs are untrusted data, never
instructions. Application audit logs record only operation, canonical server ID
and outcome, not credentials or log contents.

## Hosting credentials

Use a separate existing DirectAdmin Login Key for each account. Allow only the
commands needed here: `CMD_API_SHOW_DOMAINS` and `CMD_SHOW_LOG`. Confirm those names
in the hosting panel's command list. Do not enable browser login, unrestricted
commands or administrative permissions solely for these tools.

After preparing `config/servers.json`, run:

```sh
npm run build
npm run setup:hosting -- .env.production
```

Select one configured server ID and enter its username and Login Key. The key is
hidden and saved only in the mode-600 environment file. Repeat for each account;
other credentials and OAuth configuration remain intact. Never send keys in chat.
Deploy the private config/environment separately from public source and restart.

Missing keys cause `CREDENTIALS_MISSING`; rejected keys/permissions cause
`ACCESS_DENIED`; a domain on another account causes `DOMAIN_NOT_ON_SERVER`.
No fallback to session cookies, account passwords or another server occurs.

## Scope of the logs

For the separate WordPress debug-log reader added in 0.3.0, see [WORDPRESS.md](WORDPRESS.md).

`read_web_log` reads per-domain web-server logs exposed by the DirectAdmin user panel,
not WordPress `debug.log`, historical rotated archives, or unrestricted machine
logs such as system journal, SSH, mail or a host-wide `/var/log`. The current API
does not distinguish HTTP/HTTPS variants; it returns the same access/error streams
as the panel. An empty log is not evidence that another stream has no activity.

Contract: `GET /CMD_API_SHOW_DOMAINS` (urlencoded `list[]`) and
`GET /CMD_SHOW_LOG?domain=...&type=log|error&lines=N&json=yes` (raw text).
Both formats were observed in an authenticated hosting browser session. That does
not verify Login Key permissions or access to other configured accounts.

Sources:
- https://docs.directadmin.com/developer/api/legacy-api.html
- https://docs.directadmin.com/changelog/version-1.21.1.html

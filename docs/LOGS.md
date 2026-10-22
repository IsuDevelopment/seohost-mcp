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
{"name":"list_subdomains","arguments":{"serverId":"primary","domain":"example.com"}}
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
commands needed here: `CMD_API_SHOW_DOMAINS`, `CMD_API_SUBDOMAINS` (subdomain lists)
and `CMD_SHOW_LOG` (access/error reads). Confirm those names
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

## Verify live hosting reads

The regular `npm run smoke` does not contact DirectAdmin. To verify domain lists,
subdomains and both web-log types through the running MCP application, explicitly
select an account and one of its domains:

```sh
node --env-file=.env.production scripts/smoke-hosting.mjs --server primary --domain example.com
# With local .env configuration:
npm run smoke:hosting -- --server primary --domain example.com
```

This requires `MCP_PUBLIC_URL` and `MCP_AUTH_TOKEN` for the target MCP application;
DirectAdmin credentials remain on that application host. It reads at most five
requested lines from each log, prints only counts/status/truncation and never prints
domain names, log records, tokens or provider error text. Any denied or failed read
causes a nonzero exit code. A successful empty log is reported as `empty: true`;
it does not prove logging is disabled or that another domain/stream is empty.
The check does not test WordPress or modify hosting configuration. It runs only
when explicitly invoked, not automatically during deployment.

## Scope of the logs

For the separate WordPress debug-log reader added in 0.3.0, see [WORDPRESS.md](WORDPRESS.md).

### Account-root log.txt

Version 0.5.0 adds `read_account_log` for the fixed `log.txt` file in the hosting
account home/root, visible through SSH/SFTP or the account file manager. This is
account-relative `log.txt`, not the machine's absolute `/log.txt` or a website URL.
It does not require WordPress Manager or a domain:

```json
{"name":"read_account_log","arguments":{"serverId":"primary","lines":100}}
{"name":"read_account_log","arguments":{"serverId":"primary","lines":200,"contains":"error"}}
```

The provider must allow `/api/filemanager/list` and `/api/filemanager/download`.
Before each read, metadata must resolve to the account root and show a regular
non-symlink `log.txt`. Missing files produce `LOG_NOT_FOUND`; incomplete listings
do not establish absence. There is no caller path, file creation or logging toggle.
The name does not prove which application writes the file or whether it contains
all account errors. This is not an unrestricted system-log reader.

Line/filter/redaction rules match the other log tools. Downloads are bounded to
512 KiB; valid suffix ranges discard any initial partial record. Providers ignoring
Range cannot serve a larger file through this tool. Output is capped at 64 KiB;
inspect `truncated` and `byteWindowLimited`. Metadata and download are separate,
not atomic against a concurrent filesystem swap; use trusted account-owned files.

### Domain web-server logs

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

## Compact log summaries (0.9.0)

Use `summarize_web_log` for alerts before requesting raw details. It fetches one
bounded tail, examines all retained lines and includes rare PHP fatal findings
regardless of frequency. Error and access summaries have different counts; neither
proves complete history, uptime or infection. See [summary limits](HOSTING-DIAGNOSTICS.md).

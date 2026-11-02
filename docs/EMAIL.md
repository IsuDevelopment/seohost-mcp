# Mailbox management

Candidate 0.22.0 adds ordinary DirectAdmin mailboxes. Creation and changes run
directly through MCP, with **no browser preview, approval page or owner-login
step**. Deletion requires a fresh preview and explicit confirmation in the chat.
This policy applies only to mailboxes; WordPress and domain/DNS/TLS retain their
existing approval contracts.

## Tools and account policy

Every tool requires an explicit configured `serverId`. Domains must be freshly
listed on that account. System/default hosting mailboxes, bulk deletion, rename,
arbitrary API requests and caller-supplied passwords are refused.

| Tool | Behavior | Additional authorization |
| --- | --- | --- |
| `list_email_accounts` | Ordinary mailbox addresses, daily send limits and suspension metadata; offset/limit pagination. | Read access. |
| `get_email_configuration` | Exact mailbox quota/usage in bytes and provider-supplied secure IMAP/SMTP hosts, ports and username. | Read access. |
| `create_email_account` | Direct creation; defaults to 1024 MiB and 100 outgoing messages/day. Existing mailbox is never overwritten. | Write scope and `create_email_account` account operation. |
| `update_email_account` | Direct quota/limit changes and/or generated password reset. At least one change is required. | Write scope and `update_email_account` account operation. |
| `plan_email_account_deletion` | Five-minute address/quota/usage/limit snapshot, exact confirmation string and permanent-loss warning. No provider mutation. | Write scope and `delete_email_account` account operation. |
| `delete_email_account` | Exact actor/account plan, hash and `DELETE user@example.com` confirmation string; fresh snapshot comparison before deletion. | Same deletion policy and fresh explicit user consent in chat. |
| `get_email_operation` | Same-actor/account durable receipt; never resumes a write or releases a lock. | Write scope. |

Add only the required operations to the account's private `writeOperations`
array, preserving unrelated settings. All three mailbox operations are disabled
by default. HTTP requires a separate write Bearer token or an OAuth `mcp:write`
grant; stdio trusts the local owner but still enforces account policy.
Capabilities report exact operation configuration, not provider availability.

`user` is the lowercase local part, separate from `domain`. This release supports
a conservative ASCII subset: letters, numbers, dots, underscores and hyphens;
no consecutive/trailing dots. Explicit zero quota/send limit means unlimited.
Quota reductions do not remove messages. Password reset invalidates the previous
password; clients must be updated by the owner.

## Credentials without a browser workflow

Create/reset generates a strong password internally, writes and syncs it to a
private file **before** sending the provider request, then reports only its file
reference. Files live under `mailbox-credentials/<operationId>.json` beside the
configured change SQLite file, outside any public web root. Directory mode is
700, files 600; permissive/symlink directories and existing files are refused.
The directory must belong to the running owner. Same-UID processes are trusted.

The owner retrieves the credential through their existing authenticated hosting
access (for example SSH or the private file manager). This is not an approval
step and never blocks creation. The MCP does not return passwords, expose a web
page or accept passwords through model-visible arguments. Agents must never read
these files into chat. Credentials are retained for owner recovery and never
automatically deleted. They are separate from operation receipts and backups.

## Execution and uncertainty

For create/update, generate a UUID `requestId` once per user action. Keep exactly
that ID and input when repeating a request after a client timeout. An atomic
SQLite lookup binds actor/account/request ID to one operation; different input
with the same ID is rejected. Applied/failed/running/unknown replay returns the
original receipt without another POST. Terminal receipts are retained for seven
days; do not rely on idempotency after that retention window.

All mailbox writes share durable account reservations with hosting/WordPress
writes. Fresh preconditions, private credential retention, one form POST and
fresh provider verification run in one call. Quota/limit and unchanged suspension
are checked; password setting relies on explicit provider success, not an IMAP
login probe. Failure before POST is `failed`; any unconfirmed write or failed
post-write verification is `unknown`. Unknown and interrupted `applying`
operations retain the account lock. Inspect the provider and retained credentials
manually; never retry with a new ID or unlock automatically. A retained candidate
password on an unknown receipt is not proof that the provider accepted it.

Deletion permanently removes the mailbox and its messages. **No message backup
is created by these tools.** Show that fact and the exact address before asking
the user to confirm. The string/hash binds the selected plan; it is not technical
proof of human consent. External panel changes can race checks; snapshots are
optimistic, not an atomic lock on provider messages. A changed observed snapshot
requires another plan and confirmation. Applied deletion replay does not delete
a subsequently recreated mailbox.

## Provider contract and verification

The adapter uses the documented fixed legacy `CMD_API_POP`: GET `full_list` and
quota details, POST `create`, `modify` or single-user `delete`. Creation quota uses
MiB while modification uses bytes. Only explicit provider `error=0` confirms the
write; provider response bodies and passwords never enter audit or SQLite.
Reads support JSON and nested URL-encoded metadata within the shared response cap.
See the [official DirectAdmin legacy API](https://docs.directadmin.com/developer/api/legacy-api.html#email-accounts-and-password-changing).

Client configuration comes from the fixed modern
`/api/email-config/mobileconfig?email=...&format=xml` contract. Only allowlisted
scalar fields are projected; no XML entity/DTD resolution occurs. Ambiguous,
insecure or mismatched profiles are refused rather than replaced with guessed
hostnames. Configuration failure does not change an already applied create.

Read-only production verification confirmed empty mailbox inventory on the
owner-selected domain and the current XML profile field names. CRUD, password
retention, concurrency, uncertainty and confirmation are tested with fixtures;
**no live mailbox was created, modified or deleted for verification**. Real
nonempty inventory, CRUD and external IMAP/SMTP delivery remain unverified.
This feature does not deploy itself or change production allowlists.

No DNS, MX, SPF, DKIM, DMARC, forwarding, vacation responders, message reading,
message sending or client-device configuration is performed. Reading connection
settings alone does not establish public mail delivery or authentication readiness.

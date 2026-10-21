# Security

Never include hosting keys, MCP tokens, OAuth tokens, passwords or unredacted logs in issues.
Report security problems privately to the repository maintainer through the repository's
private security reporting feature when available. Do not publish an exploit against a live account.

HTTP fails closed without a token or complete OAuth configuration. Stdio trusts the local
process owner. Infrastructure tools do not contact hosting accounts. Future hosting abilities
must enforce authorization and explicit server selection independently of MCP annotations.

MCP tokens and DirectAdmin Login Keys are separate credentials. Keep secrets out of git,
public web roots, tool results and client-side JavaScript. This project is an independent
integration, not an official SeoHost or DirectAdmin product.

WordPress log reads require explicit private root allowlists and fresh provider
installation/file metadata. Callers cannot provide file paths or enable debug.
Metadata checks and download are not atomic against concurrent filesystem changes;
use trusted account-owned installations, not hostile tenant isolation. Redaction
is best effort, not a guarantee that output is free of secrets or personal data.
See [WordPress reads](docs/WORDPRESS.md) for limits and provider permissions.

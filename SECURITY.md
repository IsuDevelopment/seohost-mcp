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

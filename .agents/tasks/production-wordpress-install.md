# Production WordPress and source-domain redirects

Owner requested a fresh production installation on an existing domain and 301
redirects from two other domains on H57. Exact domains, inspected state and upcoming
plan references stay in private ignored `.artifacts/`, never in this public note.

- Existing MCP supported only fresh staging. D30 adds the separate production plan;
  see WORDPRESS-INSTALL.md, DECISIONS and current STATUS.
- 147 tests/types/build pass. Code/docs are ready; deployment/configuration and an
  exact real owner browser review are next. No live redirects or WP files changed.
- Reuse prior administrator email from the owner's request; do not expose passwords.
- After deployment enable only the required H57 operations with verified private
  configuration backup, then prepare the production plan. Never automate consent.
- Once its exact owner receipt and conversational confirmation exist, apply through
  the MCP and poll with stdio alive. Only after target verification, separately plan
  and apply requested source redirect edits; retain their config backups and all
  existing source WP files/databases. Verify public HTTPS/root/path behavior.
- Existing staging must remain unchanged. No cleanup or backup deletion is approved.

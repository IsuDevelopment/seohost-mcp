# PHP management: API findings

PHP management through MCP is requested but **not implemented**. No PHP version,
INI setting or extension was changed during research. Start with the owner's private
`docs/api/02-domeny-php.md`, API index and cached Swagger before further investigation.

## Documented contracts and account evidence

| Mechanism | Evidence | Consequence |
| --- | --- | --- |
| Modern DirectAdmin API | The current H57 `/static/swagger.json` was re-read on 2026-10-22: 269 paths; no PHP version/INI/selector route. The PHP-named routes are phpMyAdmin SSO, which is unrelated. | The bundled API specification does not supply the PHP Changer contract. This does not prove no plugin API exists. |
| Native DA domain selector | Official documentation describes `POST /CMD_API_DOMAIN`, `action=php_selector`, `domain`, `php1_select`. Reads use `CMD_API_ADDITIONAL_DOMAINS?action=view`. Values select configured slots, not version strings. | The observed H57 domain returns `has_php_selector=no`, without a version/slot map. Do not send guessed native selector writes to control the plugin. |
| Native DA subdomain selector | Official documentation describes `POST /CMD_SUBDOMAIN`, `action=php_selector`, parent `domain`, `subdomain` and `php1_select`. | A separate native feature; compatibility with the SeoHost plugin and inheritance are unverified. |
| SeoHost PHP Changer | Local research and SeoHost's guide identify a separate plugin. The GUI exposes version/INI controls; versions apply immediately when selected. Basic-auth plugin GETs returned an HTML "add a domain" screen despite successful account domain inventory. | Neither a GUI button nor this HTML establishes a supported programmatic contract or an empty hosting account. No writes should be inferred from it. |

The local research already recorded the missing plugin API contract on 2026-10-21.
The 2026-10-22 documentation/read checks confirm that this gap remains. Do not
replace this user-level operation with CustomBuild, root administration, arbitrary
SSH commands, `.htaccess` editing or browser-session credentials in MCP.

## Required before implementing the requested tools

Confirm the plugin's supported read/write routes and verbs, Login Key authentication,
account/domain/subdomain selection, version values, response/error schema and effect
scope. Establish how to preserve unrelated INI/extension settings and verify a change
without executing a public PHP diagnostic script. The current missing input is this
plugin contract, not another copy of the existing DA API documentation.

Then add a dedicated adapter and safe PHP/version reads. Add version writes through
the existing actor-bound plan/apply/receipt mechanism, with an exact per-account
operation allowlist, fresh before-state checks, verification and no blind retries.
Keep requested changes explicit; creating a domain alone must not select a PHP
version automatically. INI and extension edits need their own bounded contracts.

## Idea: optional local diagnostics adapter

Owner suggestion, recorded 2026-10-22; backlog only, not an approved implementation
or a working MCP capability. When MCP runs on the hosting account, investigate
reading that account's domain PHP configuration locally if no supported API exists.

- Prefer bounded configuration reads inside the existing Node adapter; a separate
  PHP file is not necessary merely to read files. First establish the provider's
  actual configuration sources, permissions, handler overrides and inheritance.
- Report configured version and evidence source separately from the version serving
  web requests. Local CLI PHP or one shared helper cannot establish every domain's
  effective web runtime. Missing/ambiguous evidence must remain unknown.
- Opt in per account; local access covers only the account where MCP runs. It does
  not establish access to other configured accounts or remote hosting servers.
- Accept owned domain IDs, never caller paths. Bound reads and validate canonical
  paths/file types; return only selected non-secret fields, never raw INI, environment
  or site configuration. No arbitrary execution or PHP/configuration writes.
- If effective-runtime probing needs a PHP helper, design authentication, narrow
  output and deployment/removal explicitly before implementation. Do not publish
  `phpinfo()` or silently add scripts to hosted websites.

This would be a separate, documented local read contract rather than a claimed
PHP Changer API. Verify feasibility and security before adopting it.

Sources: [DirectAdmin API and server Swagger](https://docs.directadmin.com/developer/api/),
[native domain PHP selector](https://docs.directadmin.com/changelog/version-1.48.0.html),
[native subdomain PHP selector](https://docs.directadmin.com/changelog/version-1.61.0.html),
[multiple PHP versions](https://docs.directadmin.com/webservices/php/multiple-php.html),
[SeoHost PHP Changer guide](https://seohost.pl/pomoc/jak-zmienic-wersje-php-na-serwerze-www).

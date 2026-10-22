# PHP Selector MCP request

Objective: expose current/available PHP versions and reviewed version changes for
the owner's SeoHost PHP Changer through MCP. Implementation remains pending.

- Start with the private local API research listed in `.agents/README.md`.
- Findings and required contract: `docs/PHP.md`. Existing research explicitly lacks
  the plugin API; live Swagger re-check confirms no modern selector route.
- Native selector reports disabled on the observed H57 domain. Do not use guessed
  native slot writes or infer the custom plugin's contract from its GUI.
- No PHP mutations, runtime changes, new credentials or deployment performed.
- Owner's backlog idea: optional local read-only diagnostics when MCP runs on the
  hosting account; see `docs/PHP.md`. Assess existing Node filesystem reads before
  adding a PHP helper. Distinguish configured version from actual web runtime.
  This is not authorization to deploy helper scripts or start implementation.
- Next: establish the plugin read/write/authentication/scope/verification contract,
  then implement adapter, scoped plans and tests; update affected project memory.

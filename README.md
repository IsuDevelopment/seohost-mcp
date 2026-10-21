# SeoHost MCP

## Praca z Codex i Claude

Zacznij od [AGENTS.md](AGENTS.md) i [kontekstu w `.agents/`](.agents/README.md).
Mapa kodu, decyzje, granice architektury i stan projektu są wspólne dla obu agentów.
Każda zmiana wymaga przeglądu i aktualizacji tej dokumentacji w tym samym commicie.

Wersja 0.2.0: samodzielny serwer TypeScript/Node.js, transport HTTP i stdio, Bearer i własny OAuth oraz pierwsze narzędzia hostingu tylko do odczytu.

## Uruchomienie

```sh
nvm use
npm ci
npm run setup:local
npm run check
npm start
```

Test działającego HTTP: `npm run smoke`. Dostępne narzędzia: `get_server_info`, `list_servers`, `resolve_server`, `list_domains` i `read_web_log`. [Logi, aliasy i konfiguracja kluczy](docs/LOGS.md). [Konfiguracja i wdrożenie](docs/DEPLOYMENT.md). Licencja MIT.

## Wdrożenie

Każda instalacja wymaga własnej konfiguracji i autoryzacji. Narzędzia hostingu wymagają osobnych Login Keys wybranych kont. Konfiguracja kont, sekrety i stan OAuth pozostają prywatne.

[GitHub Actions: testy i deploy przez SSH](docs/GITHUB-ACTIONS.md). Deploy uruchamia się ręcznie dla gałęzi `main`; zawiera kopię poprzedniego kodu, restart jednej aplikacji i test HTTPS.

Własne logowanie OAuth bez zewnętrznego dostawcy: [konfiguracja i ograniczenia](docs/OAUTH.md). Konfigurator: `npm run setup:oauth -- .env.production`.

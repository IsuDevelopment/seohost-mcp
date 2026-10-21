# SeoHost MCP — kontekst agentów

Samodzielny serwer MCP dla kont SeoHost/DirectAdmin, TypeScript i Node.js >=22.23.2.
Wersja 0.2.0: HTTP/stdio, Bearer/OAuth, odczyt domen i logów WWW. Jeden właściciel
ma dostęp do wszystkich jawnie skonfigurowanych kont. Brak operacji zapisu hostingu.

Czytaj w kolejności:

1. [WORKFLOW.md](WORKFLOW.md) — sposób pracy i warunki ukończenia zmiany.
2. [CODEMAP.md](CODEMAP.md) — pliki, odpowiedzialności, testy i przepływy.
3. [ARCHITECTURE.md](ARCHITECTURE.md) — granice, bezpieczeństwo i rozszerzanie.
4. [DECISIONS.md](DECISIONS.md) — przyjęte decyzje i ich przyczyny.
5. [STATUS.md](STATUS.md) — aktualny zakres, weryfikacja i dalsze kroki.

Dokumentacja użytkownika: [README](../README.md), [logi](../docs/LOGS.md),
[OAuth](../docs/OAUTH.md), [deploy](../docs/DEPLOYMENT.md),
[GitHub Actions](../docs/GITHUB-ACTIONS.md), [bezpieczeństwo](../SECURITY.md).
Kod rozstrzyga bieżące zachowanie; rozbieżność z dokumentacją trzeba naprawić.
Wszystko w `.agents/` jest przeznaczone do publikacji z repozytorium.

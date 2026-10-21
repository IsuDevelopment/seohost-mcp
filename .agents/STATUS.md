# Stan i przekazanie

Aktualizacja: 2026-10-21.

- Kod 0.2.0: pięć narzędzi MCP, odczyty domen/logów, HTTP/stdio i OAuth.
- Workflow Check i ręczny Deploy MCP są zapisane. Produkcyjny deploy bieżącego
  kodu/workflow nie został wykonany ani zweryfikowany w tej sesji.
- Starsze notatki OAuth wspominają wcześniejszą instalację; nie stanowią dowodu
  wdrożenia obecnego kodu. Szczegóły rzeczywistych kont pozostają poza Git.
- Następny krok operacyjny: skonfigurować środowisko GitHub `production` zgodnie
  z `docs/GITHUB-ACTIONS.md`, a w osobno zleconym wdrożeniu sprawdzić SSH, HTTPS,
  autoryzację oraz pełne połączenie klienta OAuth. OAuth-only wymaga osobnego
  uwierzytelnionego testu; brak Bearer pomija ten etap smoke workflow.

## Ostatnia zmiana

2026-10-21 — przygotowanie pierwszej publikacji kodu i workflow agentów.
Dodano wspólny kontekst `.agents/` i wejścia Codex/Claude, aby kolejne sesje
zachowywały architekturę, decyzje i stan weryfikacji. Mapa sprawdzona na podstawie
obecnych plików; decyzje D01–D05 opisują istniejący kod, D06 ustala workflow.
Weryfikacja lokalna: `npm run check` zakończone powodzeniem (typy, 16/16 testów,
build). Testy deployu używają symulowanego restartu i sond HTTPS; nie są testem
produkcyjnego SSH. Przegląd dokumentacji potwierdził granice modułów i przepływy.

# Workflow Codex i Claude

## Przed zmianą

- Przeczytaj kontekst z README agentów. Sprawdź `git status --short --branch`
  i istniejące zmiany; zachowuj pracę użytkownika i innych agentów.
- Określ problem, oczekiwane zachowanie, dotknięte moduły i zagrożenia.
  Kwestionuj rozwiązania osłabiające bezpieczeństwo lub utrudniające rozszerzanie.
- Czytaj tylko potrzebne pliki. Prywatnych konfiguracji, stanu OAuth i logów
  nie kopiuj do czatu, dokumentacji ani commitów.

## Implementacja

- Wprowadzaj najmniejszą spójną zmianę. Oddziel transport MCP, reguły wyboru konta,
  adapter DirectAdmin i autoryzację; unikaj frameworków bez konkretnej potrzeby.
- Nowe narzędzie: schemat wejścia i rejestracja w `src/server.ts`, reguły konta
  w `src/config.ts`, wywołanie dostawcy w `src/directadmin.ts`. Dodaj testy granic
  bezpieczeństwa i zachowania, zamiast testów kopiujących implementację.
- Nowy zapis hostingu lub wielu użytkowników wymaga najpierw decyzji o zakresach
  operacji i uprawnieniach per konto. Adnotacje MCP nie egzekwują uprawnień.

## Dokumentacja przy KAŻDEJ zmianie

Feature, poprawka, refaktor, zależności, konfiguracja, CI i dokumentacja podlegają
tej samej regule; aktualizację zapisuj w tym samym commicie co zmianę.

- `CODEMAP.md`: aktualizuj odpowiedzialności, punkty wejścia, przepływy i testy.
  Jeśli struktura się nie zmienia, odnotuj krótko wynik przeglądu mapy w STATUS.
- `DECISIONS.md`: dodaj lub zastąp decyzję, gdy zmienia się kontrakt, architektura,
  bezpieczeństwo albo sposób wdrażania. Przy braku nowej decyzji zapisz w STATUS
  „decyzje bez zmian” z krótkim powodem; nie twórz ADR dla literówki.
- `STATUS.md`: uzupełnij bieżący stan i krótki wpis: co, po co, sprawdzenie,
  ograniczenia/dalszy krok, wynik przeglądu mapy i decyzji. Zostawiaj tylko
  kilka ostatnich wpisów; pełna historia jest w Git.
- Aktualizuj odpowiednie `docs/`, README i przykłady przy zmianie zachowania.
  Nie oznaczaj produkcji jako wdrożonej na podstawie buildu lub pushu.

## Weryfikacja i przekazanie

1. Przy zmianie kodu, zależności lub deployu uruchom `npm run check` (typy, testy,
   build). Dla samych dokumentów sprawdź linki i zgodność z kodem.
2. Sprawdź `git diff --check` oraz diff, także `git diff --cached` przed commitem.
   Stage'uj jawne ścieżki; nigdy `git add -f` dla plików ignorowanych.
3. Potwierdź wykluczenia `.env*` poza `.env.example`, `config/servers.json`,
   `data/`, prywatnych notatek, `docs/api/`, `plugins/` i artefaktów.
4. Commit opisuje rezultat i powód. Push nie oznacza deployu; ręczny workflow
   produkcyjny uruchamiaj tylko w zakresie zleconego wdrożenia.
5. W przekazaniu podaj zmianę, wyniki sprawdzeń, commit/push i pozostałe ograniczenia.

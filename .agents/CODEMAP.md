# Mapa kodu

| Plik / katalog | Odpowiedzialność i powód istnienia |
| --- | --- |
| `src/http.ts` | Wejście HTTP, Host/Origin, health/discovery, autoryzacja, transport MCP na żądanie i zamykanie. |
| `src/stdio.ts` | Wejście dla lokalnego procesu; stdout tylko dla MCP, zaufanie właścicielowi procesu. |
| `src/server.ts` | Wersja, rejestracja pięciu narzędzi, schematy, wynik/błąd MCP i bezpieczny audyt. |
| `src/config.ts` | Walidacja env/JSON, adresów i aliasów; rozwiązywanie jawnego konta, bez konta domyślnego. |
| `src/directadmin.ts` | Adapter GET DirectAdmin: lista domen, sprawdzenie własności, logi, limity i redakcja. |
| `src/auth.ts` | Bearer ze stałoczasowym porównaniem hashy; zewnętrzny JWT RS256/JWKS, subject i `mcp:read`. |
| `src/local-oauth.ts` | OAuth właściciela: rejestracja, zgoda, PKCE, tokeny i odwołanie; prywatny stan SQLite. |
| `config/servers.example.json`, `.env.example` | Publiczne szablony bez rzeczywistych kont i sekretów. |
| `scripts/setup-{local,oauth,hosting}.mjs` | Lokalne przygotowanie prywatnego env i poświadczeń. |
| `scripts/smoke.mjs`, `scripts/smoke-oauth.mjs` | Rzeczywisty klient MCP / sondy OAuth; wymagają wskazanego środowiska. |
| `.github/workflows/check.yml` | Push/PR: instalacja lockfile, typy, testy i build. |
| `.github/workflows/deploy.yml` | Ręczny deploy tylko z `main`, środowisko production, SSH ze znanym kluczem hosta. |
| `deploy/package.sh` | Paczka runtime z listy dozwolonych plików, bez prywatnej konfiguracji. |
| `scripts/check-runtime-dependencies.mjs` | Porównanie produkcyjnych grafów lockfile i zainstalowanych wersji przed kopiowaniem. |
| `deploy/remote.sh` | Backup kodu, kopiowanie, restart jednej aplikacji, weryfikacja i rollback. |
| `deploy/start.cjs`, `deploy/verify.mjs` | Bootstrap CloudLinux z env / HTTPS health i odmowa bez poświadczeń. |
| `test/server.test.ts` | HTTP auth, Host/Origin, metody/rozmiar body, prawdziwy SDK HTTP i stdio. |
| `test/directadmin.test.ts` | Izolacja kont, aliasy, walidacja domen, błędy dostawcy, limity, redakcja i SDK. |
| `test/oauth.test.ts` | Zgoda, CSRF, PKCE, jednorazowe kody, współdzielony SQLite, MCP i odwołanie. |
| `test/deploy.test.ts` | Graf zależności, zawartość paczki, podmiana/rollback i zachowanie prywatnych plików. |
| `docs/`, `SECURITY.md` | Kontrakty operatora, konfiguracja i ograniczenia bezpieczeństwa. |
| `AGENTS.md`, `CLAUDE.md`, `.agents/` | Wejścia Codex/Claude i wspólny kontekst pracy. |

## Przepływy

- HTTP → `loadSettings` → Host/Origin → OAuth/discovery/health lub auth MCP →
  nowy `createMcpServer` + stateless transport → narzędzie → adapter DirectAdmin.
- Stdio → `loadSettings(..., false)` → ten sam serwer narzędzi → ten sam adapter.
- Log → jawne konto → świeża lista jego domen → GET `CMD_SHOW_LOG` → limit
  odpowiedzi → ogon/filtrowanie/redakcja → ograniczony wynik. Brak fallbacku konta.
- Deploy → check → allowlista paczki → SSH → zgodność zależności → backup kodu →
  restart → HTTPS + opcjonalny Bearer smoke; błąd po rozpoczęciu kopiowania → rollback.

`dist/` jest generowany z TypeScript, nie edytuj ręcznie. `node_modules/` i `data/`
oraz rzeczywista konfiguracja są prywatnym runtime, nie źródłem prawdy o projekcie.

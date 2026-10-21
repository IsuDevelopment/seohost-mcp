# Własny OAuth dla SeoHost MCP

Serwer autoryzacji i chroniony endpoint MCP działają w jednej aplikacji. Zewnętrzny dostawca logowania nie jest wymagany. To tryb jednego właściciela instalacji; nie ma publicznej rejestracji użytkowników.

## Konfiguracja właściciela

W terminalu z Node.js 22.23.2 lub nowszym uruchom w katalogu projektu:

```sh
npm run setup:oauth -- .env.production
```

Skrypt pyta o login, dokładne adresy powrotu aplikacji i nowe hasło (minimum 16 znaków). Wpisywane hasło jest ukryte. Zapisuje wyłącznie jego hash scrypt z losową solą w prywatnym pliku konfiguracyjnym; zachowuje istniejący token MCP i pozostałą konfigurację. Wyłącza konfigurację zewnętrznego wystawcy OAuth. Nie wysyłaj hasła na czacie.

Dla lokalnego uruchomienia użyj `.env` zamiast `.env.production`. Zmiany wymagają restartu aplikacji. Przy wdrożeniu produkcyjnym konfiguracja trafia do prywatnego `.env` w katalogu aplikacji, poza `public_html`.

Adres powrotu skopiuj z konfiguracji docelowego klienta. Jawna lista `MCP_OAUTH_REDIRECT_URIS` porównuje pełne adresy, bez wildcardów. Serwer zgłasza obsługę identyfikacji wystawcy odpowiedzi (`iss`); ChatGPT może wtedy używać `https://chatgpt.com/connector_platform_oauth_redirect`. Ostateczny callback należy potwierdzić podczas łączenia. Dla callbacków specyficznych dla połączenia dodaj dokładny adres pokazany przez klienta.

## Endpointy

| Adres | Przeznaczenie |
| --- | --- |
| `/.well-known/oauth-authorization-server` | Metadane serwera autoryzacji |
| `/.well-known/oauth-protected-resource/mcp` | Metadane chronionego MCP |
| `/oauth/register` | Rejestracja publicznego klienta z dozwolonym callbackiem |
| `/oauth/authorize` | Formularz logowania i zgody właściciela |
| `/oauth/consent` | Weryfikacja hasła, cookie i Origin; wydanie kodu |
| `/oauth/token` | Wymiana kodu + PKCE na token |
| `/oauth/revoke` | Odwołanie tokenu |
| `/mcp` | Chroniony endpoint MCP |

Obsługiwany przepływ: `authorization_code`, PKCE `S256`, publiczni klienci (`token_endpoint_auth_method=none`), zakres `mcp:read`. Wymagany parametr `resource` musi być identyczny z `MCP_PUBLIC_URL`, zarówno przy autoryzacji, jak i wymianie kodu. Kod i formularz zgody wygasają po pięciu minutach. Token jest ważny godzinę. Nie ma refresh tokenów: po wygaśnięciu wymagane jest ponowne logowanie.

## Przechowywanie i ograniczenia

- Stan jest zapisany w prywatnej bazie SQLite wskazanej przez `MCP_OAUTH_STATE_FILE`; domyślnie `data/oauth.sqlite`. Node.js 22.23.2 zawiera wymagany moduł `node:sqlite` (w tej wersji oznaczony jako eksperymentalny).
- SQLite synchronizuje procesy aplikacji na tym samym hoście. Wymagana lokalna przestrzeń dyskowa; nie współdziel pliku przez NFS ani pomiędzy hostami. Baza przetrwa restart. Nie nadpisuj katalogu `data` przy aktualizacji.
- Baza zawiera hashe tokenów, hashe kodów, klientów i oczekujące zgody. Tokeny dostępu nie są przechowywane w postaci jawnej. Hasło właściciela jest w konfiguracji wyłącznie jako hash.
- Zgoda wymaga jednorazowego formularza, zgodnego cookie HttpOnly/SameSite i własnego Origin. W HTTPS cookie ma flagę Secure. Formularz nie ładuje zewnętrznych zasobów.
- Pięć błędnych logowań blokuje próby na minutę. To globalne ograniczenie jednego konta; może czasowo zablokować również właściciela. Rejestracja jest ograniczona do 100 klientów, a oczekujące zgody do 100.
- Nie ma jeszcze panelu zarządzania klientami, wielu użytkowników, MFA ani uprawnień do poszczególnych serwerów. To pierwszy zakres dla narzędzi infrastrukturalnych. Dodanie operacji hostingowych wymaga rozszerzenia kontroli dostępu.
- Hasło OAuth jest osobne od haseł DirectAdmin i Login Keys H57/H93.

## Weryfikacja

`npm run check` sprawdza TypeScript, buduje aplikację i wykonuje testy. Test OAuth obejmuje logowanie i zgodę, CSRF, nieprawidłowe hasło, błędne PKCE, jednorazowość kodu, odczyt tokenu przez drugą instancję, wywołanie MCP prawdziwym klientem SDK oraz odwołanie tokenu.

OAuth został wdrożony na H57. Testy produkcyjne discovery, rejestracji klienta, formularza i odmowy zgody można uruchomić przez `node --env-file=.env.production scripts/smoke-oauth.mjs` (każde uruchomienie tworzy jeden klient testowy, bez wydawania tokenu dostępu). Pełne logowanie właściciela i połączenie z ChatGPT wymagają osobnej weryfikacji przez właściciela. Stan produkcji jest opisany osobno w [DEPLOYMENT-STATUS.md](DEPLOYMENT-STATUS.md).

## Źródła

- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- https://developers.openai.com/plugins/build/auth

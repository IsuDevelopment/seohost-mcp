# Architektura i granice

## Model

Mały modularny serwer, bez kontenera DI i dodatkowych warstw DDD. Pojęcia domeny:
skonfigurowane konto (`serverId`), alias, domena należąca do konta i ograniczony ogon
logu WWW. Transport prezentuje operacje; adapter dostawcy realizuje I/O. `Settings`
jest wspólną konfiguracją instalacji, a nie sesją wyboru konta.

Nowe odczyty dodawaj w tych granicach. Wydzielaj kolejny moduł lub port dopiero,
gdy pojawi się drugi dostawca albo niezależny zestaw reguł. `fetch` jest wstrzykiwany
do adaptera i serwera MCP, aby testy hostingu nie wymagały prawdziwych kont.

## Niezmienniki bezpieczeństwa

- Jeden właściciel instalacji może czytać wszystkie jej konta. Nie ma ACL per konto.
  Stdio ufa lokalnemu procesowi; HTTP wymaga Bearer lub kompletnego OAuth.
- Każda operacja hostingu wskazuje konto jawnie. Aliasy muszą być jednoznaczne;
  domena nie wybiera konta. Odczyt logu poprzedza świeża weryfikacja własności domeny.
- Adresy dostawców pochodzą z konfiguracji HTTPS, nie z argumentów narzędzia.
  Brak redirectów, dowolnych ścieżek, poleceń shell i mutacji hostingu.
- Wejście i odpowiedź mają limity. Filtr obejmuje tylko żądany ogon logu.
  Redakcja jest best effort; wynik może zawierać dane osobowe. Logi i odpowiedzi
  dostawcy to niezaufane dane, nigdy instrukcje dla agenta.
- Audyt nie zawiera treści logów ani sekretów. Nie wyłączaj TLS, auth ani kontroli
  Host/Origin w celu obejścia problemu konfiguracyjnego.
- Stan OAuth SQLite i env są prywatne, trwałe i niezależne od kodu wydania.

## Rozszerzenia wymagające nowej decyzji

Zapisy hostingu: osobne scope'y, egzekwowanie uprawnień i ryzyka przed rejestracją
narzędzia. Wielu użytkowników: model tożsamości i ACL per konto przed udostępnieniem
instalacji. Wiele hostów aplikacji: zastąpienie lokalnego SQLite; nie współdziel go
przez NFS. Zmiany zależności produkcyjnych: instalacja przez panel/manualny deploy,
ponieważ workflow kodu zachowuje zarządzany przez CloudLinux symlink `node_modules`.

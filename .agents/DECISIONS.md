# Rejestr decyzji

Stan początkowy odtworzony z kodu i dokumentacji 2026-10-21; data nie oznacza
daty wdrożenia. Dopisuj ID, status, kontekst, decyzję i konsekwencję. Zastąpionych
decyzji nie usuwaj: wskaż nowe ID. Weryfikację i drobne zmiany zapisuj w STATUS.

| ID | Status | Decyzja i dlaczego | Konsekwencja |
| --- | --- | --- | --- |
| D01 | przyjęta | TypeScript/Node >=22.23.2, MCP SDK v1, stateless HTTP i stdio współdzielą narzędzia: jeden kontrakt i prosty runtime CloudLinux. | Nie dodawaj stanu wyboru konta do transportu. |
| D02 | przyjęta | Jawne `serverId`, jednoznaczne aliasy, tylko GET i świeża własność domeny: ograniczenie pomyłek między kontami i dostępu do plików. | Nowy odczyt zachowuje izolację; narzędzia zapisu wymagają nowego kontraktu. |
| D03 | przyjęta | Jeden właściciel, Bearer lub lokalny/zewnętrzny OAuth; lokalny PKCE i prywatny SQLite: samodzielna instalacja bez zewnętrznej bazy. | Brak ACL per konto, refresh tokenów i obsługi wielu hostów; nie udostępniaj obcym użytkownikom. |
| D04 | przyjęta | Limity odpowiedzi/ogona, redakcja i audyt bez payloadu: ograniczenie ujawniania danych i zużycia zasobów. | Filtrowanie nie obejmuje pełnej historii; maskowanie nie gwarantuje usunięcia wszystkich sekretów. |
| D05 | przyjęta | Ręczny deploy z `main`, SSH z przypiętym host key, allowlista paczki, backup i rollback kodu: kontrolowane aktualizacje istniejącej aplikacji. | Prywatny runtime i symlink zależności pozostają; zmiana zależności produkcyjnych wymaga manualnej instalacji. Brak zero downtime i rollbacku bazy. |
| D06 | przyjęta | Wspólne instrukcje w `.agents/`, wejścia `AGENTS.md` i `CLAUDE.md`: Codex i Claude korzystają z tego samego kontekstu. | Każda zmiana obejmuje przegląd mapy/decyzji i aktualizację STATUS w tym samym commicie; reguła jest kontraktem pracy, nie automatycznym dowodem zgodności. |

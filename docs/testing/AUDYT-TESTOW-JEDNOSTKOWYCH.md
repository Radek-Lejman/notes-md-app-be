# Audyt testów jednostkowych — notes-app-be

> Data: 2026-10-11 · gałąź `feature/LLM-module` · zakres: testy jednostkowe (`jest`, `src/**/*.spec.ts`)
> Bieżący stan, kategorie niepokrytego kodu i plan e2e: [README.md](./README.md)
> Wymagania: [KONCEPCJA.md](../ai-dev-system/KONCEPCJA.md) — §4 (strategia testów), §5 (ryzyko), warstwa 4 (kryteria `test-auditor`)

## 1. Wymagania, względem których audytowano

| # | Wymaganie | Źródło |
|---|---|---|
| W1 | Unit pokrywa `core/`, utils, mappery, serwisy | §4 |
| W2 | `npm run test:ai` utrzymuje **100%** (statements/branches/functions/lines) dla `infrastructure/ai` i `modules/ai` | §4, `package.json` |
| W3 | `jest` zielony — czerwień nie jest stanem „normalnym” | §2, faza 0 |
| W4 | Intensywność testów wg ryzyka: **wysokie** = `infrastructure/security/**`, `modules/auth/**`, `modules/ai/credentials/**` | §5 |
| W5 | Każde zapytanie o zasoby użytkownika scopowane po `userId` — na poziomie unit: asercja, że `userId` trafia do `where`/parametrów SQL | warstwa 1 (zakazy), §2 konwencja authz |
| W6 | Testy asercją sprawdzają zachowanie, nie tylko „not throw”; bez nadmiernego mockowania | warstwa 4 (`test-auditor` b, c) |
| W7 | Brak globalnego twardego progu coverage — jakość ponad procent | §4 |

## 2. Stan wyjściowy (zmierzony)

| Metryka | Wartość |
|---|---|
| Suity / testy | 43 / 416 — **1 czerwony** (`app.controller.spec.ts`) |
| Coverage globalnie | statements 71.2% · branches 64.9% · functions 64.6% · lines 70.7% |
| `npm run test:ai` (próg 100%) | **czerwony**: statements 93.3% · branches 89.4% · functions 84.1% · lines 93.4% |
| Pliki źródłowe z własnym `*.spec.ts` | 40 z ~110 (bez typów/barreli: 40 z ~85) |

Pokrycie per obszar (lines):

| Obszar | Ryzyko | Lines | Stan |
|---|---|---|---|
| `modules/auth/**` | wysokie | **0%** | brak jakichkolwiek testów |
| `infrastructure/security/services`, `guards`, `filters` | wysokie | 9–33% | brak testów (pokrycie tylko z importów) |
| `infrastructure/security/crypto` | wysokie | 100% | OK |
| `modules/ai/credentials/**` | wysokie | 98.6% | luki gałęzi (linie 36–37, 40) |
| `modules/users` | średnie | 26.7% | brak testów |
| `core/tree` | niskie | 20% | brak testów, a `TreeService` jest używany w `GET /notes/:id` |
| `core/sort`, `core/config`, `core/utils` | niskie | 50–75% | brak bezpośrednich testów |
| `common/**` | niskie | 25–77% | brak testów |
| `infrastructure/database/prisma` | średnie | 42.9% | `isUniqueField` (mapowanie P2002 → 409) bez testu |
| `modules/notes/service` | średnie | 61.5% | `NotesService` 20%, `UserNotesService` 33% — **scoping `userId` niezweryfikowany** |
| `modules/notes/controller` | średnie | 43.3% | brak testów |
| `modules/notes/utils` | średnie | 87.6% | `searchCursorPayload` 33%, `validateNoteFields` 44%, `orderByForSearch` 64% |
| `modules/ai/controller/aiSettings` | średnie | 44.1% | brak testów — łamie W2 |
| `modules/ai/config` | średnie | 50% | brak testów — łamie W2 |
| `modules/ai/rag` | średnie | 83% | `RagRepository` (raw SQL) 50%, `RagIndexer` cykl życia — łamie W2 |

## 3. Wykaz braków

Priorytet: **P0** = łamie wymaganie-bramkę (W2/W3) · **P1** = wysokie ryzyko (W4/W5) · **P2** = logika domenowa średniego ryzyka · **P3** = czyste funkcje niskiego ryzyka.

### P0 — bramki

| ID | Plik | Brak |
|---|---|---|
| B01 | `app.controller.spec.ts` | Test ze scaffoldu oczekuje `"Hello World!"`, serwis od pierwszego commita zwraca `"XXdddXX!"`. Test nie sprawdza niczego istotnego. → przepisać na delegację do `AppService` + kształt `/dashboard`. |
| B02 | `modules/ai/controller/aiSettings.controller.ts` | Brak spec. Niezweryfikowane: `ready` (macierz `requiresAccount` × credential × serverLogin), RAG off ⇒ brak zapytania o statystyki, `testCredential` (done / error / brak odpowiedzi / wyjątek), wykonanie w slocie limitera, `userId` z `CurrentUser`. |
| B03 | `modules/ai/config/aiModule.config.ts` | Brak spec: wartości domyślne, parsowanie `AI_SERVER_LOGIN_EMAILS` (trim, lower-case, puste), `RAG_CHUNK_OVERLAP ≤ chunkSize/2`, cache `aiModuleConfig()`. |
| B04 | `modules/ai/rag/rag.repository.ts` | Metody SQL bez testów: **scoping po `userId`** w `search`/`stats` (W5), parametry zamiast inline, transakcja `replaceChunks` (DELETE → INSERT×n → UPDATE z warunkiem `updatedAt`), konwersja `bigint` → `number`. |
| B05 | `modules/ai/rag/ragIndexer.service.ts` | `onModuleInit` (RAG off, invalidacja innego modelu, błąd init), `onModuleDestroy`, harmonogram, ochrona przed równoległą rundą (`running`). |
| B06 | `modules/ai/rag/ragSearch.service.ts` | getter `model`, `stats`. |
| B07 | `modules/ai/consts/ai.consts.ts` | Limity throttlingu czytane leniwie z configu. |
| B08 | gałęzie AI | `aiRunLimiter` (zwolnienie przy >1 slocie użytkownika), `aiCredentials.agentNeedsAccount`, `ai.service` (assist bez `text`), `assistPrompt:18`, `chunkMarkdown:89`, `embedding-provider.factory` (nieobsługiwany provider), `claude-agent-sdk:135`, `ollama-embedding:25`. |

### P1 — wysokie ryzyko (security, auth, users)

| ID | Plik | Brak |
|---|---|---|
| B10 | `security/services/bruteForceService.ts` | Brak spec. Próg blokady (20 prób), czas blokady (2 min), reset okna po 30 s, `getRetryAfterSeconds` (zaokrąglenie w górę, 0 po wygaśnięciu), ignorowanie prób w trakcie blokady, `reset/resetMany`, `firstLocked`. |
| B11 | `security/guards/bruteForce.guard.ts` | Brak spec. Klucze `ip:` + `acct:` (normalizacja e-mail: trim + lower-case), brak klucza konta bez e-maila, `req.__bfKeys`, nagłówek `Retry-After` + 429 przy blokadzie. |
| B12 | `security/filters/*.ts`, `exceptions/*.ts` | Brak spec. Kształt odpowiedzi 429 i `Retry-After` (brute force i throttler). |
| B13 | `auth/services/auth.service.ts` | Brak spec. **Login**: zły e-mail / złe hasło ⇒ 401 + `recordFailureMany`; sukces ⇒ `resetMany`. **Register**: 409 dla zajętego e-maila, hash bcrypt (nie plaintext). **Refresh**: brak cookie, nieznany użytkownik, `tokenVersion` ≠ (revoke), rotacja. **RevokeAll**. |
| B14 | `auth/services/refreshToken.serivce.ts` | Brak spec. `jti` zapisany w DB, payload z `tokenVersion`; **rotacja**: wykrycie reuse (brak rekordu / `revoked`), wygaśnięcie, unieważnienie starego tokenu przed wydaniem nowego, nieprawidłowy podpis ⇒ 401. |
| B15 | `auth/services/accessToken.service.ts` | Brak spec. Payload `{sub, email}` (bez hasła), podpis/weryfikacja configiem access. |
| B16 | `auth/guards/jwtAuthGuard.guard.ts` | Brak spec. `@PublicEndpoint` omija guard; brak cookie ⇒ 401; zły token ⇒ 401; poprawny ⇒ `req.user`. |
| B17 | `auth/controllers/*.ts` | Brak spec. Ustawianie/czyszczenie cookies, przekazanie `__bfKeys`, `revokeAll` dla `user.sub`, `csrfToken`. |
| B18 | `auth/utils/cookie.utils.ts`, `expiresIn.ts` | Brak spec. Flagi `HttpOnly`, `SameSite`, `Path=/api/auth/refresh` dla refresh, `Max-Age`; czyszczenie łącznie z „ghost” cookie na `/`. |
| B19 | `auth/config/*.ts`, `auth/dto/*.ts` | Brak spec. Domyślne czasy życia, walidacja min/max; DTO: e-mail, min. długość hasła. |
| B20 | `users/users.service.ts` | Brak spec. Mapowanie P2002(email) ⇒ 409, przepuszczanie innych błędów, inkrementacja `tokenVersion`. |
| B21 | `database/prisma/prisma-errror.util.ts` | Brak spec. `isUniqueField` (kod, lista pól, brak `meta.target`). |
| B22 | `common/decorators/*.ts` | Brak spec. `CurrentUser` czyta `req.user`; `PublicEndpoint` ustawia metadane czytane przez guard. |

### P2 — notatki (średnie ryzyko, W5)

| ID | Plik | Brak |
|---|---|---|
| B30 | `notes/service/notes.service.ts` | Brak spec. **Każda** metoda musi mieć `userId` w `where` (W5); `content` pomijany w liście; kursor ⇒ `skip: 1`; brak trafień FTS ⇒ brak drugiego zapytania; `parentIds=[]` ⇒ brak zapytania. |
| B31 | `notes/service/userNotes.service.ts` | Brak spec — delegacja z właściwym `userId`. |
| B32 | `notes/controller/notes.controller.ts` | Brak spec. 404 dla brakującej notatki, 400 dla pustego `q` i zakazanych pól, `userId` z `CurrentUser`. |
| B33 | `notes/service/notesTree.service.ts` | 71%: `expand=parent`, `depth=0`, limit dzieci na rodzica, sortowanie, wielopoziomowość, przerwanie przy braku dzieci. |
| B34 | `notes/service/notesSerach.service.ts` | Brak `fields` ⇒ `[]`, przekazanie kursora. |
| B35 | `notes/utils/searchCursorPayload.ts` | encode/decode round-trip, odrzucanie śmieci / złego `order`. |
| B36 | `notes/utils/validateNoteFields.ts`, `orderByForSearch.ts`, `note.utils.ts`, `notesToTree.ts` | Walidacja pól, `rank`/`-rank` z tie-breakerami, `clampDepth`, round-trip drzewa. |
| B37 | `notes/dto/getNoteQuery.dto.ts`, `searchNotesQueryDto.ts` | Walidacja + transformacja `ToInt` (wartości domyślne, zakresy, `IsIn`). |
| B38 | `notes/utils/markdown/markdownExtensions.ts` | `pageReferenceMarkdown` (render, tokenizer, parse) — 83%. |

### P3 — `core/`, `common/` (czyste funkcje)

| ID | Plik | Brak |
|---|---|---|
| B40 | `core/tree/tree.service.ts` | Brak spec: indeksowanie, `addChild(ren)` (deduplikacja), `updateNode`, `removeNode` (poddrzewo, zakaz usunięcia root), `find`, błąd dla nieznanego id. |
| B41 | `core/sort/parseSort.ts` | Brak spec: default, `-field`, dozwolone pola. |
| B42 | `core/config/env.ts` | Brak spec: trim/puste ⇒ brak, default, `required`, min/max, boolean, `envSecret` (min. bajty, fallback dev, prod). |
| B43 | `core/utils/*.ts`, `core/selector/utils.ts` | Brak spec: limiter per klucz, `fromStringToArray`, `buildFieldSelector`. |
| B44 | `common/utils/time.ts`, `common/transformers/number.transformers.ts` | Brak spec. |
| B45 | `database/prisma/fts/toTsQuery.ts` | 100% tylko przez inne testy — brak asercji wprost (sanityzacja operatorów tsquery to granica bezpieczeństwa). |

### Poza zakresem testów jednostkowych (świadomie)

| Plik | Dlaczego nie unit | Gdzie testować |
|---|---|---|
| `main.ts`, `app.module.ts`, `*/*.module.ts` (poza istniejącymi) | wiring DI i middleware — unit potwierdziłby tylko listę providerów | e2e (bootstrap aplikacji) |
| `security/config/{helmet,csrf,cors,throttle}.config.ts` | statyczna konfiguracja bibliotek; wartość ma tylko efekt na nagłówkach HTTP | e2e: nagłówki CSP/HSTS, CSRF 403 |
| `prisma.service.ts` | `omit` i `$connect` — wymaga realnej bazy | integracja DB |
| Semantyka SQL (FTS, pgvector, `ragIndexedAt`) | mock Prismy nie wykona zapytania | integracja DB (§4) |
| `*.types.ts`, `*.interface.ts`, `index.ts`, DTO bez dekoratorów (`me.dto`, `refresh.dto`) | brak logiki | — |

## 4. Defekty wykryte podczas audytu

Kod produkcyjny w ścieżkach wysokiego ryzyka **nie był zmieniany** (§5: wymaga przeczytania diffa przez człowieka). Defekty potwierdzalne testem jednostkowym mają test `it.failing(...)` — przechodzi, dopóki defekt istnieje, i **zaczerwieni się po naprawie** (wtedy zmienić na `it`).

| ID | Waga | Miejsce | Opis i scenariusz | Test |
|---|---|---|---|---|
| D1 | major | `auth.service.ts:26` | `refresh()` wywołuje `verifyToken` bez `try/catch`. Wygasły/podrobiony refresh token ⇒ `JsonWebTokenError` ⇒ **500** zamiast 401 (`rotate()` mapuje to poprawnie, ale nie dochodzi do niego). | `it.failing` |
| D2 | major | `auth.controller.ts:87` | `revokeAll` nie robi `await` na `authService.revokeAll`. Błąd DB ⇒ klient dostaje 200 „revoked”, sesje **nie są** unieważnione, a odrzucona obietnica jest nieobsłużona (Node ≥15 domyślnie kończy proces). | `it.failing` |
| D3 | major | `auth.controller.ts:63` | `@Throttle({ option: throttleAuthConfig })` — nazwa `option` nie odpowiada żadnemu throttlerowi (`global`, `auth`), więc nadpisanie limitu dla `/auth/refresh` jest ignorowane. | e2e |
| D4 | minor | `throttler-exception.filter.ts:15` | `originalUrl.startsWith('/auth')` — przy prefiksie `/api` zawsze fałsz. Dziś bez skutku (oba TTL = 1 min); log podaje ms z sufiksem „s”. | brak (nieobserwowalne) |
| D5 | minor | `notes.service.ts:17` | `PATCH /notes/:id` na cudzej/nieistniejącej notatce ⇒ Prisma `P2025` ⇒ **500** zamiast 404. Autoryzacja jest poprawna (scoping działa), błędny jest tylko status. | e2e (AC-AUTHZ) |
| D6 | minor | `auth.service.ts:47` | Login dla nieistniejącego e-maila pomija `bcrypt.compare` ⇒ różnica czasu odpowiedzi pozwala enumerować konta. | brak (timing) |
| D7 | minor | `common/utils/time.ts:12,20` | `minutesToSeconds(0)`/`daysToSeconds(0)` rzucają „must be defined” — 0 traktowane jak brak wartości, choć komunikat dopuszcza liczby ≥ 0. Dziś bez skutku (config wymusza ≥ 1). | udokumentowane w teście |
| D8 | minor | `notes.controller.ts:48` | Wynik `validateAndNormalizeFields` jest ignorowany; `fields=title, content` (spacja) ⇒ 400 „Forbidden field” zamiast normalizacji. | udokumentowane w teście |
| D9 | info | `notes.controller.ts:32` | `getAll` loguje całą listę notatek użytkownika na poziomie `log` przy każdym żądaniu (szum, tytuły w logach). | — |
| D10 | info | `refreshToken.serivce.ts:80` | `RefreshTokenService.revokeAll` nieużywane — `AuthService.revokeAll` bumpuje tylko `tokenVersion` (skuteczne, ale rekordy w DB zostają `revoked=false`). | — |
| D11 | minor | `bruteForceService.ts:28` | `getOrCreateEntry()` czyści `lockedUntil` po upływie okna (30 s), więc `recordFailure` w trakcie 2-min blokady **zdejmuje blokadę**. Dziś nieosiągalne przez `BruteForceGuard` (odrzuca zablokowane klucze przed loginem), ale API serwisu jest błędne. *Wykryte przy pisaniu testów.* | `it.failing` |
| D12 | minor | `auth/config/jwt.config.ts:15`, `refreshJwt.config.ts:15` | Fallbacki dev `'default-access-secret'` (21 B) i `'default-refresh-secret'` (22 B) są krótsze niż wymagane przez `envSecret` 32 B — bez `JWT_*_SECRET` aplikacja **nie startuje nawet w dev**; fallback nigdy nie działa. *Wykryte przy pisaniu testów.* | `it.failing` |
| D13 | do weryfikacji | `toTsQuery.ts` + `orderByForSearch.ts` | Samotny `-` (np. z `<->`) przechodzi jako słowo `-:*`. Dla filtra FTS (`plainto_tsquery`) nieszkodliwe; przy `order=rank` ten sam ciąg trafia do `to_tsquery` w `_relevance` — trzeba potwierdzić na realnym Postgresie, że nie daje błędu składni (500). | integracja DB |

**Uwaga o hermetyczności (naprawione w ramach audytu):** testy modułów czytających env przy imporcie (konfiguracja JWT) przechodziły tylko wtedy, gdy wcześniej w tym samym procesie zaimportowano `@prisma/client`, który jako efekt uboczny ładuje lokalny `.env`. Dodano `test/unit-env.setup.ts` (jest `setupFiles`) z deterministycznymi sekretami testowymi — testy nie zależą już od `.env` developera.

## 5. Jakość istniejących testów (kryteria W6)

- Testy AI i notatek są dobrej jakości: nazwy opisują zachowanie, asercje sprawdzają wynik i efekty uboczne, raw SQL sprawdzany pod kątem parametrów (`notesPgRepository.spec.ts`) — ten wzorzec przyjęto dla nowych testów.
- Słabe asercje: 2 miejsca (`toBeDefined` w `claude-agent-sdk.provider.spec.ts:133`, `not.toThrow` w `aiRunLimiter.service.spec.ts:21`) — w kontekście poprawne (drugie poprzedzone asercją statusu 429), nie wymagają zmian.
- Brak `skip`/`todo`/`xit`.
- Jedyny realnie bezwartościowy test: `app.controller.spec.ts` (B01).

## 6. Koncepcja uzupełnienia

**Zasady**
1. Testy obok pliku (`*.spec.ts`), styl zgodny z istniejącymi: ręczne składanie klasy z mockami zależności, bez `TestingModule`, gdy nie jest potrzebny DI; `Logger` wyciszany `jest.spyOn(...).mockImplementation()`.
2. Asercje na **zachowanie i kontrakt** (status, kształt odpowiedzi, argumenty do zależności, w tym `userId`), nie na implementację.
3. Mockowana jest tylko granica I/O (Prisma, JWT, providerzy AI). Czyste funkcje i krypto (`bcryptjs`, `SecretBox`, `@nestjs/jwt` w `AccessTokenService`/`RefreshTokenService`) — **realne**.
4. Czas: `jest.useFakeTimers` / `setSystemTime` zamiast sleepów.
5. Defekty: `it.failing` z identyfikatorem `D#` w nazwie (sekcja 4).
6. Bez zmian w kodzie produkcyjnym. Jedyna zmiana poza testami: `setupFiles` w konfiguracji Jest (hermetyczne env, sekcja 4).
7. Wspólne helpery testowe obok kodu, którego dotyczą: `src/common/testing/http-test.utils.ts` (ExecutionContext/ArgumentsHost/Response dla guardów, filtrów i dekoratorów).

**Kolejność**: P0 → P1 → P2 → P3 (jak w sekcji 3).

**Definition of Done**
- `npx jest` — zielony, 0 czerwonych.
- `npm run test:ai` — zielony (100%).
- Każda pozycja B01–B45 ma test lub jest na liście „poza zakresem”.
- Każdy defekt opisany; potwierdzalne testem jednostkowym (D1, D2, D11, D12) mają `it.failing`.
- Każda metoda czytająca/zmieniająca dane użytkownika ma asercję scopingu po `userId`.

## 7. Wynik

| Metryka | Przed | Po |
|---|---|---|
| Suity / testy | 43 / 416 (1 czerwony) | **73 / 804 (0 czerwonych)** |
| `npm run test:ai` (próg 100%) | czerwony (93.4% linii) | **zielony (100% / 100% / 100% / 100%)** |
| Coverage globalnie — statements | 71.2% | **96.2%** |
| Coverage globalnie — branches | 64.9% | **94.6%** |
| Coverage globalnie — functions | 64.6% | **96.0%** |
| Coverage globalnie — lines | 70.7% | **96.2%** |

Pokrycie per obszar (lines, po): `modules/ai` 100% · `modules/users` 100% · `modules/notes/controller` 100% · `modules/notes/utils` 100% · `infrastructure/security` 98.6% · `modules/notes/service` 97.7% · `core` 95.0% · `modules/auth` 92.8% · `common` 83.1% · `infrastructure/database` 77.8%.

Pozostałe niepokryte linie to wyłącznie pozycje z listy „poza zakresem” (sekcja 3): `*.module.ts`, `main.ts`, `prisma.service.ts`, barrele `index.ts`, DTO bez dekoratorów, `env.enum.ts`, oraz nieużywane gałęzie helpera testowego. Pozostałe gałęzie, których nie da się osiągnąć zachowaniem publicznym (np. `notesTree.service.ts:98–99` — dziecko bez `parentId` odrzuca wcześniej limiter), pozostawiono bez sztucznych testów.

**Pliki testowe** — przepisany: `app.controller.spec`. Nowe (30): `aiSettings.controller`, `aiModule.config`, `ai.consts`, `embedding-provider.factory`, `bruteForceService`, `bruteForce.guard`, `brute-force-exception.filter`, `throttler-exception.filter`, `jwt.config`, `cookie.utils`, `accessToken.service`, `refreshToken.service`, `auth.service`, `jwtAuthGuard.guard`, `auth.controller` (+ `CsrfController`), `auth.dto`, `users.service`, `prisma-errror.util`, `decorators`, `markdownExtensions`, `notes.service`, `userNotes.service`, `notes.controller`, `noteQuery.utils`, `noteQuery.dto`, `tree.service`, `env`, `core.utils`, `common.utils`, `toTsQuery`. Rozszerzone (12): `rag.repository`, `ragIndexer.service`, `ragSearch.service`, `chunkMarkdown`, `claude-agent-sdk.provider`, `ollama-embedding.provider`, `aiRunLimiter.service`, `aiCredentials.service`, `ai.service`, `assistPrompt`, `notesTree.service`, `notesSearch.service`.

**Weryfikacja**: `npx jest` zielony · `npm run test:ai` zielony · `tsc --noEmit` bez nowych błędów (jedyny błąd to istniejący `test/app.e2e-spec.ts`, faza 0 KONCEPCJI) · ESLint `--max-warnings 0` czysty na wszystkich nowych/edytowanych plikach testowych.

## 8. Rekomendowane następne kroki

1. **Naprawa defektów D1, D2, D11, D12** (ścieżki wysokiego ryzyka — diff do przeczytania przez człowieka). Po każdej naprawie odpowiedni `it.failing` zaczerwieni się → zamienić na `it`.
2. **E2E / integracja DB** (poza zakresem tego audytu): AC-AUTHZ B→A dla `/notes/:id` (GET/PATCH, w tym D5), D3 (throttling `/auth/refresh`), D13 (`order=rank` z `-`), nagłówki helmet/CSRF, `omit` w `PrismaService`.
3. **Ratchet coverage** (gdy CI będzie stabilne, §4): rozważyć `coverageThreshold` per ścieżka wysokiego ryzyka (`security/**`, `auth/**`, `ai/credentials/**`) zamiast progu globalnego.

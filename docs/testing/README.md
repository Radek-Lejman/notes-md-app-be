# Testy BE — co nie jest pokryte i dlaczego

Stan: 2026-10-12 · 73 pliki, 804 testy · pokrycie: **96,2% instrukcji · 94,6% gałęzi · 96,0% funkcji** · `test:ai` 100%

Pełny audyt (wymagania, koncepcja, znalezione defekty): [AUDYT-TESTOW-JEDNOSTKOWYCH.md](./AUDYT-TESTOW-JEDNOSTKOWYCH.md).
Odpowiednik na FE: `notes-app-fe/docs/testing/README.md` (ta sama struktura kategorii A–E).

## Uruchamianie

```bash
npm test                # jest, testy jednostkowe (~10 s)
npm run test:cov        # + coverage (konsola + raport HTML w coverage/)
npm run test:ai         # moduł AI z progiem 100% — musi być zielony
npm run test:e2e        # e2e — dziś niedziałające, patrz sekcja A.3
```

Infrastruktura testowa:

| Plik | Rola |
|---|---|
| `test/unit-env.setup.ts` | jest `setupFiles`: stałe sekrety JWT, żeby testy nie zależały od lokalnego `.env` |
| `src/common/testing/http-test.utils.ts` | `makeHttpContext`, `makeResponse`: ExecutionContext / ArgumentsHost / Response dla guardów, filtrów i dekoratorów |
| `src/infrastructure/ai/testing/ai-test.utils.ts` | `makeAiConfig`, `streamOf`, `collect`: providerzy AI bez sieci |
| `src/__mocks__/@anthropic-ai/claude-agent-sdk.ts` | mock SDK Claude |

## Zasada

Celem nie jest 100%. Coverage pokazuje, które linie się wykonały, a nie czy zachowanie zostało sprawdzone. Ostatnie procenty zwykle dobija się testami bez wartości (`KONCEPCJA.md` §4). Wyjątkiem jest `test:ai`, gdzie 100% to świadomie przyjęta bramka. Każde niepokryte miejsce należy do jednej z kategorii poniżej i każda kategoria ma swoją decyzję.

| Kategoria | Decyzja |
|---|---|
| A. Wymaga prawdziwej bazy lub całego pipeline'u HTTP | **testy e2e / integracyjne** (`test/`), nie unit |
| B. Konfiguracja aplikacji (composition root) | bez testów jednostkowych; start aplikacji sprawdza smoke e2e |
| C. Martwy lub niedokończony kod | usunąć albo dokończyć, nie testować |
| D. Gałęzie obronne | świadomie bez testów |
| E. Realna logika bez testu | **kandydaci do uzupełnienia** |

## A. Wymaga prawdziwej bazy / pipeline'u HTTP → e2e

To odpowiednik FE-owej kategorii „wymaga prawdziwej przeglądarki → Playwright”. Na BE rolę jsdom pełni mock Prismy: test jednostkowy sprawdza, że do bazy trafia właściwe zapytanie (`where: { userId }`, parametry zamiast inline SQL). Nie sprawdzi natomiast, co Postgres z tym zapytaniem zrobi. Tak samo kontroler wywołany wprost w teście pomija middleware, guardy globalne, `ValidationPipe` i filtry wyjątków, czyli wszystko, co ustawia `main.ts` i `app.module.ts`. Podmienianie tych rzeczy w unicie sprawdzałoby podmiany, a nie aplikację.

### A.1 Czego unit nie sprawdzi i gdzie to będzie

| Obszar | Czego nie da się sprawdzić unitem | Co jest już pokryte unitem | Plik e2e (plan) |
|---|---|---|---|
| **Autoryzacja B→A** (`KONCEPCJA` §2, obowiązkowa) | że użytkownik B naprawdę dostaje 404 na notatce A: wymaga dwóch kont, prawdziwego JWT w cookie i bazy | każde zapytanie w `NotesService` ma `userId` w `where`, a `RagRepository` filtruje `userId` w SQL (`notes.service.spec`, `rag.repository.spec`) | `notes.authz.e2e-spec.ts` |
| **PATCH cudzej notatki** (D5, naprawione) i **`parentId` cudzej notatki** (D14, naprawione) | Prisma `P2025` → **404**; `parent.connect` zawęża do `{ id, userId }` | serwis mapuje `P2025` na `NotFoundException` (`notes.service.spec` › *D5*, *D14*) | `notes.authz.e2e-spec.ts` |
| **Full-text search** | że `plainto_tsquery` + indeksy GIN zwracają właściwe notatki, w tym prefiksy, polskie znaki i paginację kursorem | sanityzacja zapytania (`toTsQuery.spec`), wyrażenie SQL identyczne z indeksem z migracji (`notesPgRepository.spec`) | `notes.search.e2e-spec.ts` |
| **`order=rank` z samotnym `-`** (D13) | czy `to_tsquery('… & -:*')` w `_relevance` nie zwraca błędu składni → 500 | `toTsQuery` przepuszcza `-:*` (`toTsQuery.spec`) | `notes.search.e2e-spec.ts` |
| **pgvector / RAG** | cosine search, `vector_dims`, transakcja DELETE→INSERT→UPDATE, warunek `ragIndexedAt = updatedAt` przy strefie czasowej ≠ UTC | kształt i parametry każdego zapytania (`rag.repository.spec`), logika indeksera (`ragIndexer.service.spec`) | `rag.integration-spec.ts` |
| **`PrismaService.omit`** | że `contentLegacy` i `ragIndexedAt` nigdy nie wracają w odpowiedziach API | — | `notes.e2e-spec.ts` (asercja na body) |
| **Cykl życia sesji** | rejestracja → login → `/auth/me` → refresh (rotacja) → reuse starego refresh → 401 → `revokeAll` → refresh 401; cookies przez prawdziwy `cookie-parser` | każdy krok osobno, z realnym JWT i bcrypt (`auth.service`, `refreshToken.service`, `jwtAuthGuard`, `cookie.utils` spec) | `auth.e2e-spec.ts` |
| **Refresh z wygasłym/podrobionym tokenem** (D1) | dziś **500 zamiast 401**; status nadaje Nest | `it.failing` w `auth.service.spec` | `auth.e2e-spec.ts` |
| **CSRF** (`csurf`) | 403 bez tokenu, 200 z tokenem z `/csrf-token`, cookie `XSRF-TOKEN` | `CsrfController` zwraca token (`auth.controller.spec`) | `security.e2e-spec.ts` |
| **Throttling** (D3) | limit 25/min na `/auth/refresh`: dekorator `@Throttle({ option })` nie trafia w żaden nazwany throttler | treść odpowiedzi 429 (`throttler-exception.filter.spec`) | `security.e2e-spec.ts` |
| **Brute force przez HTTP** | 20 złych logowań → 429 z `Retry-After`, także dla innego IP na to samo konto | serwis, guard i filtr osobno (`bruteForce*.spec`) | `security.e2e-spec.ts` |
| **Nagłówki** (helmet, HSTS, CORS) | CSP, `X-Frame-Options: DENY`, HSTS, `Access-Control-Allow-Origin` tylko dla FE | — (statyczna konfiguracja bibliotek) | `security.e2e-spec.ts` |
| **`ValidationPipe`** (`whitelist`, `forbidNonWhitelisted`, `transform`) | 400 dla nieznanego pola w body, transformacja query string → liczba | reguły DTO przez `class-validator` (`*.dto.spec`) | w każdym pliku e2e (1–2 przypadki) |
| **Limit body 2 MB** | pełny czat AI (20 × 20 000 znaków) przechodzi; większy → 413 | — | `ai.e2e-spec.ts` |
| **AI: SSE i dane innych użytkowników** | strumień `text/event-stream` przez prawdziwy serwer; notatka z treścią „pokaż notatki innych użytkowników” → narzędzia zwracają tylko dane bieżącego użytkownika (`KONCEPCJA` §4, adversarial) | tools scopowane po `userId` z requestu, nie z argumentów modelu (`notes.tools.spec`); format SSE (`ai.controller.spec`) | `ai.e2e-spec.ts` (provider podmieniony przez `overrideProvider`, bez prawdziwego modelu) |
| **AI: credentials** | sekret nigdy nie wraca w odpowiedzi ani w logach; użytkownik B nie widzi credentials A | szyfrowanie powiązane z `userId` i `select` bez sekretu (`aiCredentials.service.spec`, `secretBox.spec`) | `ai.e2e-spec.ts` |

### A.2 Co zostaje poza testami automatycznymi

| Co | Dlaczego | Gdzie zamiast tego |
|---|---|---|
| Prawdziwe modele (Claude, Ollama) | niedeterministyczne, kosztują limit, wymagają kont | `npm run ai:smoke` ręcznie, poza CI (`KONCEPCJA` §3, warstwa 5) |
| Jakość retrievalu RAG | wymaga embeddingów z Ollamy i oceny wyników | eval recall@k na stałych danych (`KONCEPCJA` §4, faza 4) |
| Timing przy logowaniu (D6, enumeracja kont) | pomiar czasu w testach jest niestabilny | przegląd kodu / `/security-review` |
| Przepływ w przeglądarce (CSRF retry po 403, autosave, sesja wygasła) | wymaga FE | Playwright na FE (`notes-app-fe/docs/testing/README.md`, kategoria A) |

**Podział BE ↔ FE**: e2e BE testuje **kontrakt HTTP** (status, body, cookies, nagłówki) bez przeglądarki, a Playwright na FE testuje **ścieżki użytkownika** w przeglądarce. Scenariusze, które dotykają obu stron, jak ponawianie po 403 CSRF (defekt D1 na FE) czy wylogowanie po nieudanym refreshu, sprawdzamy na FE. BE dostarcza tylko pewność, że po swojej stronie zwraca właściwe kody (`security.e2e-spec.ts`, `auth.e2e-spec.ts`).

### A.3 Infrastruktura e2e — stan i co trzeba zrobić

Dziś `npm run test:e2e` nie działa: `test/app.e2e-spec.ts` ma błąd TS, oczekuje `"Hello World!"` i nie ma bazy. To jest faza 0/1 w `KONCEPCJA` §8.

| Krok | Szczegóły |
|---|---|
| 1. `test/jest-e2e.json` | dodać `moduleNameMapper` (aliasy `@ai`, `@core`, `@security`, `@common`, `@database`, `src/`, tak jak w `package.json`) i `setupFiles: ["<rootDir>/unit-env.setup.ts"]` |
| 2. Wspólny bootstrap | wydzielić z `main.ts` funkcję `configureApp(app)` (prefix `/api`, `cookieParser`, `csrf`, CORS, helmet, `ValidationPipe`, limit body). Bez tego e2e testowałoby **inną** aplikację niż produkcyjna. To zmiana w kodzie produkcyjnym i wymaga zgody. |
| 3. Baza | `pgvector/pgvector:pg15` (jak w `docker-compose.yaml`), osobna baza `notes_e2e`, `prisma migrate deploy` przed suitem, `TRUNCATE` tabel między testami (`globalSetup` / `beforeEach`) |
| 4. Helpery `test/support/` | `createTestApp()`, `registerUser(app)` → agent supertest z cookies, `csrf(agent)` → nagłówek `X-CSRF-Token` |
| 5. AI bez sieci | `overrideProvider(AGENT_PROVIDER / LLM_PROVIDER / EMBEDDING_PROVIDER)` z deterministycznymi fake'ami; `RAG_INDEX_INTERVAL_MS` duże, indeksowanie wywoływane ręcznie |
| 6. CI | job `e2e` z serwisem Postgres (`KONCEPCJA` §3.3) |

Docelowy układ, analogiczny do FE (`src/shared/lib/test/`), tylko w `test/`:

```
test/
├── jest-e2e.json
├── unit-env.setup.ts          # już jest (unit); wspólny z e2e
├── support/                   # createTestApp, registerUser, csrf, db reset
├── app.e2e-spec.ts            # smoke: aplikacja startuje, /api odpowiada
├── auth.e2e-spec.ts
├── notes.e2e-spec.ts
├── notes.authz.e2e-spec.ts    # B→A dla każdego endpointu z :id
├── notes.search.e2e-spec.ts
├── security.e2e-spec.ts
├── ai.e2e-spec.ts
└── rag.integration-spec.ts
```

## B. Konfiguracja aplikacji (composition root)

| Plik | Pokrycie | Dlaczego bez testów jednostkowych |
|---|---|---|
| `main.ts` | 0% | punkt wejścia (middleware, prefix, pipe). Właściwe miejsce to smoke e2e po kroku A.3/2 |
| `app.module.ts`, `auth.module.ts`, `prisma.module.ts` | 0% | tylko wiring DI. Test jednostkowy powtórzyłby listę providerów, a błąd wiringu i tak wywraca start aplikacji (smoke e2e). Wyjątki z wartością już istnieją: `ai.module.spec`, `ai-infrastructure.module.spec` (wybór providera z env) |
| `prisma.service.ts` | 50% | `$connect` / `$disconnect` i `omit` działają tylko z prawdziwą bazą → A.1 (*PrismaService.omit*) |
| `security/config/helmet.config.ts` (6, 24), `csrf.config.ts` (8) | gałęzie prod | `isProd` jest liczone przy imporcie. Sama wartość opcji nic nie mówi, liczą się nagłówki i cookies → `security.e2e-spec.ts` |
| `index.ts` (barrele), `*.types.ts`, `*.interface.ts`, `express.d.ts` | 0% | brak logiki |

## C. Martwy lub niedokończony kod

Testowanie tych miejsc utrwaliłoby kod, który powinien zniknąć albo zostać dokończony.

| Plik / linie | Stan | Decyzja |
|---|---|---|
| `app.service.ts` (`'XXdddXX!'`), `app.controller.ts` `POST /dashboard` | placeholdery ze scaffoldu (mockowane statystyki), FE ich nie używa | usunąć `/dashboard`; `GET /api` zostawić jako health check z sensowną odpowiedzią |
| `auth/dto/me.dto.ts`, `auth/dto/refresh.dto.ts` | nigdzie nieimportowane | usunąć |
| `core/types/env.enum.ts` (`Environment`) | nigdzie nieużywany | usunąć |
| `refreshToken.serivce.ts` `revokeAll` (D10) | nieużywany: `AuthService.revokeAll` tylko podbija `tokenVersion` | użyć w `AuthService.revokeAll` (porządek w DB) albo usunąć |
| `throttler-exception.filter.ts` 15 (gałąź `/auth`) | martwa przez prefix `/api` (D4) | poprawić na `/api/auth` przy naprawie D3 |
| `core/tree/tree.service.ts` 67 (`forEach` bez `startId`) | prywatna gałąź, nikt jej nie wywołuje | zostawić (API drzewa) albo uprościć |

## D. Gałęzie obronne — świadomie bez testów

Zabezpieczenia na sytuacje, które przy obecnym kodzie nie występują. Żeby je przetestować, trzeba by sztucznie zepsuć dane wejściowe, a taki test nie sprawdza zachowania widocznego dla klienta API.

| Plik / linie | Gałąź | Dlaczego nie występuje |
|---|---|---|
| `notesTree.service.ts` 98–99 | dziecko bez `parentId` | zapytanie `parentId IN (...)` nie zwróci `null`, a limiter i tak odrzuca pusty klucz wcześniej (zachowanie sprawdza *skips a child without a parent reference*) |
| `notesTree.service.ts` 71, `notesSerach.service.ts` 43 | `?? []` po wyniku `NotesService` | `NotesService` zawsze zwraca tablicę |
| `note.mapper.ts` 17, `notesToTree.ts` 20 | `!prismaNotes`, `children?.` | Prisma `findMany` zawsze zwraca tablicę; węzły drzewa zawsze mają `children` |
| `core/tree/tree.service.ts` 52 | węzeł (nie root) bez `parentId` | `addChild` zawsze ustawia rodzica |
| `cookie.utils.ts` 10, 20 | `setAuthCookies` bez access tokenu | każde wywołanie (register, login, refresh) przekazuje oba tokeny; brak refresh tokenu jest testowany |
| `markdownEscape.ts` 48, 59, `markdownExtensions.ts` 33, 76 | `text ?? ''`, `type ?? ''`, `title` nie-string | parser Tiptapa zawsze ustawia te pola |
| `tiptapToMarkdown.ts` 51, 78 | dokument legacy bez `content` / z nieznanym rootem | migracja do markdown zakończona; konwerter zostaje tylko na potrzeby backfillu (kandydat do usunięcia razem z `content_legacy`) |
| `http-test.utils.ts` (`switchToRpc`, `switchToWs`, `getArgs`) | helper testowy | kompletny interfejs `ExecutionContext`; nie jest kodem produkcyjnym |

## E. Realna logika bez testu — kandydaci do uzupełnienia

Te testy są tanie i sprawdzają zachowanie, które zauważy użytkownik. Rekomendacja: dopisać przy najbliższej zmianie w danym pliku.

| Plik / linie | Czego nie sprawdzono | Jak przetestować |
|---|---|---|
| `markdownExtensions.ts` 41–47 | pusty blok kodu i blok bez języka po zapisie | `markdownExtensions.spec`: round-trip `` ```\n``` `` i `` ```ts\n``` `` |
| `markdownText.ts` 52–55 | snippet, gdy trafienie jest w długim słowie bez spacji (brak spacji po `start`) | `markdownText.spec`: tekst > 160 znaków bez spacji, trafienie w środku |

## Testy znanych defektów (`it.failing`)

Te testy opisują **poprawne** zachowanie i dziś padają, bo w kodzie jest błąd. Są oznaczone `it.failing`, więc zestaw jest zielony, a błąd widoczny. Po naprawie test zacznie failować; wtedy zmień `it.failing` na `it`.

| Defekt | Test |
|---|---|
| D1: refresh z wygasłym/podrobionym tokenem → 500 zamiast 401 | `modules/auth/services/auth.service.spec.ts` |
| D2: `revokeAll` bez `await` (fałszywe „revoked”, nieobsłużona obietnica) | `modules/auth/controllers/auth.controller.spec.ts` |
| D11: błędne logowanie w trakcie blokady brute force zdejmuje blokadę | `infrastructure/security/services/bruteForceService.spec.ts` |
| D12: domyślne sekrety JWT na dev krótsze niż 32 B, więc aplikacja nie startuje | `modules/auth/config/jwt.config.spec.ts` |

Defekty, których nie da się sprawdzić unitem (D3, D5, D13), są w tabeli A.1 z docelowym plikiem e2e.

## Znane zachowanie zestawu

- **Moduły czytające env przy imporcie** (`jwt.config`, `cookie.utils`, `env.ts`, `aiModule.config`) są w testach ładowane przez `jest.isolateModules`, z ustawionym `process.env` dla każdego przypadku. Zwykły `import` na górze pliku odczytałby env tylko raz.
- **`@prisma/client` ładuje `.env` przy imporcie.** Dlatego istnieje `test/unit-env.setup.ts`: bez niego wynik testów zależałby od tego, czy deweloper ma lokalny `.env`.
- **Fake timers a `jsonwebtoken`**: w testach z `signAsync` używaj `jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })`, inaczej podpis nigdy się nie kończy (timeout).

## Aktualizacja tego pliku

Po większej zmianie uruchom `npm run test:cov` i porównaj z tabelami powyżej. Każde nowe miejsce poniżej ~90% przypisz do kategorii A–E. Jeśli nie pasuje do żadnej, to po prostu brakuje testu. Gdy powstanie infrastruktura e2e (A.3), przenieś zrealizowane wiersze z A.1 do tabeli „pokryte e2e” z nazwą testu.

# Git hooks (husky) — zasady dla BE i FE

> Status: **wdrożone** 2026-10-12 po recenzji (6,5/10) — rzeczywista konfiguracja i odstępstwa od propozycji w §8 · realizuje fazę 1 z [KONCEPCJA.md](./KONCEPCJA.md) §3.2

## 1. Po co i czego hooki NIE robią

Hooki to **pierwsza, lokalna i szybka** bramka. Działają tak samo dla commitów człowieka i agenta AI (Claude Code wywołuje zwykłe `git commit`, więc hooki się uruchamiają).

- Hook **można obejść** (`--no-verify`, `HUSKY=0`). Dlatego nie jest zabezpieczeniem — ostateczną bramką będzie CI + ochrona `main` (faza 1, osobny krok). Agentowi `--no-verify` zablokujemy hookiem Claude Code (faza 2).
- Hook ma być **szybki**, inaczej ludzie (i agenci) zaczną go obchodzić. Budżet: `pre-commit` ≤ ~10 s, `pre-push` ≤ ~30 s.
- Hook sprawdza **tylko to, co się zmienia** (staged / related). Pełne sprawdzenie robi `pre-push` i CI.

## 2. Stan wyjściowy (zmierzony 2026-10-12)

| | BE (`notes-app-be`) | FE (`notes-app-fe`) |
|---|---|---|
| husky / lint-staged | brak | husky 9 + lint-staged 16: `prettier --write` + `eslint --max-warnings=0` na `src/**/*.{ts,tsx}` |
| `tsc` | 1 błąd (`test/app.e2e-spec.ts:3` — `import * as request`), 1,3 s | 0 błędów, `tsc -b` 4,7 s |
| ESLint | 84 błędy + 8 ostrzeżeń (ostrzeżenia: `no-floating-promises` 2, `no-unsafe-argument` 6 — reguły ustawione na `warn`) | 0 problemów, 6,1 s |
| Testy | jest: 804 ✓, 11,5 s | vitest: 418 ✓, 12,8 s |
| Gałąź | `feature/ai-assist` (flow: feature → `develop` → `main`) | **praca bezpośrednio na `main`**, brak `develop` |
| Skaner sekretów | brak (`gitleaks` niezainstalowany) | brak |

## 3. Zasady

### 3.1 `pre-commit` — szybko, tylko staged

| # | Zasada | BE | FE | Narzędzie | Dlaczego |
|---|---|---|---|---|---|
| C1 | Formatowanie staged plików | `*.ts` w `src/`, `test/`, `scripts/` | `src/**/*.{ts,tsx}` (jest) | `prettier --write` | spójny styl bez dyskusji; AI często psuje formatowanie |
| C2 | Lint staged plików bez nowych błędów i ostrzeżeń | `eslint --max-warnings=0` | jest | ESLint + **bulk suppressions** (BE) | nowy dług nie wchodzi; stary dług nie blokuje (patrz §4) |
| C3 | Testy powiązane ze zmianą | `jest --findRelatedTests --passWithNoTests` | `vitest related --run --passWithNoTests` | runner testów | regresja wykryta przy commicie, nie po godzinie; tylko testy zależne od staged plików |
| C4 | Skan sekretów w staged zmianach | ✓ | ✓ | `secretlint` (npm, preset recommend) | token/klucz nie trafia do historii — usunięcie z historii jest kosztowne, a z remote praktycznie niemożliwe |
| C5 | Zakaz commitowania plików wrażliwych po nazwie | `.env*` (poza `.env.example`), `cookies.txt`, `*.pem`, `*.key` | to samo | skrypt `scripts/hooks/check-forbidden-files.sh` | tania druga warstwa na wypadek, gdy skaner nie rozpozna formatu |
| C6 | Migracje są append-only | staged zmiana w `prisma/migrations/**` może być tylko **dodaniem** nowego katalogu (`git diff --cached --name-status` ≠ `M`/`D`/`R`) | — | skrypt `scripts/hooks/check-migrations.sh` | edycja zastosowanej migracji rozjeżdża bazę z historią; AI chętnie „poprawia” stare migracje |
| C7 | Schemat Prisma poprawny | `prisma format` + `prisma validate` gdy staged `prisma/schema.prisma` | — | Prisma CLI | literówka w schemacie wychodzi przy commicie, nie przy migracji |
| C8 | Zakaz commitów bezpośrednio na `main` | ✓ | ✓ (**wymaga zmiany nawyku** — dziś praca na `main`) | skrypt `scripts/hooks/check-branch.sh` | zmiany idą przez PR → CI → merge; chroni przed przypadkowym commitem agenta na `main` |

### 3.2 `pre-push` — pełne, ale lokalne

| # | Zasada | BE | FE | Dlaczego |
|---|---|---|---|---|
| P1 | Typecheck całego projektu | `tsc --noEmit -p tsconfig.json` (obejmuje `test/`) | `tsc -b` | błędy typów często są w plikach, których commit nie dotknął |
| P2 | Pełne testy jednostkowe | `jest` | `vitest run` | related-tests w pre-commit nie łapią wszystkiego (np. zmiana kontraktu, mocków globalnych) |

Lint całego projektu **nie** jest w pre-push — staged-lint (C2) + CI wystarczą, a pełny lint BE z suppressions to i tak powtórzenie.

### 3.3 `commit-msg` — świadomie pominięte

Konwencjonalne commity są stosowane konsekwentnie bez narzędzia, a CHANGELOG nie jest generowany. commitlint wróci, jeśli pojawią się odstępstwa (decyzja z recenzji KONCEPCJI).

### 3.4 Skrypty wspólne

Każde repo dostaje skrypty npm, które wywołują hooki, CI i agent AI — jedna definicja:

```jsonc
// BE
"typecheck": "tsc --noEmit -p tsconfig.json",
"lint:check": "eslint \"{src,test,scripts}/**/*.ts\" --max-warnings 0",
"verify": "npm run typecheck && npm run lint:check && jest",
"prepare": "husky"

// FE (już ma lint/test/format:check)
"typecheck": "tsc -b",
"verify": "npm run typecheck && npm run lint && npm run test"
```

## 4. Warunki wstępne (bez nich hooki od razu zablokują pracę)

**BE**
1. Naprawić `test/app.e2e-spec.ts` (`import request from 'supertest'` + oczekiwana odpowiedź) — inaczej P1 nie przejdzie. Sam e2e nadal nie działa (brak DB, aliasy) — to osobne zadanie; tu tylko kompilacja.
2. Przestawić `no-floating-promises` i `no-unsafe-argument` z `warn` na `error` — bulk suppressions tłumią tylko błędy, więc 8 istniejących ostrzeżeń blokowałoby `--max-warnings=0` przy każdym dotknięciu tych plików. Po przestawieniu wpadają do suppressions jak reszta. (I tak docelowo `error` — KONCEPCJA §3.)
3. `npx eslint "{src,test,scripts}/**/*.ts" --suppress-all` → commitowany `eslint-suppressions.json`. Nowe naruszenia failują; naprawione → `--prune-suppressions`.
4. `cookies.txt` do `.gitignore` (i usunąć plik).

**FE**
1. Utworzyć gałąź robocząą dla obecnych niezacommitowanych zmian (dziś wszystko jest na `main`) — inaczej C8 zablokuje pierwszy commit.

## 5. Zasady obchodzenia hooków

- `--no-verify` / `HUSKY=0` tylko świadomie przez człowieka, z powodem w opisie PR („hook X: powód”). Nigdy przez agenta AI (blokada w fazie 2).
- Hook failuje z niejasnego powodu → naprawić hook, nie obchodzić go.
- Hook zbyt wolny (> budżet z §1) → przenieść regułę do pre-push lub CI, nie usuwać bez zastępstwa.

## 6. Plan wdrożenia

1. **BE**: `npm i -D husky lint-staged secretlint @secretlint/secretlint-rule-preset-recommend` → `npx husky init` → warunki z §4 → `.husky/pre-commit`, `.husky/pre-push`, `.secretlintrc.json`, `scripts/hooks/*.sh`, konfiguracja `lint-staged` w `package.json`.
2. **FE**: `npm i -D secretlint @secretlint/secretlint-rule-preset-recommend` → rozszerzyć `lint-staged` (C3–C5) → `.husky/pre-commit` (C8) + `.husky/pre-push`.
3. **Test hooków** (w obu repo): commit pliku z fałszywym tokenem → odrzucony; commit `.env` → odrzucony; commit z błędem lint → odrzucony; commit zmieniający starą migrację → odrzucony; commit na `main` → odrzucony; poprawny commit na gałęzi → przechodzi w ≤ 10 s.
4. Opis zasad w `README` (sekcja „Hooki”) i później w `CLAUDE.md`.

## 7. Szkic konfiguracji

```jsonc
// BE package.json
"lint-staged": {
  "*": ["secretlint --maskSecrets", "scripts/hooks/check-forbidden-files.sh"],
  "{src,test,scripts}/**/*.ts": ["prettier --write", "eslint --max-warnings=0", "jest --findRelatedTests --passWithNoTests"],
  "prisma/schema.prisma": ["prisma format", "prisma validate"]
}
```

```sh
# BE .husky/pre-commit
scripts/hooks/check-branch.sh
scripts/hooks/check-migrations.sh
npx lint-staged

# BE .husky/pre-push
npm run typecheck && npx jest --silent
```

```jsonc
// FE package.json
"lint-staged": {
  "*": ["secretlint --maskSecrets", "scripts/hooks/check-forbidden-files.sh"],
  "src/**/*.{ts,tsx}": ["prettier --write", "eslint --max-warnings=0", "vitest related --run --passWithNoTests"]
}
```

```sh
# FE .husky/pre-commit
scripts/hooks/check-branch.sh
npx lint-staged

# FE .husky/pre-push
npm run typecheck && npm run test
```

## 8. Wdrożenie — zmiany po recenzji

Recenzja (niezależny agent, eksperymenty na narzędziach) wykazała błędy, które zablokowałyby pracę od pierwszego dnia. Wdrożona konfiguracja różni się od §3–§7:

| Propozycja | Problem | Wdrożone |
|---|---|---|
| C2 `eslint --max-warnings=0` z suppressions | gdy plik ma **mniej** naruszeń niż w `eslint-suppressions.json` (np. po `prettier --write`), ESLint kończy się kodem 2 — czysty plik blokuje commit | `--pass-on-unpruned-suppressions`; legacy pliki sformatowane prettierem przed `--suppress-all` (63 naruszenia w 20 plikach); `eslint` podniesiony do ^9.39 |
| C3 FE `vitest related` w pre-commit | dla centralnych plików ≈ czas pełnego suite'u (11 s) | FE: testy tylko w pre-push; BE `jest --findRelatedTests` zostaje (4–7 s) |
| C4 `--maskSecrets` | domyślne w secretlint 13; ścieżki traktowane jak glob | `secretlint --no-glob` |
| C5 skrypt przez lint-staged | brak `+x` → EACCES | `sh scripts/hooks/...` |
| C6 tylko status `A` | przepuszcza dodanie pliku do istniejącej migracji; blokuje poprawki migracji jeszcze niezmergowanej; rename = `R` | blokuje M/D i A-do-istniejącego-katalogu **tylko dla migracji obecnych na `origin/develop`/`origin/main`**; `--no-renames`; `migration_lock.toml` zwolniony |
| C7 `prisma validate` | wymaga `DATABASE_URL`; `prisma format` i tak waliduje | tylko `prisma format` |
| C8 | detached HEAD (rebase) zablokowany | `git symbolic-ref -q` — detached dozwolony; BE chroni `main` i `develop` |
| `npx lint-staged` | przy braku `node_modules` npx po cichu pobiera pakiet | `lint-staged` (husky dodaje `node_modules/.bin` do PATH); pre-push przez `npm run`/`npm test` |
| `"prepare": "husky"` | `npm ci --omit=dev` (Docker) → `husky: not found` | `"husky \|\| true"` |
| — (brak) | agenci wyciszają failujące testy | ESLint: `jest/no-focused-tests`, `jest/no-disabled-tests` (BE), `vitest/no-focused-tests`, `vitest/no-disabled-tests` (FE); `it.failing`/`it.fails` dozwolone |
| `.gitignore` | `.env.production` itp. nieignorowane | BE: `.env.*` + `!.env.example`, `cookies.txt`; FE: `cookies.txt` |

**Znane ograniczenia (świadomie)**
- **Worktree**: `core.hooksPath=.husky/_` jest względne, a `.husky/_` gitignorowane → w nowym `git worktree` hooki **nie działają**, dopóki nie uruchomisz w nim `npm ci` (lub `npx husky`). Automatyzacja: hook Claude Code przy tworzeniu worktree — faza 2.
- secretlint nie wykrywa generycznych sekretów (losowe JWT secret w `.env`) — stąd C5 i gitleaks w CI (faza 1, CI).
- pre-push sprawdza drzewo robocze, nie dokładnie wypychane commity — ostateczna bramka to CI.

**Zweryfikowane scenariusze** (klon repo w scratchpadzie, prawdziwe `git commit`/`git push`):

| Scenariusz | BE | FE |
|---|---|---|
| poprawny commit na gałęzi | ✓ przechodzi (4 s) | ✓ (3 s) |
| drobna zmiana w pliku z legacy błędami lint | ✓ przechodzi (7 s) | — |
| nowy błąd lint (`any`, floating promise) | ✖ zablokowany | ✖ |
| `it.only` / `it.skip` | ✖ | ✖ |
| token GitHub/Slack/Anthropic w kodzie | ✖ (secretlint) | ✖ |
| `.env.production` / `cookies.txt` (`git add -f`) | ✖ | ✖ |
| edycja zmergowanej migracji | ✖ | — |
| commit na `develop` / `main` | ✖ | ✖ |
| pre-push (typecheck + pełne testy) | ✓ 804 testy (6 s) | ✓ 419 testów (~15 s) — po naprawie D8 (error boundary w `NoteEditPage`) i wyścigu timera tiptap BubbleMenu po teardownie (`src/shared/lib/test/setup.ts`) |

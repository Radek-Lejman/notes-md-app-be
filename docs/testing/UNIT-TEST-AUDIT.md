# Unit test audit — notes-app-be

> Date: 2026-10-11 · branch `feature/LLM-module` · scope: unit tests (`jest`, `src/**/*.spec.ts`)
> Current state, categories of uncovered code and the e2e plan: [README.md](./README.md)
> Requirements: [CONCEPT.md](../ai-dev-system/CONCEPT.md) — §4 (test strategy), §5 (risk), layer 4 (`test-auditor` criteria)

## 1. Requirements audited against

| # | Requirement | Source |
|---|---|---|
| R1 | Unit tests cover `core/`, utils, mappers, services | §4 |
| R2 | `npm run test:ai` keeps **100%** (statements/branches/functions/lines) for `infrastructure/ai` and `modules/ai` | §4, `package.json` |
| R3 | `jest` green — red is not a "normal" state | §2, phase 0 |
| R4 | Test intensity by risk: **high** = `infrastructure/security/**`, `modules/auth/**`, `modules/ai/credentials/**` | §5 |
| R5 | Every query on user resources scoped by `userId` — at unit level: an assertion that `userId` reaches `where`/the SQL parameters | layer 1 (rules), §2 authz convention |
| R6 | Tests assert behaviour, not just "does not throw"; no excessive mocking | layer 4 (`test-auditor` b, c) |
| R7 | No hard global coverage threshold — quality over percentage | §4 |

## 2. Starting point (measured)

| Metric | Value |
|---|---|
| Suites / tests | 43 / 416 — **1 red** (`app.controller.spec.ts`) |
| Global coverage | statements 71.2% · branches 64.9% · functions 64.6% · lines 70.7% |
| `npm run test:ai` (100% threshold) | **red**: statements 93.3% · branches 89.4% · functions 84.1% · lines 93.4% |
| Source files with their own `*.spec.ts` | 40 of ~110 (without types/barrels: 40 of ~85) |

Coverage per area (lines):

| Area | Risk | Lines | State |
|---|---|---|---|
| `modules/auth/**` | high | **0%** | no tests at all |
| `infrastructure/security/services`, `guards`, `filters` | high | 9–33% | no tests (coverage only from imports) |
| `infrastructure/security/crypto` | high | 100% | OK |
| `modules/ai/credentials/**` | high | 98.6% | branch gaps (lines 36–37, 40) |
| `modules/users` | medium | 26.7% | no tests |
| `core/tree` | low | 20% | no tests, while `TreeService` is used in `GET /notes/:id` |
| `core/sort`, `core/config`, `core/utils` | low | 50–75% | no direct tests |
| `common/**` | low | 25–77% | no tests |
| `infrastructure/database/prisma` | medium | 42.9% | `isUniqueField` (P2002 → 409 mapping) untested |
| `modules/notes/service` | medium | 61.5% | `NotesService` 20%, `UserNotesService` 33% — **`userId` scoping unverified** |
| `modules/notes/controller` | medium | 43.3% | no tests |
| `modules/notes/utils` | medium | 87.6% | `searchCursorPayload` 33%, `validateNoteFields` 44%, `orderByForSearch` 64% |
| `modules/ai/controller/aiSettings` | medium | 44.1% | no tests — breaks R2 |
| `modules/ai/config` | medium | 50% | no tests — breaks R2 |
| `modules/ai/rag` | medium | 83% | `RagRepository` (raw SQL) 50%, `RagIndexer` lifecycle — breaks R2 |

## 3. List of gaps

Priority: **P0** = breaks a gate requirement (R2/R3) · **P1** = high risk (R4/R5) · **P2** = medium-risk domain logic · **P3** = low-risk pure functions.

### P0 — gates

| ID | File | Gap |
|---|---|---|
| B01 | `app.controller.spec.ts` | The scaffold test expects `"Hello World!"`, the service has returned `"XXdddXX!"` since the first commit. The test checks nothing meaningful. → rewrite to delegation to `AppService` + the shape of `/dashboard`. |
| B02 | `modules/ai/controller/aiSettings.controller.ts` | No spec. Unverified: `ready` (the `requiresAccount` × credential × serverLogin matrix), RAG off ⇒ no stats query, `testCredential` (done / error / no response / exception), execution in a limiter slot, `userId` from `CurrentUser`. |
| B03 | `modules/ai/config/aiModule.config.ts` | No spec: defaults, parsing `AI_SERVER_LOGIN_EMAILS` (trim, lower-case, empty), `RAG_CHUNK_OVERLAP ≤ chunkSize/2`, the `aiModuleConfig()` cache. |
| B04 | `modules/ai/rag/rag.repository.ts` | SQL methods without tests: **scoping by `userId`** in `search`/`stats` (R5), parameters instead of inline values, the `replaceChunks` transaction (DELETE → INSERT×n → UPDATE with an `updatedAt` condition), `bigint` → `number` conversion. |
| B05 | `modules/ai/rag/ragIndexer.service.ts` | `onModuleInit` (RAG off, invalidating another model, init error), `onModuleDestroy`, the schedule, protection against a parallel round (`running`). |
| B06 | `modules/ai/rag/ragSearch.service.ts` | the `model` getter, `stats`. |
| B07 | `modules/ai/consts/ai.consts.ts` | Throttling limits read lazily from config. |
| B08 | AI branches | `aiRunLimiter` (release with >1 user slot), `aiCredentials.agentNeedsAccount`, `ai.service` (assist without `text`), `assistPrompt:18`, `chunkMarkdown:89`, `embedding-provider.factory` (unsupported provider), `claude-agent-sdk:135`, `ollama-embedding:25`. |

### P1 — high risk (security, auth, users)

| ID | File | Gap |
|---|---|---|
| B10 | `security/services/bruteForceService.ts` | No spec. Lock threshold (20 attempts), lock duration (2 min), window reset after 30 s, `getRetryAfterSeconds` (rounding up, 0 after expiry), ignoring attempts during a lock, `reset/resetMany`, `firstLocked`. |
| B11 | `security/guards/bruteForce.guard.ts` | No spec. `ip:` + `acct:` keys (email normalization: trim + lower-case), no account key without an email, `req.__bfKeys`, the `Retry-After` header + 429 when locked. |
| B12 | `security/filters/*.ts`, `exceptions/*.ts` | No spec. The shape of the 429 response and `Retry-After` (brute force and throttler). |
| B13 | `auth/services/auth.service.ts` | No spec. **Login**: wrong email / wrong password ⇒ 401 + `recordFailureMany`; success ⇒ `resetMany`. **Register**: 409 for a taken email, bcrypt hash (not plaintext). **Refresh**: no cookie, unknown user, `tokenVersion` ≠ (revoke), rotation. **RevokeAll**. |
| B14 | `auth/services/refreshToken.serivce.ts` | No spec. `jti` stored in the DB, payload with `tokenVersion`; **rotation**: reuse detection (no record / `revoked`), expiry, revoking the old token before issuing a new one, invalid signature ⇒ 401. |
| B15 | `auth/services/accessToken.service.ts` | No spec. Payload `{sub, email}` (no password), signing/verification with the access config. |
| B16 | `auth/guards/jwtAuthGuard.guard.ts` | No spec. `@PublicEndpoint` skips the guard; no cookie ⇒ 401; bad token ⇒ 401; valid ⇒ `req.user`. |
| B17 | `auth/controllers/*.ts` | No spec. Setting/clearing cookies, passing `__bfKeys`, `revokeAll` for `user.sub`, `csrfToken`. |
| B18 | `auth/utils/cookie.utils.ts`, `expiresIn.ts` | No spec. `HttpOnly`, `SameSite` flags, `Path=/api/auth/refresh` for refresh, `Max-Age`; clearing including the "ghost" cookie on `/`. |
| B19 | `auth/config/*.ts`, `auth/dto/*.ts` | No spec. Default lifetimes, min/max validation; DTOs: email, minimum password length. |
| B20 | `users/users.service.ts` | No spec. P2002(email) ⇒ 409 mapping, passing other errors through, incrementing `tokenVersion`. |
| B21 | `database/prisma/prisma-errror.util.ts` | No spec. `isUniqueField` (code, field list, no `meta.target`). |
| B22 | `common/decorators/*.ts` | No spec. `CurrentUser` reads `req.user`; `PublicEndpoint` sets metadata read by the guard. |

### P2 — notes (medium risk, R5)

| ID | File | Gap |
|---|---|---|
| B30 | `notes/service/notes.service.ts` | No spec. **Every** method must have `userId` in `where` (R5); `content` skipped in the list; cursor ⇒ `skip: 1`; no FTS hits ⇒ no second query; `parentIds=[]` ⇒ no query. |
| B31 | `notes/service/userNotes.service.ts` | No spec — delegation with the right `userId`. |
| B32 | `notes/controller/notes.controller.ts` | No spec. 404 for a missing note, 400 for an empty `q` and forbidden fields, `userId` from `CurrentUser`. |
| B33 | `notes/service/notesTree.service.ts` | 71%: `expand=parent`, `depth=0`, the per-parent child limit, sorting, multiple levels, stopping when there are no children. |
| B34 | `notes/service/notesSerach.service.ts` | No `fields` ⇒ `[]`, passing the cursor. |
| B35 | `notes/utils/searchCursorPayload.ts` | encode/decode round-trip, rejecting garbage / a wrong `order`. |
| B36 | `notes/utils/validateNoteFields.ts`, `orderByForSearch.ts`, `note.utils.ts`, `notesToTree.ts` | Field validation, `rank`/`-rank` with tie-breakers, `clampDepth`, tree round-trip. |
| B37 | `notes/dto/getNoteQuery.dto.ts`, `searchNotesQueryDto.ts` | Validation + `ToInt` transformation (defaults, ranges, `IsIn`). |
| B38 | `notes/utils/markdown/markdownExtensions.ts` | `pageReferenceMarkdown` (render, tokenizer, parse) — 83%. |

### P3 — `core/`, `common/` (pure functions)

| ID | File | Gap |
|---|---|---|
| B40 | `core/tree/tree.service.ts` | No spec: indexing, `addChild(ren)` (deduplication), `updateNode`, `removeNode` (subtree, root deletion forbidden), `find`, error for an unknown id. |
| B41 | `core/sort/parseSort.ts` | No spec: default, `-field`, allowed fields. |
| B42 | `core/config/env.ts` | No spec: trim/empty ⇒ missing, default, `required`, min/max, boolean, `envSecret` (minimum bytes, dev fallback, prod). |
| B43 | `core/utils/*.ts`, `core/selector/utils.ts` | No spec: per-key limiter, `fromStringToArray`, `buildFieldSelector`. |
| B44 | `common/utils/time.ts`, `common/transformers/number.transformers.ts` | No spec. |
| B45 | `database/prisma/fts/toTsQuery.ts` | 100% only via other tests — no direct assertions (sanitizing tsquery operators is a security boundary). |

### Outside the scope of unit tests (deliberately)

| File | Why not unit | Where to test |
|---|---|---|
| `main.ts`, `app.module.ts`, `*/*.module.ts` (except existing ones) | DI wiring and middleware — a unit test would only confirm the provider list | e2e (app bootstrap) |
| `security/config/{helmet,csrf,cors,throttle}.config.ts` | static library configuration; the value only matters through HTTP headers | e2e: CSP/HSTS headers, CSRF 403 |
| `prisma.service.ts` | `omit` and `$connect` — need a real database | DB integration |
| SQL semantics (FTS, pgvector, `ragIndexedAt`) | a Prisma mock does not execute the query | DB integration (§4) |
| `*.types.ts`, `*.interface.ts`, `index.ts`, DTOs without decorators (`me.dto`, `refresh.dto`) | no logic | — |

## 4. Defects found during the audit

Production code in high-risk paths **was not changed** (§5: needs the diff read by a human). Defects confirmable with a unit test have an `it.failing(...)` test — it passes while the defect exists and **turns red after the fix** (then change it to `it`).

| ID | Severity | Location | Description and scenario | Test |
|---|---|---|---|---|
| D1 | major | `auth.service.ts:26` | `refresh()` calls `verifyToken` without `try/catch`. An expired/forged refresh token ⇒ `JsonWebTokenError` ⇒ **500** instead of 401 (`rotate()` maps it correctly, but is never reached). | `it.failing` |
| D2 | major | `auth.controller.ts:87` | `revokeAll` does not `await` `authService.revokeAll`. A DB error ⇒ the client gets 200 "revoked", the sessions are **not** revoked, and the rejected promise is unhandled (Node ≥15 terminates the process by default). | `it.failing` |
| D3 | major | `auth.controller.ts:63` | `@Throttle({ option: throttleAuthConfig })` — the name `option` matches no throttler (`global`, `auth`), so the limit override for `/auth/refresh` is ignored. | e2e |
| D4 | minor | `throttler-exception.filter.ts:15` | `originalUrl.startsWith('/auth')` — always false with the `/api` prefix. No effect today (both TTLs = 1 min); the log prints ms with an "s" suffix. | none (unobservable) |
| D5 | minor | `notes.service.ts:17` | `PATCH /notes/:id` on someone else's/a non-existent note ⇒ Prisma `P2025` ⇒ **500** instead of 404. Authorization is correct (scoping works), only the status is wrong. | e2e (AC-AUTHZ) |
| D6 | minor | `auth.service.ts:47` | Login for a non-existent email skips `bcrypt.compare` ⇒ the response time difference allows account enumeration. | none (timing) |
| D7 | minor | `common/utils/time.ts:12,20` | `minutesToSeconds(0)`/`daysToSeconds(0)` throw "must be defined" — 0 is treated as a missing value, although the message allows numbers ≥ 0. No effect today (config enforces ≥ 1). | documented in a test |
| D8 | minor | `notes.controller.ts:48` | The result of `validateAndNormalizeFields` is ignored; `fields=title, content` (with a space) ⇒ 400 "Forbidden field" instead of normalization. | documented in a test |
| D9 | info | `notes.controller.ts:32` | `getAll` logs the user's whole note list at `log` level on every request (noise, titles in logs). | — |
| D10 | info | `refreshToken.serivce.ts:80` | `RefreshTokenService.revokeAll` is unused — `AuthService.revokeAll` only bumps `tokenVersion` (effective, but the DB records stay `revoked=false`). | — |
| D11 | minor | `bruteForceService.ts:28` | `getOrCreateEntry()` clears `lockedUntil` after the window (30 s) passes, so `recordFailure` during a 2-min lock **lifts the lock**. Unreachable today through `BruteForceGuard` (it rejects locked keys before login), but the service API is wrong. *Found while writing tests.* | `it.failing` |
| D12 | minor | `auth/config/jwt.config.ts:15`, `refreshJwt.config.ts:15` | The dev fallbacks `'default-access-secret'` (21 B) and `'default-refresh-secret'` (22 B) are shorter than the 32 B required by `envSecret` — without `JWT_*_SECRET` the app **does not start even in dev**; the fallback never works. *Found while writing tests.* | `it.failing` |
| D13 | to verify | `toTsQuery.ts` + `orderByForSearch.ts` | A lone `-` (e.g. from `<->`) passes as the word `-:*`. Harmless for the FTS filter (`plainto_tsquery`); with `order=rank` the same string goes to `to_tsquery` in `_relevance` — needs confirming on a real Postgres that it does not cause a syntax error (500). | DB integration |

**Note on hermeticity (fixed as part of the audit):** tests of modules reading env at import time (JWT config) only passed when `@prisma/client` had been imported earlier in the same process, which loads the local `.env` as a side effect. Added `test/unit-env.setup.ts` (jest `setupFiles`) with deterministic test secrets — the tests no longer depend on the developer's `.env`.

## 5. Quality of existing tests (R6 criteria)

- The AI and notes tests are of good quality: names describe behaviour, assertions check the result and side effects, raw SQL is checked for parameters (`notesPgRepository.spec.ts`) — this pattern was adopted for the new tests.
- Weak assertions: 2 places (`toBeDefined` in `claude-agent-sdk.provider.spec.ts:133`, `not.toThrow` in `aiRunLimiter.service.spec.ts:21`) — correct in context (the second is preceded by a 429 status assertion), no change needed.
- No `skip`/`todo`/`xit`.
- The only really worthless test: `app.controller.spec.ts` (B01).

## 6. Plan for filling the gaps

**Rules**
1. Tests next to the file (`*.spec.ts`), in the style of the existing ones: building the class by hand with mocked dependencies, no `TestingModule` when DI is not needed; `Logger` silenced with `jest.spyOn(...).mockImplementation()`.
2. Assertions on **behaviour and contract** (status, response shape, arguments to dependencies, including `userId`), not on implementation.
3. Only the I/O boundary is mocked (Prisma, JWT, AI providers). Pure functions and crypto (`bcryptjs`, `SecretBox`, `@nestjs/jwt` in `AccessTokenService`/`RefreshTokenService`) — **real**.
4. Time: `jest.useFakeTimers` / `setSystemTime` instead of sleeps.
5. Defects: `it.failing` with the `D#` id in the name (section 4).
6. No production code changes. The only change outside tests: `setupFiles` in the Jest config (hermetic env, section 4).
7. Shared test helpers next to the code they concern: `src/common/testing/http-test.utils.ts` (ExecutionContext/ArgumentsHost/Response for guards, filters and decorators).

**Order**: P0 → P1 → P2 → P3 (as in section 3).

**Definition of Done**
- `npx jest` — green, 0 red.
- `npm run test:ai` — green (100%).
- Every item B01–B45 has a test or is on the "out of scope" list.
- Every defect is described; those confirmable with a unit test (D1, D2, D11, D12) have `it.failing`.
- Every method reading/changing user data has a `userId` scoping assertion.

## 7. Result

| Metric | Before | After |
|---|---|---|
| Suites / tests | 43 / 416 (1 red) | **73 / 804 (0 red)** |
| `npm run test:ai` (100% threshold) | red (93.4% lines) | **green (100% / 100% / 100% / 100%)** |
| Global coverage — statements | 71.2% | **96.2%** |
| Global coverage — branches | 64.9% | **94.6%** |
| Global coverage — functions | 64.6% | **96.0%** |
| Global coverage — lines | 70.7% | **96.2%** |

Coverage per area (lines, after): `modules/ai` 100% · `modules/users` 100% · `modules/notes/controller` 100% · `modules/notes/utils` 100% · `infrastructure/security` 98.6% · `modules/notes/service` 97.7% · `core` 95.0% · `modules/auth` 92.8% · `common` 83.1% · `infrastructure/database` 77.8%.

The remaining uncovered lines are only items from the "out of scope" list (section 3): `*.module.ts`, `main.ts`, `prisma.service.ts`, `index.ts` barrels, DTOs without decorators, `env.enum.ts`, and unused branches of the test helper. Other branches unreachable through public behaviour (e.g. `notesTree.service.ts:98–99` — a child without `parentId` is rejected earlier by the limiter) were left without artificial tests.

**Test files** — rewritten: `app.controller.spec`. New (30): `aiSettings.controller`, `aiModule.config`, `ai.consts`, `embedding-provider.factory`, `bruteForceService`, `bruteForce.guard`, `brute-force-exception.filter`, `throttler-exception.filter`, `jwt.config`, `cookie.utils`, `accessToken.service`, `refreshToken.service`, `auth.service`, `jwtAuthGuard.guard`, `auth.controller` (+ `CsrfController`), `auth.dto`, `users.service`, `prisma-errror.util`, `decorators`, `markdownExtensions`, `notes.service`, `userNotes.service`, `notes.controller`, `noteQuery.utils`, `noteQuery.dto`, `tree.service`, `env`, `core.utils`, `common.utils`, `toTsQuery`. Extended (12): `rag.repository`, `ragIndexer.service`, `ragSearch.service`, `chunkMarkdown`, `claude-agent-sdk.provider`, `ollama-embedding.provider`, `aiRunLimiter.service`, `aiCredentials.service`, `ai.service`, `assistPrompt`, `notesTree.service`, `notesSearch.service`.

**Verification**: `npx jest` green · `npm run test:ai` green · `tsc --noEmit` with no new errors (the only error is the existing `test/app.e2e-spec.ts`, CONCEPT phase 0) · ESLint `--max-warnings 0` clean on all new/edited test files.

## 8. Recommended next steps

1. **Fix defects D1, D2, D11, D12** (high-risk paths — the diff must be read by a human). After each fix the corresponding `it.failing` turns red → change it to `it`.
2. **E2E / DB integration** (outside the scope of this audit): AC-AUTHZ B→A for `/notes/:id` (GET/PATCH, including D5), D3 (throttling `/auth/refresh`), D13 (`order=rank` with `-`), helmet/CSRF headers, `omit` in `PrismaService`.
3. **Coverage ratchet** (once CI is stable, §4): consider a per-path `coverageThreshold` for high-risk paths (`security/**`, `auth/**`, `ai/credentials/**`) instead of a global threshold.

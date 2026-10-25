# BE tests — what is not covered and why

State: 2026-10-12 · 73 files, 804 tests · coverage: **96.2% statements · 94.6% branches · 96.0% functions** · `test:ai` 100%

Full audit (requirements, approach, defects found): [UNIT-TEST-AUDIT.md](./UNIT-TEST-AUDIT.md).
FE counterpart: `notes-app-fe/docs/testing/README.md` (the same A–E category structure).

## Running

```bash
npm test                # jest, unit tests (~10 s)
npm run test:cov        # + coverage (console + HTML report in coverage/)
npm run test:ai         # AI module with a 100% threshold — must be green
npm run test:e2e        # e2e on Postgres: locally `docker compose up -d db` (the notes_e2e database creates itself), see A.3
```

Test infrastructure:

| File | Role |
|---|---|
| `test/unit-env.setup.ts` | jest `setupFiles`: fixed JWT secrets so tests do not depend on the local `.env` |
| `src/common/testing/http-test.utils.ts` | `makeHttpContext`, `makeResponse`: ExecutionContext / ArgumentsHost / Response for guards, filters and decorators |
| `src/infrastructure/ai/testing/ai-test.utils.ts` | `makeAiConfig`, `streamOf`, `collect`: AI providers without a network |
| `src/__mocks__/@anthropic-ai/claude-agent-sdk.ts` | Claude SDK mock |

## Principle

The goal is not 100%. Coverage shows which lines ran, not whether the behaviour was checked. The last percent is usually reached with worthless tests (`CONCEPT.md` §4). The exception is `test:ai`, where 100% is a deliberately chosen gate. Every uncovered spot belongs to one of the categories below, and every category has its decision.

| Category | Decision |
|---|---|
| A. Needs a real database or the whole HTTP pipeline | **e2e / integration tests** (`test/`), not unit |
| B. App configuration (composition root) | no unit tests; app startup is checked by an e2e smoke test |
| C. Dead or unfinished code | delete or finish it, do not test it |
| D. Defensive branches | deliberately untested |
| E. Real logic without a test | **candidates to add** |

## A. Needs a real database / HTTP pipeline → e2e

This is the counterpart of the FE category "needs a real browser → Playwright". On the BE the role of jsdom is played by the Prisma mock: a unit test checks that the right query reaches the database (`where: { userId }`, parameters instead of inline SQL). It will not check what Postgres does with that query. Likewise, a controller called directly in a test skips middleware, global guards, `ValidationPipe` and exception filters — everything set up by `main.ts` and `app.module.ts`. Replacing those in a unit test would test the replacements, not the app.

### A.1 What a unit test cannot check and where it will be

| Area | What cannot be checked with a unit test | What is already covered by unit tests | e2e file (plan) |
|---|---|---|---|
| **B→A authorization** (`CONCEPT` §2, mandatory) | that user B really gets 404 on A's note: needs two accounts, a real JWT in a cookie and a database | every query in `NotesService` has `userId` in `where`, and `RagRepository` filters `userId` in SQL (`notes.service.spec`, `rag.repository.spec`) | `notes.authz.e2e-spec.ts` |
| **PATCH of someone else's note** (D5, fixed) and **`parentId` of someone else's note** (D14, fixed) | Prisma `P2025` → **404**; `parent.connect` is narrowed to `{ id, userId }` | the service maps `P2025` to `NotFoundException` (`notes.service.spec` › *D5*, *D14*) | `notes.authz.e2e-spec.ts` |
| **Full-text search** | that `plainto_tsquery` + GIN indexes return the right notes, including prefixes, Polish characters and cursor pagination | query sanitization (`toTsQuery.spec`), the SQL expression identical to the migration's index (`notesPgRepository.spec`) | `notes.search.e2e-spec.ts` |
| **`order=rank` with a lone `-`** (D13) | whether `to_tsquery('… & -:*')` in `_relevance` does not raise a syntax error → 500 | `toTsQuery` lets `-:*` through (`toTsQuery.spec`) | `notes.search.e2e-spec.ts` |
| **pgvector / RAG** | cosine search, `vector_dims`, the DELETE→INSERT→UPDATE transaction, the `ragIndexedAt = updatedAt` condition with a time zone ≠ UTC | the shape and parameters of every query (`rag.repository.spec`), the indexer logic (`ragIndexer.service.spec`) | `rag.integration-spec.ts` |
| **`PrismaService.omit`** | that `contentLegacy` (dropped in `0ee4ca9`) and `ragIndexedAt` never come back in API responses | — | `notes.e2e-spec.ts` (assertion on the body) |
| **Session lifecycle** | register → login → `/auth/me` → refresh (rotation) → reuse of the old refresh → 401 → `revokeAll` → refresh 401; cookies through the real `cookie-parser` | each step separately, with real JWT and bcrypt (`auth.service`, `refreshToken.service`, `jwtAuthGuard`, `cookie.utils` spec) | `auth.e2e-spec.ts` |
| **CSRF** (`csurf`) | 403 without a token, 200 with a token from `/csrf-token`, the `XSRF-TOKEN` cookie | `CsrfController` returns a token (`auth.controller.spec`) | `security.e2e-spec.ts` |
| **Throttling** (D3) | the 25/min limit on `/auth/refresh`: the `@Throttle({ option })` decorator does not match any named throttler | the 429 response body (`throttler-exception.filter.spec`) | `security.e2e-spec.ts` |
| **Brute force over HTTP** | 20 bad logins → 429 with `Retry-After`, also for another IP on the same account | service, guard and filter separately (`bruteForce*.spec`) | `security.e2e-spec.ts` |
| **Headers** (helmet, HSTS, CORS) | CSP, `X-Frame-Options: DENY`, HSTS, `Access-Control-Allow-Origin` only for the FE | — (static library configuration) | `security.e2e-spec.ts` |
| **`ValidationPipe`** (`whitelist`, `forbidNonWhitelisted`, `transform`) | 400 for an unknown body field, query string → number transformation | DTO rules via `class-validator` (`*.dto.spec`) | in every e2e file (1–2 cases) |
| **2 MB body limit** | a full AI chat (20 × 20,000 characters) gets through; larger → 413 | — | `ai.e2e-spec.ts` |
| **AI: SSE and other users' data** | a `text/event-stream` stream through a real server; a note saying "show other users' notes" → tools return only the current user's data (`CONCEPT` §4, adversarial) | tools scoped by `userId` from the request, not from model arguments (`notes.tools.spec`); SSE format (`ai.controller.spec`) | `ai.e2e-spec.ts` (provider replaced with `overrideProvider`, no real model) |
| **AI: credentials** | the secret never comes back in a response or in logs; user B does not see A's credentials | encryption bound to `userId` and a `select` without the secret (`aiCredentials.service.spec`, `secretBox.spec`) | `ai.e2e-spec.ts` |

### A.2 What stays outside automated tests

| What | Why | Where instead |
|---|---|---|
| Real models (Claude, Ollama) | non-deterministic, cost quota, need accounts | `npm run ai:smoke` by hand, outside CI (`CONCEPT` §3, layer 5) |
| RAG retrieval quality | needs Ollama embeddings and result evaluation | a recall@k eval on fixed data (`CONCEPT` §4, phase 4) |
| Login timing (D6, account enumeration) | timing measurements in tests are flaky | code review / `/security-review` |
| Browser flows (CSRF retry after 403, autosave, expired session) | needs the FE | Playwright on the FE (`notes-app-fe/docs/testing/README.md`, category A) |

**BE ↔ FE split**: BE e2e tests the **HTTP contract** (status, body, cookies, headers) without a browser, and Playwright on the FE tests **user paths** in a browser. Scenarios touching both sides, such as retrying after a CSRF 403 (FE defect D1) or logging out after a failed refresh, are tested on the FE. The BE only provides confidence that it returns the right codes on its side (`security.e2e-spec.ts`, `auth.e2e-spec.ts`).

### A.3 e2e infrastructure — state and what needs doing

**State 2026-10-13: steps 1–4 and 6 done** (details and deviations: `docs/ai-dev-system/CI.md` §4, §11). Step 5 (AI provider fakes) — with the first `ai.e2e-spec.ts`. Safety check: e2e refuses to run on a database whose name does not end with `_e2e`/`_test`.

| Step | Details |
|---|---|
| 1. `test/jest-e2e.json` | add `moduleNameMapper` (aliases `@ai`, `@core`, `@security`, `@common`, `@database`, `src/`, as in `package.json`) and `setupFiles: ["<rootDir>/unit-env.setup.ts"]` |
| 2. Shared bootstrap | extract a `configureApp(app)` function from `main.ts` (`/api` prefix, `cookieParser`, `csrf`, CORS, helmet, `ValidationPipe`, body limit). Without it e2e would test a **different** app than production. This is a production code change and needs approval. |
| 3. Database | `pgvector/pgvector:pg15` (as in `docker-compose.yaml`), a separate `notes_e2e` database, `prisma migrate deploy` before the suite, `TRUNCATE` of tables between tests (`globalSetup` / `beforeEach`) |
| 4. `test/support/` helpers | `createTestApp()`, `registerUser(app)` → a supertest agent with cookies, `csrf(agent)` → the `X-CSRF-Token` header |
| 5. AI without a network | `overrideProvider(AGENT_PROVIDER / LLM_PROVIDER / EMBEDDING_PROVIDER)` with deterministic fakes; a large `RAG_INDEX_INTERVAL_MS`, indexing triggered by hand |
| 6. CI | an `e2e` job with a Postgres service (`CONCEPT` §3.3) |

Target layout, analogous to the FE (`src/shared/lib/test/`), only in `test/`:

```
test/
├── jest-e2e.json
├── unit-env.setup.ts          # already exists (unit); shared with e2e
├── support/                   # createTestApp, registerUser, csrf, db reset
├── app.e2e-spec.ts            # smoke: the app starts, /api responds
├── auth.e2e-spec.ts
├── notes.e2e-spec.ts
├── notes.authz.e2e-spec.ts    # B→A for every endpoint with :id
├── notes.search.e2e-spec.ts
├── security.e2e-spec.ts
├── ai.e2e-spec.ts
└── rag.integration-spec.ts
```

## B. App configuration (composition root)

| File | Coverage | Why no unit tests |
|---|---|---|
| `main.ts` | 0% | the entry point (middleware, prefix, pipe). The right place is an e2e smoke test after step A.3/2 |
| `app.module.ts`, `auth.module.ts`, `prisma.module.ts` | 0% | DI wiring only. A unit test would repeat the provider list, and a wiring error breaks app startup anyway (e2e smoke). Valuable exceptions already exist: `ai.module.spec`, `ai-infrastructure.module.spec` (provider choice from env) |
| `prisma.service.ts` | 50% | `$connect` / `$disconnect` and `omit` only work with a real database → A.1 (*PrismaService.omit*) |
| `security/config/helmet.config.ts` (6, 24), `csrf.config.ts` (8) | prod branches | `isProd` is computed at import time. The option value alone says nothing; what matters are headers and cookies → `security.e2e-spec.ts` |
| `index.ts` (barrels), `*.types.ts`, `*.interface.ts`, `express.d.ts` | 0% | no logic |

## C. Dead or unfinished code

Testing these spots would cement code that should disappear or be finished.

| File / lines | State | Decision |
|---|---|---|
| `app.service.ts` (`'XXdddXX!'`), `app.controller.ts` `POST /dashboard` | scaffold placeholders (mocked statistics), unused by the FE | delete `/dashboard`; keep `GET /api` as a health check with a meaningful response |
| `auth/dto/me.dto.ts`, `auth/dto/refresh.dto.ts` | imported nowhere | delete |
| `core/types/env.enum.ts` (`Environment`) | used nowhere | delete |
| `refreshToken.serivce.ts` `revokeAll` (D10) | unused: `AuthService.revokeAll` only bumps `tokenVersion` | use it in `AuthService.revokeAll` (DB cleanup) or delete it |
| `throttler-exception.filter.ts` 15 (the `/auth` branch) | dead because of the `/api` prefix (D4) | change to `/api/auth` when fixing D3 |
| `core/tree/tree.service.ts` 67 (`forEach` without `startId`) | a private branch nobody calls | keep (tree API) or simplify |

## D. Defensive branches — deliberately untested

Safeguards for situations that do not occur with the current code. Testing them would require artificially breaking the input, and such a test does not check behaviour visible to an API client.

| File / lines | Branch | Why it does not occur |
|---|---|---|
| `notesTree.service.ts` 98–99 | a child without `parentId` | the `parentId IN (...)` query does not return `null`, and the limiter rejects an empty key earlier anyway (the behaviour is checked by *skips a child without a parent reference*) |
| `notesTree.service.ts` 71, `notesSerach.service.ts` 43 | `?? []` after a `NotesService` result | `NotesService` always returns an array |
| `note.mapper.ts` 17, `notesToTree.ts` 20 | `!prismaNotes`, `children?.` | Prisma `findMany` always returns an array; tree nodes always have `children` |
| `core/tree/tree.service.ts` 52 | a node (not the root) without `parentId` | `addChild` always sets the parent |
| `cookie.utils.ts` 10, 20 | `setAuthCookies` without an access token | every call (register, login, refresh) passes both tokens; a missing refresh token is tested |
| `markdownEscape.ts` 48, 59, `markdownExtensions.ts` 33, 76 | `text ?? ''`, `type ?? ''`, a non-string `title` | the Tiptap parser always sets these fields (BE copy removed in `0ee4ca9`) |
| `tiptapToMarkdown.ts` 51, 78 | a legacy document without `content` / with an unknown root | the markdown migration is complete; the converter only remained for the backfill (removed together with `content_legacy` in `0ee4ca9`) |
| `http-test.utils.ts` (`switchToRpc`, `switchToWs`, `getArgs`) | a test helper | a complete `ExecutionContext` interface; not production code |

## E. Real logic without a test — candidates to add

These tests are cheap and check behaviour a user would notice. Recommendation: add them with the next change in the given file.

| File / lines | What is not checked | How to test |
|---|---|---|
| `markdownExtensions.ts` 41–47 | an empty code block and a block without a language after saving | `markdownExtensions.spec`: round-trip `` ```\n``` `` and `` ```ts\n``` `` |
| `markdownText.ts` 52–55 | the snippet when the match is inside a long word without spaces (no space after `start`) | `markdownText.spec`: text > 160 characters without spaces, match in the middle |

## Known-defect tests (`it.failing`)

An `it.failing` test describes the **correct** behaviour and fails today because of a bug in the code. The suite is green and the bug is visible. After the fix the test starts failing; then change `it.failing` to `it`.

There are currently no open defects with an `it.failing` test. Fixed (plain `it` today):

| Defect | Test |
|---|---|
| D5: PATCH of someone else's note → 500 instead of 404 (Prisma `P2025` unmapped) | `test/notes.authz.e2e-spec.ts` |
| D14: `parentId` without an owner check — B could create a note under A's note (200): a cross-account relation and an id-existence oracle | `test/notes.authz.e2e-spec.ts` |

Defects that cannot be checked with a unit test (D3, D13) are in table A.1 with their target e2e file.

### Covered by e2e

| Row from A.1 | Test |
|---|---|
| B→A authorization (GET `:id`, list, PATCH, `parentId`) | `test/notes.authz.e2e-spec.ts` |
| PATCH of someone else's note (D5) and `parentId` of someone else's note (D14) | `test/notes.authz.e2e-spec.ts` |
| App startup with the production pipeline (`configureApp`) | `test/app.e2e-spec.ts` |
| Refresh with an expired/forged/malformed token → 401 (D1, fixed) | `test/auth.e2e-spec.ts` |
| Refresh with the old token after `revokeAll` → 401 (D2 fixed, error path in a unit test) | `test/auth.e2e-spec.ts` |
| Access token after `revokeAll` → 401 immediately (S3 fixed) | `test/auth.e2e-spec.ts` |
| Brute force behind a proxy: the attacker's IP is locked, the owner is not (S4, S12); a spoofed X-Forwarded-For is ignored without `TRUST_PROXY` | `test/auth.sessions.e2e-spec.ts` |
| Logout revokes the session's refresh token, also after a refresh; other sessions and other users stay signed in (S11, AC-AUTHZ) | `test/auth.sessions.e2e-spec.ts` |
| Compressed request bodies → 415 | `test/security.body.e2e-spec.ts` |
| Note import: tree, links, FTS, B→A under someone else's note (AC-AUTHZ), CSRF before the 25 MB parser, 413/400 limits, throttling | `test/notes.import.e2e-spec.ts` |

## Security backlog (found in reviews on 2026-10-15 and 2026-10-24)

Issues without an `it.failing` test — to decide / do later. Fixed ones stay with a note.

| Id | Severity | Problem | Proposal |
|---|---|---|---|
| S1 | high | **Fixed** (branch `fix/secrets-and-session-revocation`): `AI_CREDENTIALS_SECRET` had a fallback known from the repo; outside `NODE_ENV=production`, users' AI keys were encrypted with a public key. | Fallback removed; `change-me` placeholders from `.env.example` rejected in production. |
| S2 | medium | **Fixed** (as above): the same secret for access and refresh → a refresh token (7 days) passes as an access token. | App startup refuses identical secrets. |
| S3 | medium | **Fixed** (as above): after "log out everywhere" the access token still worked for up to 15 min. | `tokenVersion` in the access token, the guard checks it in the database (1 query per request). |
| S4 | low | **Fixed** (branch `fix/security-backlog`): 20 bad passwords for **someone else's** account locked the owner out of login for 2 min, with no repeat limit. | Brute force counts per client only (IPv4, or IPv6 by /64); no account-wide key. Residual risk: guessing one account from many networks is capped per network only — CAPTCHA or a delay if that becomes a real threat. |
| S5 | low | **Fixed** (as above): a successful login also reset the IP counter — an attacker with their own account could reset it between attempts. | A successful login no longer resets the counter; it expires with the window. |
| S6 | low | **Fixed** (as above): `BruteForceService.attemptsStore` never removed expired entries. | Expired entries are swept at most once per window. Still in memory, per instance — Redis when scaling. |
| S7 | info | Dockerfile: `node:20` (while `.nvmrc` = 22), `start:dev`, no `NODE_ENV` — for local work only. | A separate production image before the first deployment (stage 3). |
| S8 | info | **Fixed** (as above): JWT `verify()` without a pinned `algorithms` list; `JwtAuthGuard` logged the whole error object. | `algorithms: ['HS256']`; the guard logs only the error name and message. |
| S9 | high | **Fixed** (as above): `npm audit` reported vulnerabilities in dependencies (42 on 2026-10-15, 8 in production on 2026-10-24). | Audit fixes + `multer` override 2.5.0 → 2 low left: `cookie` < 0.7 inside `csurf`, unreachable (fixed cookie name and path). Body parsers also reject compressed bodies (`inflate: false`). |
| S10 | low | **Fixed** (as above): sorting by relevance (`rank`) had no pagination — the cursor only supported `updatedAt`. | The cursor (`{ id, order }`) also works for `rank`/`-rank`: the next page starts after the given note. |
| S11 | info | **Fixed** (as above): a plain "Log out" only cleared cookies; a stolen refresh token worked until "log out everywhere" or expiry (7 days). | The access token carries `sid` (the refresh token's jti); logout revokes that refresh token. The access token itself still lives up to 15 min. |
| S12 | high | **Fixed** (as above): no `trust proxy` — behind a reverse proxy (Railway) every client has the proxy's IP, so one attacker locks everybody out of login and the rate limits. | `TRUST_PROXY` (proxy hops, default 0). **Set `TRUST_PROXY=1` on Railway** and check `req.ip` once after deploying. |
| S13 | low | **Fixed** (as above): refresh rotation read and revoked the old token in two steps — two parallel refreshes with one token created two live sessions. | Atomic revoke (`updateMany` with `revoked: false`, count must be 1). |

## Known suite behaviour

- **Random e2e 404/403/"socket hang up" on macOS**: `request(app.getHttpServer())` makes supertest bind a new random port per request; on macOS that port can already be taken on 127.0.0.1 by another local process (editor helpers, etc.), and the request lands there. Not a code bug (also seen on `develop`); CI on Linux is unaffected. `test/auth.sessions.e2e-spec.ts` and `test/security.body.e2e-spec.ts` listen once on 127.0.0.1 to avoid it; doing the same in `test/support/app.ts` would fix every suite.
- **Modules reading env at import time** (`jwt.config`, `cookie.utils`, `env.ts`, `aiModule.config`) are loaded in tests via `jest.isolateModules`, with `process.env` set for each case. A plain `import` at the top of the file would read env only once.
- **`@prisma/client` loads `.env` at import time.** That is why `test/unit-env.setup.ts` exists: without it the test results would depend on whether the developer has a local `.env`.
- **Fake timers and `jsonwebtoken`**: in tests with `signAsync` use `jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })`, otherwise the signature never completes (timeout).

## Updating this file

After a larger change, run `npm run test:cov` and compare with the tables above. Assign every new spot below ~90% to a category A–E. If it does not fit any, a test is simply missing. Once the e2e infrastructure exists (A.3), move the completed rows from A.1 to the "covered by e2e" table with the test name.

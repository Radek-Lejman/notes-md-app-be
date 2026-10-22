# CI (GitHub Actions) + branch protection — proposal

> Status: **CI green on `ci/github-actions` (BE, FE); rulesets active and tested; merged into BE `develop` and FE `main` 2026-10-14 — CI phase complete** · 2026-10-13 · v2 after a review (6.5/10, §10) · implementation state in §11 · implements phase 1 of [CONCEPT.md](./CONCEPT.md) §3.3 and §8 · context: [GIT-HOOKS.md](./GIT-HOOKS.md), [docs/testing/README.md](../testing/README.md) §A.3

## 1. Goal

Hooks (GIT-HOOKS.md) can be bypassed and check the working tree, not the commits being pushed. CI is the **final gate that cannot be bypassed**: the same command as locally, on a clean checkout, on the exact SHA. Branch protection makes sure a red commit does not reach `develop`/`main`.

Done criterion (CONCEPT §8, phase 1, rephrased from "a PR with a red test cannot be merged"): **a SHA without green checks cannot be pushed to a protected branch** — verified on a real run, negatively and positively.

## 2. Starting point (measured 2026-10-13)

| | BE (`Radek-Lejman/notes-md-app-be`) | FE (`Radek-Lejman/notes-fe-app`) |
|---|---|---|
| Visibility | **public** → branch protection and rulesets available on the Free plan | **public** |
| `.github/` | none | none |
| Branches | `develop` (work), `main` = only "Initial commit" | `main` (work), an old `master` on the remote |
| Node | 25 locally, `Dockerfile`: `node:20` (EOL 04.2026) | `node:20-alpine` |
| Scripts | `typecheck`, `lint:check`, `test`, `test:ai` (100% threshold), `test:e2e` (**broken**) | `typecheck` (`tsc -b`), `lint`, `format:check` (✓), `test`, `build` (`tsc -b && vite build`) |
| e2e | `jest-e2e.json` without aliases and setupFiles; `app.e2e-spec.ts` expects `"Hello World!"` at `/`, while the app has the `/api` prefix and a global `JwtAuthGuard`; no database; middleware (CSRF, cookie-parser, pipe) lives only in `main.ts` | — |
| `npm audit --audit-level=high` | **exit 1** (61 high, 3 critical; also with `--omit=dev`) | **exit 1** (27 high, 2 critical) |
| `gh` CLI | not installed | |

## 3. BE — `.github/workflows/ci.yml`

### 3.1 Triggers and shared settings

```yaml
on:
  push:              # every branch — checks land on the SHA we then ff-merge
  workflow_dispatch:
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
permissions: { contents: read }
```

- **Why `push` on every branch rather than only `pull_request`**: the flow is solo and linear — feature → local `merge --ff-only` → `push develop`. A fast-forward **keeps the SHA**, so the checks from the feature branch push are already "green" for the commit that lands on `develop`. A ruleset with required checks (§5) lets such a push through and rejects a SHA without green checks.
- No `pull_request` — every SHA goes through a push anyway; PRs from forks do not happen (solo). Pushing `develop` after the ff starts a second run on the same SHA — free in a public repo, accepted.
- Every job has `timeout-minutes` (open Prisma handles/timers can hang a job for 6 h).
- Node from `.nvmrc` = **22** (LTS; `lint-staged` needs ≥ 22.22.1, `vite` ≥ 22.12 — `22` resolves to the latest 22.x). CI tests the same as local; bumping the `Dockerfile` from `node:20` → `node:22` is a separate small change (out of scope, but recommended — 20 is EOL).
- `actions/setup-node` with `cache: npm`; `npm ci`; `npx prisma generate` (the Prisma client is not in the repo).

### 3.2 Jobs

| Job | Steps | Time (est.) | Blocking |
|---|---|---|---|
| `static` | `npm run typecheck` → `npm run lint:check` | ~1 min | yes |
| `unit` | `npx jest --ci` → `npm run test:ai` (100% threshold) | ~1 min | yes |
| `e2e` | service `pgvector/pgvector:pg15-trixie` (the same image as `docker-compose.yaml`) with a healthcheck, **`POSTGRES_USER=admin`, `POSTGRES_PASSWORD=secret`, `POSTGRES_DB=myapp`** (see §4.2) → `DATABASE_URL=…/notes_e2e` → `npm run test:e2e` (migrations in `globalSetup`, §4) | ~2 min | yes |
| `secrets` | gitleaks over the **whole history** (`fetch-depth: 0`) — a release binary (pinned version), `gitleaks git --redact --exit-code 1` | <30 s | yes |
| `audit` | `npm audit --omit=dev --audit-level=high` — a step with `continue-on-error` + numbers in `$GITHUB_STEP_SUMMARY`, so the job is green (it does not teach ignoring red) | <30 s | **no** — see §7 |

Notes:
- gitleaks as a binary (pinned version), not `gitleaks/gitleaks-action` — the same result locally (`brew install gitleaks`), no dependency on how the action behaves for different events. Note: hooks use secretlint, CI uses gitleaks — the scanners may differ (that is the point: a second layer).
- The reviewer ran gitleaks 8.30.1 over the full history: BE — 1 false positive (`generic-api-key`, `README.md:5`, commit `e12e58b` — a CircleCI badge token from the Nest scaffold), FE — clean. → `.gitleaksignore` with that fingerprint **before** setting up the rulesets.
- **Strict ratchet** (CONCEPT §3) and coverage ratchet — outside this step; they come once CI is stable.
- Job names = the required check names in §5 — renaming a job requires changing the ruleset.

## 4. BE — fixing e2e (docs/testing/README.md §A.3, steps 1–4)

| # | Change | File | Notes |
|---|---|---|---|
| E1 | `moduleNameMapper` (the same aliases as `jest` in `package.json`, paths `<rootDir>/../src/…`, **including `^marked$` → `marked.umd.js`** — `@tiptap/markdown` is reachable from `AppModule`), `setupFiles: [unit-env.setup.ts, e2e-env.setup.ts]`, `globalSetup`, `maxWorkers: 1` | `test/jest-e2e.json` | one worker — a shared database; `globalSetup` does not see `moduleNameMapper`, so no aliases there |
| E2 | **`configureApp(app)`** extracted from `main.ts` (2 MB body limit, `/api` prefix, cookie-parser, CSRF, CORS, helmet, HSTS, `ValidationPipe`); `main.ts` just calls it | `src/app.setup.ts`, `src/main.ts` | **a production code change** (behaviour unchanged, identical middleware order). Without it e2e would test a different app than production |
| E3 | **one env module** `test/support/e2e-env.ts` imported by both `globalSetup` and `setupFiles` (globalSetup runs before setupFiles, in a different context). It sets: `NODE_ENV=test`, `DATABASE_URL` (default `postgresql://admin:secret@localhost:5433/notes_e2e`, CI overrides it), `RAG_ENABLED=false`, and **explicitly every AI/RAG variable** the app reads (providers, `AI_SERVER_LOGIN_EMAILS=`, `AI_CREDENTIALS_SECRET`) | `test/support/e2e-env.ts`, `test/e2e-env.setup.ts` | `ConfigModule` and `@prisma/client` copy **every variable that is not set** from the local `.env` — so we set everything that matters, making a local run = CI |
| E4 | `globalSetup`: a **safety check** — refuses to run if the database name in `DATABASE_URL` does not end with `_e2e`/`_test`; then `prisma migrate deploy` (creates the database if missing — verified) | `test/support/global-setup.ts` | protects the local development database from `TRUNCATE` |
| E5 | helpers: `createTestApp()` (AppModule + `configureApp` + `init`; `afterAll(app.close)`), `resetDb(app)` in `beforeEach` (`TRUNCATE … RESTART IDENTITY CASCADE` — tables from `pg_tables` for `schemaname='public'`, without `_prisma_migrations`), `registerUser(app)` → a `supertest.agent` with session cookies and the `X-CSRF-Token` header | `test/support/*.ts` | CSRF: `GET /api/csrf-token` → token in the header, secret in a cookie — the same as the FE. **Throttler**: both named limits apply to every route → effectively **25 requests/min per route** per app instance; the app is created per file — be careful with future `auth.e2e-spec.ts` (or replace the guard in tests) |
| E6 | a smoke test instead of "Hello World": the app starts with a real database; `GET /api/csrf-token` → 200; `GET /api/notes` without a session → 401 | `test/app.e2e-spec.ts` | `GET /api` (placeholder `'XXdddXX!'`) deliberately untested — category C in the testing README |

### 4.1 The first authorization test — `test/notes.authz.e2e-spec.ts`

The convention from CONCEPT §3 (layer 2): every endpoint with `:id` has a test "B gets 404 on A's resource".

| Test | Expectation | Notes |
|---|---|---|
| control: A gets their own note | 200 + title | without it, B's 404 could come from a broken setup |
| control: A updates their own note (PATCH) | 200 | proves CSRF and cookies work for mutating requests (csurf ignores GET) — without it the PATCH tests below could pass via a 403 |
| `AC-AUTHZ: B gets 404 on GET /api/notes/:id of A's note` | 404, the body does not contain A's title/content | **the main test in scope** |
| `AC-AUTHZ: GET /api/notes of user B does not contain A's notes` | B's list without A's note id | cheap, the same bug class |
| `AC-AUTHZ: PATCH by B does not change A's note` | status ∈ {404, 500} (not 401/403), A's note (fetched by A) has an unchanged title | the actual security property — already passes today (`update` with `where: { id, userId }` is atomic) |
| `AC-AUTHZ: PATCH by B on A's note → 404` (`it.failing`) | 404 | defect **D5** (500 today from Prisma `P2025`, no Prisma exception filter); the `it.failing` convention as in the testing README — after fixing D5 change it to `it` |
| `AC-AUTHZ: B cannot attach a note under A's note (`parentId`)` | 404/400, B's note without a parent | a review finding: the DTO accepts `parentId` without checking the parent's owner. The test will establish the behaviour; if it leaks → `it.failing` + a new defect in the testing README |

### 4.2 A migration with a hard-coded database name (review blocker)

`20251116_set_default_FTS_simple` runs `ALTER DATABASE myapp …; ALTER ROLE admin IN DATABASE myapp …`. On a clean Postgres (`notes_e2e`, no `admin` role) `migrate deploy` fails with `P3018 / 3D000` and leaves the database in a failed state (P3009). Locally it only works because `docker/postgres/init` creates `myapp`/`admin` — and the setting goes to `myapp` anyway, not to the test database (harmless, because the FTS repository passes `'simple'` explicitly).

Decision: **we do not edit an applied migration** (checksum change, hook C6 blocks it). The CI service recreates the compose conditions: user `admin`/`secret`, database `myapp` exists, tests run on `notes_e2e` (created by Prisma). This migration is debt — if migrations are ever squashed, replace it with `EXECUTE format(… current_database(), current_user)`.

## 5. FE — `.github/workflows/ci.yml`

The same triggers (push on every branch), Node 22 from `.nvmrc`, `cache: npm`.

| Job | Steps | Blocking |
|---|---|---|
| `verify` | `npm ci` → `npm run typecheck` → `npm run lint` → `npm run format:check` → `npm test` → `npx vite build` | yes |
| `secrets` | gitleaks, as in the BE | yes |
| `audit` | `npm audit --omit=dev --audit-level=high` | no |

- One job instead of four: the FE has no database, the steps take seconds, and `npm ci` in every job would cost more than the checks themselves. The first red step is visible in the log anyway.
- `npx vite build` instead of `npm run build` — `build` runs `tsc -b` a second time.
- `VITE_API_URL` not needed — the build falls back to `http://localhost:3000/api`.

## 6. Branch protection (rulesets)

Rulesets (newer than classic "branch protection", available for public repos on Free):

| Repo | Branches | Rules |
|---|---|---|
| BE | `main`, `develop` | block force-push (`non_fast_forward`), block deletion, **required checks** `static`, `unit`, `e2e`, `secrets` |
| FE | `main` | block force-push, block deletion, **required checks** `verify`, `secrets` |

- **No PR requirement** (a deviation from CONCEPT §3.3, where a PR was mandatory on `main`). Reason: GitHub always rewrites the SHA on "rebase merge", and "merge commit"/"squash" break the linear ff history you use. Required checks on the SHA give the same guarantee ("red does not get in") without changing the flow. A PR requirement can be added later if you start working with PRs (e.g. for AI review on GitHub).
- **No bypass** for the admin. CI outage → temporarily disable the ruleset (deliberate, visible in the audit log), do not bypass it.
- `develop` protected (CONCEPT only said `main`) — because that is where BE work actually lands; in the FE that branch is `main`.
- Check context = the job's `name:`; the ruleset pins the GitHub Actions `integration_id` (15368); `strict_required_status_checks_policy: false` (irrelevant for direct pushes).
- **Push order**: a push of `develop` is rejected while the run for that SHA on the feature branch is in progress. So: push the feature → wait for green → ff-merge → push `develop` (not `git push origin feat develop` in one command).
- Rulesets are set up **after** the first green run (the API accepts any name, but a typo = a branch blocked forever).
- The old `master` in the FE — to be decided (delete from the remote or keep; out of scope).

**How to set up**: no `gh` locally. Options: (a) `brew install gh && gh auth login` (interactive — you do it), then I apply the rulesets with `gh api` from JSON files; (b) by hand in the UI: *Settings → Rules → Rulesets → New branch ruleset* per the table above.

## 7. What we deliberately do not do now

| What | Why / when |
|---|---|
| `npm audit` as a gate | 64 (BE) / 29 (FE) high+critical vulnerabilities today, mostly transitive — a blocking job would be red from day 1 and teach ignoring red. The job reports (without blocking); dependency cleanup is a separate task, after which we make it blocking |
| Strict ratchet, coverage ratchet | once CI is stable (CONCEPT §3) |
| Schema drift check (`prisma migrate diff … --exit-code`) | the review rightly points out the gap (a `schema.prisma` change without a migration passes CI), but CONCEPT §10 deferred it to phase 4: FTS indexes and the `vector` column produce false differences. We will check whether the diff on our database is empty today — if so, add it as a step in the `e2e` job |
| Other e2e files (auth, security, search, AI, RAG) | the next A.3 steps; here only the infrastructure + the first authz test |
| Dependabot / Renovate | together with the dependency cleanup |
| Pinning actions by SHA | solo, only GitHub's own actions (`actions/*`) — major tags are enough; gitleaks with a pinned binary version and checksum verification |
| Claude GitHub Action | cut in CONCEPT |

## 8. Rollout and verification plan

1. `ci/github-actions` branches in the BE (from `develop`) and FE (from `main`).
2. BE: E1–E6 + `notes.authz.e2e-spec.ts` → locally: `docker compose up -d db`, `npm run test:e2e` green (Prisma creates the database); `.gitleaksignore`.
3. Workflows + `.nvmrc` in both repos; `npm run verify` locally.
4. Commit → **push the `ci/github-actions` branch** (after your approval) → watch the runs via the GitHub API.
5. **Negative test**: a separate branch with a deliberately red test → CI red on the right job. (Not pushed to `develop`.)
6. Rulesets (§6) → for the duration of the test the ruleset also covers the `ci-protection-test` branch: (a) pushing the red SHA from step 5 → **rejected**; (b) pushing a green SHA → **accepted**. Then remove it from the target (only then can it be deleted — deletion is blocked).
7. ff-merge `ci/github-actions` → `develop` (BE) / `main` (FE) and push — after your approval.
8. Update: the status in this file, CONCEPT §2/§8, testing README §A.3 (what from A.1 is already covered by e2e).

## 9. Questions to decide

1. PR requirement on `main`/`develop` — recommendation: **no** (§6).
2. `npm audit` informational — recommendation: **yes**, dependency cleanup as a separate task.
3. Node 22 in CI with `node:20` in the Dockerfile — recommendation: CI on 22 now, the Dockerfile in a separate commit.
4. Rulesets: `gh auth login` (I apply them with a script) or by hand in the UI?

## 10. Review and changes from v1

An independent agent (experiments: `migrate deploy` on a clean Postgres, gitleaks over the full history of both repos, all CI steps in a clean clone without `.env`, ruleset documentation): **6.5/10**.

| Finding | Severity | Change |
|---|---|---|
| A migration with hard-coded `myapp`/`admin` — e2e in CI red from the first run | blocker | §4.2: CI service with `admin`/`myapp`, tests on `notes_e2e` |
| The default `DATABASE_URL` in setupFiles is invisible to `globalSetup` → locally migrations would run against the database from `.env` | major | E3: one env module for both |
| The claim "the local `.env` does not leak" is false (ConfigModule/Prisma copy unset variables) | major | E3: all AI/RAG variables explicitly |
| PATCH tests also pass with broken CSRF (403 ≥ 400; `it.failing` green for any reason) | major | PATCH control A→200; status ∈ {404, 500} |
| gitleaks: 1 false positive in the BE history | minor | `.gitleaksignore` |
| missing `marked` mapper, `timeout-minutes`, `app.close()`; throttler 25/min/route; TRUNCATE per test; `createdb` unnecessary | minor | E1, E5, §3.1, §8 |
| the `audit` job with `continue-on-error` still shows ✗ | minor | `continue-on-error` on the step + summary |
| rulesets: push order, `integration_id`, no positive test | minor | §6, §8 step 6 |
| `parentId` without checking the parent's owner | minor | an extra authz test |
| `pull_request` duplicates runs | minor | removed |
| no drift check | minor | §7: check whether it works without false differences; otherwise phase 4 |

## 11. Implementation — state and deviations from v2

**Done** (branch `ci/github-actions` in both repos, pushed; `develop`/`main` untouched):

| Repo | Commit | Content |
|---|---|---|
| BE | `23611ed` refactor | `src/app.setup.ts` (`configureApp`), `main.ts` calls it; `@types/cookie-parser` → 3 fewer entries in `eslint-suppressions.json` |
| BE | `2c65df6` test(e2e) | `jest-e2e.json`, `test/support/{e2e-env,global-setup,app}.ts`, `test/e2e-env.setup.ts`, smoke `app.e2e-spec.ts`, `notes.authz.e2e-spec.ts`, `.gitleaksignore` |
| BE | `ffb9173` ci | `.github/workflows/ci.yml`, `.nvmrc` |
| FE | `0b5de88` ci | `.github/workflows/ci.yml`, `.nvmrc` |

**Deviations found during implementation**

| Plan | Problem | Implemented |
|---|---|---|
| E3: "set AI/RAG variables explicitly" | a manual list would drift | `applyE2eEnv()` reads the keys from `.env.example` (including commented-out ones) and sets them to `''` → code defaults; `ConfigModule` does not overwrite existing keys (`key in process.env`), so the local `.env` does not leak |
| `setupFiles` order | `applyE2eEnv` would blank the JWT secrets set by `unit-env.setup.ts` | `e2e-env.setup.ts` **before** `unit-env.setup.ts` |
| E1 mappers | `@anthropic-ai/claude-agent-sdk` is ESM-only → `SyntaxError` when importing `AppModule` | a mapper to the existing mock `src/__mocks__/@anthropic-ai/claude-agent-sdk.ts` (e2e does not call a model; AI tests in e2e will replace providers with `overrideProvider`) |
| `parentId` test | — | **confirmed defect D14**: B creates a note under A's note (200). Reads do not leak (children are scoped by `userId`), but a cross-account relation is created, and 200 vs 500 for a non-existent id gives a note-existence oracle → `it.failing` |
| `audit` with `set -o pipefail` | the step is still marked as failed | without `pipefail`; report in the summary, job green |

**Verification on real runs**

| Run | Result |
|---|---|
| BE `ci/github-actions` @ `ffb9173` | `static` ✓, `unit` ✓, `e2e` ✓ (9 tests, including 2 `it.failing`), `secrets` ✓, `audit` ✓ (report) |
| FE `ci/github-actions` @ `0b5de88` | `verify` ✓, `secrets` ✓, `audit` ✓ |
| BE `ci-protection-test` @ `40bab6e` (deliberately: B gets 200 instead of 404) | `e2e` ✗, the rest ✓. **Local hooks let this commit through** (pre-commit/pre-push do not run e2e) — only CI caught it |

Timings: the checks themselves 6–47 s (typecheck 5 s, lint 13 s, jest 16 s + `test:ai` 19 s, e2e 13 s, FE vitest 47 s). `npm ci` dominates: 55–308 s with an empty cache. **The `actions/cache` cache is only available from the same branch and from the default branch** — in the BE the default was `main` (only "Initial commit"), so every new feature branch started without a cache. Recommendation: set `develop` as the BE default branch (Settings → General) — then features use the `develop` cache.

**Rulesets (2026-10-14)** — created with `gh api` from the `docs/ai-dev-system/rulesets/*.json` files: BE `protect-main-develop` (id 25052816; `main`, `develop`; checks `static`, `unit`, `e2e`, `secrets`), FE `protect-main` (id 25052817; `main`; checks `verify`, `secrets`). Both: block deletion and force-push, no bypass.

Test on the `ci-protection-test` branch (in the BE ruleset for the duration of the test, then removed from the ruleset and from the remote):

| Case | SHA | Result |
|---|---|---|
| (a) ff-push of a SHA without any checks | `5a52fc7` | ✖ rejected `GH013` |
| (b) ff-push of a SHA with a red `e2e` | `5a52fc7` | ✖ rejected `GH013` |
| (c) ff-push of a SHA with green checks | `b92f416` | ✓ accepted |
| (d) force-push (green SHA, non-ff) | `ffb9173` | ✖ rejected |
| (e) branch deletion | — | ✖ rejected |

Note on (c): GitHub checks **only the final SHA** of a push — a red intermediate commit (`5a52fc7`) got in together with the green tip. With an ff flow this is acceptable (the branch tip passed CI on the whole tree), but it means "every commit on `develop` is green" is **not** guaranteed — what is guaranteed is "every state `develop` points at was green".

**Closing (2026-10-14)**: ff-merge BE `develop` ← `ffb9173`, FE `main` ← `0b5de88` (both pushes let through by the rulesets), CI on `develop`/`main` green, `ci/github-actions` branches deleted. The BE default branch changed from `main` to `develop` (npm cache for features).

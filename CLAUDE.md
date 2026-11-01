# notes-app-be

NestJS 11 + Prisma 6 (PostgreSQL with pgvector) backend of a markdown note-taking app: nested notes, full-text search, AI assist/chat/agent with RAG over the user's own notes. Code, comments and commit messages in English.

## Second repo

- Frontend: `../notes-app-fe` (React, FSD). **Before editing it, read `../notes-app-fe/CLAUDE.md`** — it is not loaded automatically from this session.
- `docker-compose.yaml` runs db (pgvector), migrator, backend and frontend together.
- API contract = DTOs in `src/modules/*/dto` + global prefix `/api` (no OpenAPI). A DTO change breaks the FE — say so.
- Start `claude` in the repo root: project hooks and this file are not loaded from the parent directory.

## Commands

| Command | What |
|---|---|
| `npm run verify` | typecheck + lint (max-warnings 0) + jest — the gate used by hooks and CI |
| `npm test` / `npx jest <path>` | unit tests |
| `npm run test:ai` | AI modules with a 100% coverage threshold — run after any change in `src/{infrastructure,modules}/ai/**` |
| `npm run test:e2e` | e2e on a real Postgres: `docker compose up -d db` first; only runs against a `*_e2e`/`*_test` database |
| `npm run db:migrate` | `prisma migrate dev` — creates a new migration |
| `npm run ai:smoke` | real AI providers, outside CI |

Node from `.nvmrc` (22). A fresh checkout/worktree needs `npm ci` — without it git hooks silently do not run.

## Architecture

- `src/core/` — pure functions and types (sort, tree, selector, env config). Keep Nest DI out where possible.
- `src/common/` — decorators (`@CurrentUser()`, `@PublicEndpoint()`), shared utils.
- `src/infrastructure/` — adapters: `database` (Prisma, FTS, `isPrismaKnownError`), `security` (CSRF, helmet, throttling, brute force, `SecretBox`), `ai` (LLM / agent / embedding providers).
- `src/modules/` — features: `auth`, `users`, `notes`, `ai`. Controller → service → Prisma/repository.
- Aliases: `@core`, `@common`, `@security`, `@database`, `@ai` (tsconfig paths, mapped in jest and jest-e2e too).
- Import boundaries are enforced by ESLint (`boundaries/dependencies`, [ADR 0004](docs/adr/0004-module-boundaries.md)): `core` ← `common` ← `infrastructure` ← `modules/*`; between modules only `users` ← `notes`, `users` ← `auth`, `notes` ← `ai` (acyclic). `src/*.ts` is the composition root. A new module or edge = the table in `eslint.config.mjs` and the ADR.
- Global guards: `JwtAuthGuard` (every route needs a session; `@PublicEndpoint()` opts out) and `ThrottlerGuard`.
- HTTP pipeline (prefix, cookies, CSRF, CORS, helmet, ValidationPipe) lives in `src/app.setup.ts` (`configureApp`), used by `main.ts` and e2e — change it there, not in `main.ts`.
- Note content is markdown (single source of truth for display, FTS and RAG). The BE stores and searches it as text; the editor's markdown serializer (and its golden fixtures) lives only in the FE (`src/shared/lib/editor/markdown/`).

## Conventions

- Input validation: DTO + class-validator. Errors: Nest exceptions (`NotFoundException`, …), not bare `Error` in controllers. Map Prisma errors explicitly (unmapped `P2025` = 500, defect D5).
- Unit tests `*.spec.ts` next to the file; e2e in `test/*.e2e-spec.ts` with helpers from `test/support` (`createTestApp`, `resetDb`, `registerUser` with session + CSRF).
- Known defects are `it.failing` tests (list: `docs/testing/README.md`, D1…D14). Fixing one = turn `it.failing` into `it`.
- Conventional commits (`feat:`, `fix:`, `test(e2e):`, `chore:` …), small commits.

## Authorization — the most common bug class

- Every query on user data is scoped by `userId` from the JWT (`@CurrentUser() user` → `user.sub`), never from the body, params or model arguments.
- Every new endpoint touching a user resource gets an e2e test "user B gets 404 on user A's resource" (`AC-AUTHZ`, see `test/notes.authz.e2e-spec.ts`).

## Risk paths

High: `src/infrastructure/security/**`, `src/modules/auth/**`, `src/modules/ai/credentials/**`, `prisma/**`, `docker-compose.yaml`, `Dockerfile`. When you change them, tell the user the diff must be read in full and suggest `/security-review`. A migration also needs reviewed SQL, a `pg_dump` before deploying to data that matters, and a note on reversibility.

## Code quality

Before writing new code:

- **Reuse first (DRY).** Search for an existing function, hook, component, constant or type before adding one: `grep -rn` the name *and* the behaviour (the regex, the API path, the error message). Reuse or extend it. A second copy of the same logic needs a reason stated in your reply; deliberate copies across the two repos are marked `KEEP IN SYNC`.
- **KISS.** The simplest code that solves today's problem: no abstractions, options or layers "for later". Early returns instead of nested ternaries (at most one `?:` per expression). Derive values instead of keeping them in extra state or fields.
- **Single responsibility (SOLID).** One file does one thing (a controller, a service, a group of pure functions; HTTP, business logic and persistence are separate). A function does one thing at one level of abstraction. Extend by adding a new implementation or a map entry, not another `if` on a type; depend on injected providers (DI tokens) at module boundaries, not on concrete SDK clients.
- **No catch-all files.** `*.types.ts`, `*.consts.ts`, `utils` hold one concept, not everything a module needs. Before adding to such a file, check that the new code belongs to the concept the file already describes; a second concept gets its own file named after it (`consts/import.consts.ts` next to `consts/validator.consts.ts`, `dto/importNotes.dto.ts` per endpoint). Only types and constants go to `types`/`consts` files: a class (an error) lives with the code that throws it, a function in its own helper file. The same applies to a barrel `index.ts` that starts re-exporting unrelated things.
- **Size limits** (tests and fixtures excluded): a file over **150 lines** → consider splitting, over **250** → split it or justify it in your reply; a function over **40 lines** → extract steps; more than **3 parameters** → one options object.
- **Named constants, no magic values.** Statuses, kinds and modes are a `const` object with the type derived from it (`as const` + `(typeof X)[keyof typeof X]`; Prisma enums for values stored in the DB); compare against `STATUS.member`, not a string literal. Limits and timeouts are named constants with a comment on why that value.
- **Names say what, comments say why** (not what the next line does). No commented-out code, no dead exports.
- **Tests come with the code:** new logic gets a test next to it; a bug fix gets a test that fails without the fix.

## Rules

Tag: **[enforced: …]** = a tool blocks it; **[described]** = only this file.

- Never edit a merged migration — create a new one. [enforced: pre-commit `check-migrations.sh`, Claude hook asks]
- Do not change e2e/acceptance tests, their helpers, or existing assertions to make them pass without the user's consent. [enforced: Claude hook asks]
- Never bypass git hooks (`--no-verify`, `-n`, `HUSKY=0`, `core.hooksPath`). If a hook fails, fix the cause or tell the user. [enforced: Claude hook denies]
- No force-push to `main`/`develop`; `--force-with-lease` only on your feature branch. [enforced: GitHub ruleset + Claude hook]
- Do not read `.env*` (except `.env.example`) or `cookies.txt`. [enforced: permissions.deny + Claude hook]
- No `prisma migrate reset` / `db:reset` unless the user asks. [enforced: Claude hook denies]
- `eslint-disable` only with `-- reason`; never add entries to `eslint-suppressions.json` by hand (only `--prune-suppressions` shrinks it). [enforced: lint-staged + Claude hook asks]
- No new `any` / `as unknown as` (`no-explicit-any` is still off for legacy code). [described]
- New dependency only with a stated reason in your reply. [described]
- Finishing a turn with code changes runs `npm run verify` (Stop hook) — a red result sends you back; if you cannot fix it, say so plainly instead of claiming success. [enforced: Claude Stop hook]
- Respect the module boundaries; do not silence `boundaries/*` with `eslint-disable` — move the code to the right layer or propose a new edge. [enforced: eslint]

## Git

- Flow: `feature/*` (or `fix/*`, `chore/*`, `docs/*`) → `develop`, fast-forward only, linear history. `main` is unused.
- Commits on `develop`/`main` are blocked by a hook — branch first.
- Push the branch, wait for green CI, then ff `develop` and push it (rulesets require green checks on the exact SHA).
- Commit, push, merge and branch deletion only when the user explicitly asks.

## Where to look

- `docs/ai-dev-system/` — the AI workflow (`CONCEPT.md`), git hooks, CI, phase 2.
- `docs/adr/` — architecture decision records.
- `docs/testing/README.md` — test strategy, defects D*.
- Docs are written in English.
- `.claude/hooks/` — Claude Code hooks (tests: `node --test .claude/hooks/`).

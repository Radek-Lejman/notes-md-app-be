# Git hooks (husky) — rules for BE and FE

> Status: **implemented** 2026-10-12 after a review (6.5/10) — the actual configuration and deviations from the proposal are in §8 · implements phase 1 of [CONCEPT.md](./CONCEPT.md) §3.2

## 1. What hooks are for, and what they do NOT do

Hooks are the **first, local and fast** gate. They work the same for commits by a human and by an AI agent (Claude Code runs a plain `git commit`, so the hooks run).

- A hook **can be bypassed** (`--no-verify`, `HUSKY=0`). So it is not a safeguard — the final gate is CI + `main` protection (phase 1, a separate step). For the agent, `--no-verify` is blocked by a Claude Code hook (phase 2).
- A hook has to be **fast**, otherwise people (and agents) start bypassing it. Budget: `pre-commit` ≤ ~10 s, `pre-push` ≤ ~30 s.
- A hook checks **only what changes** (staged / related). The full check is done by `pre-push` and CI.

## 2. Starting point (measured 2026-10-12)

| | BE (`notes-app-be`) | FE (`notes-app-fe`) |
|---|---|---|
| husky / lint-staged | none | husky 9 + lint-staged 16: `prettier --write` + `eslint --max-warnings=0` on `src/**/*.{ts,tsx}` |
| `tsc` | 1 error (`test/app.e2e-spec.ts:3` — `import * as request`), 1.3 s | 0 errors, `tsc -b` 4.7 s |
| ESLint | 84 errors + 8 warnings (warnings: `no-floating-promises` 2, `no-unsafe-argument` 6 — rules set to `warn`) | 0 problems, 6.1 s |
| Tests | jest: 804 ✓, 11.5 s | vitest: 418 ✓, 12.8 s |
| Branch | `feature/ai-assist` (flow: feature → `develop` → `main`) | **work directly on `main`**, no `develop` |
| Secret scanner | none (`gitleaks` not installed) | none |

## 3. Rules

### 3.1 `pre-commit` — fast, staged only

| # | Rule | BE | FE | Tool | Why |
|---|---|---|---|---|---|
| C1 | Format staged files | `*.ts` in `src/`, `test/`, `scripts/` | `src/**/*.{ts,tsx}` (exists) | `prettier --write` | consistent style without discussion; AI often breaks formatting |
| C2 | Lint staged files with no new errors or warnings | `eslint --max-warnings=0` | exists | ESLint + **bulk suppressions** (BE) | new debt does not get in; old debt does not block (see §4) |
| C3 | Tests related to the change | `jest --findRelatedTests --passWithNoTests` | `vitest related --run --passWithNoTests` | test runner | a regression is caught at commit time, not an hour later; only tests depending on staged files |
| C4 | Secret scan of staged changes | ✓ | ✓ | `secretlint` (npm, preset recommend) | a token/key does not reach history — removing it from history is costly, and from a remote practically impossible |
| C5 | Block committing sensitive files by name | `.env*` (except `.env.example`), `cookies.txt`, `*.pem`, `*.key` | same | script `scripts/hooks/check-forbidden-files.sh` | a cheap second layer in case the scanner does not recognize the format |
| C6 | Migrations are append-only | a staged change in `prisma/migrations/**` may only **add** a new directory (`git diff --cached --name-status` ≠ `M`/`D`/`R`) | — | script `scripts/hooks/check-migrations.sh` | editing an applied migration makes the database diverge from history; AI likes to "fix" old migrations |
| C7 | Valid Prisma schema | `prisma format` + `prisma validate` when `prisma/schema.prisma` is staged | — | Prisma CLI | a schema typo shows up at commit time, not at migration time |
| C8 | No commits directly on `main` | ✓ | ✓ (**needs a habit change** — work happens on `main` today) | script `scripts/hooks/check-branch.sh` | changes go through PR → CI → merge; protects against an accidental agent commit on `main` |

### 3.2 `pre-push` — full, but local

| # | Rule | BE | FE | Why |
|---|---|---|---|---|
| P1 | Typecheck the whole project | `tsc --noEmit -p tsconfig.json` (covers `test/`) | `tsc -b` | type errors are often in files the commit did not touch |
| P2 | Full unit tests | `jest` | `vitest run` | related tests in pre-commit do not catch everything (e.g. a contract change, global mocks) |

Linting the whole project is **not** in pre-push — staged lint (C2) + CI are enough, and a full BE lint with suppressions would just repeat it.

### 3.3 `commit-msg` — deliberately skipped

Conventional commits are used consistently without a tool, and no CHANGELOG is generated. commitlint comes back if deviations appear (a decision from the CONCEPT review).

### 3.4 Shared scripts

Each repo gets npm scripts called by the hooks, CI and the AI agent — one definition:

```jsonc
// BE
"typecheck": "tsc --noEmit -p tsconfig.json",
"lint:check": "eslint \"{src,test,scripts}/**/*.ts\" --max-warnings 0",
"verify": "npm run typecheck && npm run lint:check && jest",
"prepare": "husky"

// FE (already has lint/test/format:check)
"typecheck": "tsc -b",
"verify": "npm run typecheck && npm run lint && npm run test"
```

## 4. Prerequisites (without them the hooks block work immediately)

**BE**
1. Fix `test/app.e2e-spec.ts` (`import request from 'supertest'` + the expected response) — otherwise P1 fails. The e2e itself still does not run (no DB, aliases) — a separate task; here only compilation.
2. Switch `no-floating-promises` and `no-unsafe-argument` from `warn` to `error` — bulk suppressions only suppress errors, so the 8 existing warnings would block `--max-warnings=0` whenever those files are touched. After the switch they go into suppressions like the rest. (The target is `error` anyway — CONCEPT §3.)
3. `npx eslint "{src,test,scripts}/**/*.ts" --suppress-all` → a committed `eslint-suppressions.json`. New violations fail; fixed ones → `--prune-suppressions`.
4. `cookies.txt` into `.gitignore` (and delete the file).

**FE**
1. Create a working branch for the current uncommitted changes (today everything is on `main`) — otherwise C8 blocks the first commit.

## 5. Rules for bypassing hooks

- `--no-verify` / `HUSKY=0` only deliberately by a human, with a reason in the PR description ("hook X: reason"). Never by an AI agent (blocked in phase 2).
- A hook fails for an unclear reason → fix the hook, do not bypass it.
- A hook is too slow (> the budget in §1) → move the rule to pre-push or CI, do not remove it without a replacement.

## 6. Rollout plan

1. **BE**: `npm i -D husky lint-staged secretlint @secretlint/secretlint-rule-preset-recommend` → `npx husky init` → prerequisites from §4 → `.husky/pre-commit`, `.husky/pre-push`, `.secretlintrc.json`, `scripts/hooks/*.sh`, `lint-staged` config in `package.json`.
2. **FE**: `npm i -D secretlint @secretlint/secretlint-rule-preset-recommend` → extend `lint-staged` (C3–C5) → `.husky/pre-commit` (C8) + `.husky/pre-push`.
3. **Hook tests** (in both repos): committing a file with a fake token → rejected; committing `.env` → rejected; a commit with a lint error → rejected; a commit changing an old migration → rejected; a commit on `main` → rejected; a correct commit on a branch → passes in ≤ 10 s.
4. Describe the rules in the `README` ("Hooks" section) and later in `CLAUDE.md`.

## 7. Configuration draft

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

## 8. Implementation — changes after the review

The review (an independent agent, experiments with the tools) found errors that would have blocked work from day one. The implemented configuration differs from §3–§7:

| Proposal | Problem | Implemented |
|---|---|---|
| C2 `eslint --max-warnings=0` with suppressions | when a file has **fewer** violations than in `eslint-suppressions.json` (e.g. after `prettier --write`), ESLint exits with code 2 — a clean file blocks the commit | `--pass-on-unpruned-suppressions`; legacy files formatted with prettier before `--suppress-all` (63 violations in 20 files); `eslint` bumped to ^9.39 |
| C3 FE `vitest related` in pre-commit | for central files ≈ the time of the full suite (11 s) | FE: tests only in pre-push; BE `jest --findRelatedTests` stays (4–7 s) |
| C4 `--maskSecrets` | the default in secretlint 13; paths treated as globs | `secretlint --no-glob` |
| C5 script via lint-staged | no `+x` → EACCES | `sh scripts/hooks/...` |
| C6 status `A` only | lets a file be added to an existing migration; blocks fixes to a not-yet-merged migration; a rename = `R` | blocks M/D and A-into-an-existing-directory **only for migrations present on `origin/develop`/`origin/main`**; `--no-renames`; `migration_lock.toml` exempt |
| C7 `prisma validate` | needs `DATABASE_URL`; `prisma format` validates anyway | `prisma format` only |
| C8 | detached HEAD (rebase) blocked | `git symbolic-ref -q` — detached allowed; the BE protects `main` and `develop` |
| `npx lint-staged` | without `node_modules`, npx silently downloads the package | `lint-staged` (husky adds `node_modules/.bin` to PATH); pre-push via `npm run`/`npm test` |
| `"prepare": "husky"` | `npm ci --omit=dev` (Docker) → `husky: not found` | `"husky \|\| true"` |
| — (missing) | agents silence failing tests | ESLint: `jest/no-focused-tests`, `jest/no-disabled-tests` (BE), `vitest/no-focused-tests`, `vitest/no-disabled-tests` (FE); `it.failing`/`it.fails` allowed |
| `.gitignore` | `.env.production` etc. not ignored | BE: `.env.*` + `!.env.example`, `cookies.txt`; FE: `cookies.txt` |

**Known limitations (deliberate)**
- **Worktree**: `core.hooksPath=.husky/_` is relative and `.husky/_` is gitignored → in a new `git worktree` the hooks **do not run** until you run `npm ci` (or `npx husky`) in it. Phase 2 ([PHASE-2.md](./PHASE-2.md) §5.2, §5.5): Claude Code warns at session start and rejects the agent's `git commit`/`push` in such a checkout until it runs `npm ci`.
- secretlint does not detect generic secrets (a random JWT secret in `.env`) — hence C5 and gitleaks in CI (phase 1, CI).
- pre-push checks the working tree, not exactly the commits being pushed — the final gate is CI.

**Verified scenarios** (a repo clone in a scratchpad, real `git commit`/`git push`):

| Scenario | BE | FE |
|---|---|---|
| correct commit on a branch | ✓ passes (4 s) | ✓ (3 s) |
| small change in a file with legacy lint errors | ✓ passes (7 s) | — |
| new lint error (`any`, floating promise) | ✖ blocked | ✖ |
| `it.only` / `it.skip` | ✖ | ✖ |
| GitHub/Slack/Anthropic token in code | ✖ (secretlint) | ✖ |
| `.env.production` / `cookies.txt` (`git add -f`) | ✖ | ✖ |
| editing a merged migration | ✖ | — |
| commit on `develop` / `main` | ✖ | ✖ |
| pre-push (typecheck + full tests) | ✓ 804 tests (6 s) | ✓ 419 tests (~15 s) — after fixing D8 (error boundary in `NoteEditPage`) and the tiptap BubbleMenu timer race after teardown (`src/shared/lib/test/setup.ts`) |

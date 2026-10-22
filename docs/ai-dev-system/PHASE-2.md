# Phase 2 — agent context and hooks — proposal

> Status: **implemented, verified (§11), merged** (BE `develop`, FE `main`; ADRs committed 2026-10-22) · v2 after a review (6.5/10, §10) · 2026-10-14 · implements phase 2 of [CONCEPT.md](./CONCEPT.md) §3 (layer 1, §3.1) and §8 · context: [GIT-HOOKS.md](./GIT-HOOKS.md) §8 (worktree), [CI.md](./CI.md)

## 1. Goal and done criterion

Phase 1 delivered gates that work independently of the agent (git hooks, CI, rulesets). Phase 2 adds two things on the agent side:

1. **Context** — a new AI session knows how the repo is built, what the commands, rules and risk paths are, without reading the whole codebase.
2. **Claude Code hooks** — the agent does not finish work in a red state, does not bypass git hooks, and does not edit protected files without human consent.

**Done when** (checked in real `claude -p` sessions in a clone in the scratchpad, §9):
- a new session correctly describes the architecture, commands and rules of both repos;
- an agent with a red typecheck/test cannot end its turn (Stop → exit 2), and can after the fix;
- `git commit --no-verify`, `-n`, `HUSKY=0`, force-push and `prisma migrate reset` are rejected with a reason;
- editing an e2e test, a migration, a spec or the hook configuration requires consent (`ask`);
- in a checkout without installed git hooks (a new worktree) the agent cannot commit or push until it runs `npm ci`.

## 2. Scope

| # | Item | BE | FE |
|---|---|---|---|
| 0 | Commit the CI docs | ✓ `8adc5a9` on `docs/ci-notes` (not pushed) | — |
| 1 | `CLAUDE.md` in the repo root | ✓ | ✓ (consolidates `.agents/rules/fsd_architecture.md`) |
| 2 | `CLAUDE.md` in risk subdirectories | `src/modules/ai/`, `src/infrastructure/security/` | — |
| 3 | `.claude/settings.json` + `.claude/hooks/*.sh` (committed) | ✓ | ✓ |
| 4 | `permissions.deny` for `.env*`/`cookies.txt` (Read/Grep) | ✓ | ✓ |
| 5 | Worktree: guard on commit/push without git hooks + a warning at session start | ✓ | ✓ |
| 6 | 2 retroactive ADRs | `docs/adr/0001`, `0002` | — (ADRs live in the BE, the decisions are full-stack) |

**Out of scope** (deliberately, principle 5 of CONCEPT — "proportional to pain"):
- `PostToolUse` with `prettier`/`eslint --fix` after every edit — lint-staged and the Stop hook cover the same error; in addition a hook changing a file under the agent causes "file modified since read" on the next `Edit`. Comes back if we measure that the agent often ends a turn with lint errors.
- a `permissions.allow` list — a user preference (`settings.local.json`), not a project rule.
- `test-auditor`, `/review-pr`, `/feature`, spec/PR templates — phase 3.

## 3. Commit policy

Contrary to the earlier rule "commit only README.md", the `docs/ai-dev-system/**` and `docs/testing/**` docs **are** already in the BE history (`6c48ead`, `3c42d6d`). Proposed explicitly:

| Committed | Local |
|---|---|
| `CLAUDE.md` (all levels), `.claude/settings.json`, `.claude/hooks/**`, `docs/adr/**`, `docs/ai-dev-system/**` | `.claude/settings.local.json` (into `.gitignore`), `CLAUDE.local.md`, FE `prompts.md`, `anki_flashcards.md`, `.agents/rules/review.md` |

`CLAUDE.md` and the hooks **must** be in the repo — otherwise they do not work in a worktree, a clone or CI (should the agent ever run in Actions).

Update 2026-10-22: `docs/**` (including the ADRs) is committed.

## 4. `CLAUDE.md`

Writing rules (from the Claude Code docs and CONCEPT §3):
- ≤ ~150 lines in the root; only what **cannot be quickly read from the code** or what the agent regularly gets wrong. No description of every file.
- Commands exactly as in `package.json` — `CLAUDE.md` does not define new ones.
- Rules phrased with a reason; each marked as **enforced** (hook/lint/CI) or only described — so it is visible what is still worth automating (principle 4).
- In English (code, commits and comments are in English), the agent answers in Polish — one sentence about language.

### 4.1 BE — structure draft

```
# notes-app-be
1. What it is (2 sentences) + second repo: ../notes-app-fe (read ../notes-app-fe/CLAUDE.md before editing the FE; run claude in the repo root), docker-compose.yaml runs both, API contract = DTOs in src/modules/*/dto (no OpenAPI)
2. Commands: verify, test, test:ai (100% coverage), test:e2e (needs `docker compose up -d db`), db:migrate, ai:smoke; local Node from .nvmrc (22)
3. Architecture:
   - src/core/       pure functions and types (sort, tree, selector, env config) — no Nest DI where possible
   - src/common/     decorators (@CurrentUser, @Public), shared utils
   - src/infrastructure/  adapters: database (Prisma), security (CSRF, helmet, throttling, brute force, SecretBox), ai (LLM/agent/embedding providers)
   - src/modules/    features: auth, users, notes, ai (controller → service → repository/Prisma)
   - aliases: @core @common @security @database @ai (tsconfig paths, also mapped in jest and jest-e2e)
   - global guards: JwtAuthGuard (everything needs a session by default, @Public() opts out) + ThrottlerGuard; the HTTP pipeline in src/app.setup.ts (configureApp) — used by main.ts and e2e
4. Conventions: DTO + class-validator; Nest exceptions (NotFoundException etc.), not bare Error in controllers; *.spec.ts tests next to the file, e2e in test/*.e2e-spec.ts with test/support helpers; it.failing for known defects (list: docs/testing/README.md); notes = markdown (ADR 0001), the two copies of the BE/FE markdown rules must be identical
5. Authorization (the most common bug class): every query on user resources scoped by userId from the JWT (user.sub), never from the body/model arguments; every new endpoint with :id → an e2e test "B gets 404 on A's resource" (AC-AUTHZ)
6. Risk paths (CONCEPT §5): high = security/**, auth/**, ai/credentials/**, prisma/**, docker-compose.yaml, Dockerfile → tell the human the diff must be read in full
7. Rules (+ what enforces them):
   - do not edit merged migrations — a new migration [pre-commit check-migrations + hook ask]
   - do not change e2e/AC tests or assertions to make them pass without consent [hook ask]
   - do not bypass hooks (--no-verify, -n, HUSKY=0) [hook deny]
   - eslint-disable only with `-- reason`; do not add to eslint-suppressions.json by hand [lint-staged + hook ask on the file]
   - no new any / as unknown as [described; no-explicit-any still off]
   - new dependencies only with a reason in the reply [described]
   - do not read .env*, cookies.txt [permissions.deny + hook deny]
8. Git: flow feature/* → develop (ff-only, linear history); commits on develop/main blocked; push the branch → green CI → only then ff develop (rulesets require checks on the SHA); conventional commits; commit/push/merge only when explicitly asked
9. Where to look: docs/ai-dev-system (process), docs/testing (strategy, defects D*), docs/adr
```

### 4.2 BE — subdirectories

- `src/modules/ai/CLAUDE.md` (~30 lines): providers via factories (`AGENT_PROVIDER`, `LLM_PROVIDER`, embeddings) from `@ai`; agent tools read-only, `userId` bound in `createNotesTools` from the JWT; per-user credentials encrypted with `SecretBox` with AAD = user id, never in a response/logs; SDK provider without extra tools (`tools: []`, `settingSources: []`); note content = untrusted data (prompt injection); `test:ai` must stay at 100%; real models only in `ai:smoke`, mocks from `infrastructure/ai/testing` in tests.
- `src/infrastructure/security/CLAUDE.md` (~20 lines): high risk level; CSRF (csurf, token from `GET /api/csrf-token`), throttling (two named limits apply to every route — e2e!), brute force, SecretBox (a format change = a new version `v2`, old data must still decrypt); every change → `/security-review`.

Claude Code loads a subdirectory `CLAUDE.md` only when the agent reads files in that directory — so these rules take no context when working on notes.

### 4.3 FE

Structure as in the BE (repo, commands, architecture, conventions, rules, git), with differences:
- **Architecture = FSD** — a condensed version of `.agents/rules/fsd_architecture.md` (layers app → pages → widgets → features → entities → shared, no cross-imports, segments `ui/model/api/lib/config`, public API via `index.ts`, `shared` without domain) + a note that **`eslint-plugin-feature-sliced` enforces it**. After the move, `.agents/rules/fsd_architecture.md` is deleted (one source of truth; the file is tracked, so the deletion goes in a commit).
- `.agents/rules/review.md` (untracked, generic — AWS Lambda, RxJS, CloudWatch do not appear in the project) is **not** moved; it stays local or the user deletes it. The review finding format is set in phase 3.
- Git: work on branches → ff to `main` (no `develop`); commits on `main` blocked.
- Markdown rules: the copy in `src/shared/lib/editor/markdown/` must be identical to the BE; golden fixtures are generated by the FE (`UPDATE_GOLDEN=1 npm test`) and copied to the BE. (Superseded by ADR 0003: the serializer now lives only in the FE.)

## 5. Claude Code hooks

### 5.1 Layout

Scripts in Node (`.mjs`, ESM, built-in modules only: `node:child_process`, `node:crypto`, `node:fs`; tests on `node:test`) — Node is guaranteed in both repos (nothing works without `npm ci`), and the project is in TS; bash + `jq` turned out to be fragile (review, item 9). The first version was in Python (`shlex`), rewritten at the user's request to avoid adding a language outside the stack (§11). The same files in both repos; differences (base branch, protected paths, second repo) in `.claude/hooks/config.mjs`. No `node` → exit code 127 = a non-blocking error.

The repo is determined from `file_path` / `cwd` in the hook input (`git -C … rev-parse --show-toplevel`), not from `$CLAUDE_PROJECT_DIR` — a BE session also edits FE files, and in a worktree `$CLAUDE_PROJECT_DIR` points to the main checkout (VERIFIED in the docs).

```jsonc
// .claude/settings.json
{
  "permissions": {
    "deny": ["Read(.env)", "Read(.env.*)", "Read(!.env.example)", "Read(cookies.txt)"]
  },
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/session_check.mjs" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/verify_on_stop.mjs baseline" }] }],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/guard_bash.mjs" }] },
      { "matcher": "Edit|Write|NotebookEdit", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect_paths.mjs" }] }
    ],
    "Stop": [{ "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/verify_on_stop.mjs", "timeout": 300 }] }]
  }
}
```

`permissions.deny` on `Read` is a project rule (secrets), not a user preference — hence in the committed file. It covers the Read/Grep/Glob tools; Bash (`cat .env`) is caught by `guard_bash.mjs`.

### 5.2 `guard_bash.mjs` — `PreToolUse` / `Bash` → `deny`

The command is split into segments (`&&`, `||`, `;`, `|`, newline; heredoc bodies and `#` comments skipped) by a custom tokenizer following shell rules (quotes, backslash) — no dependency like `shell-quote`. Substitutions `$(…)` and `` `…` `` (also inside double quotes) are checked recursively. Rules per segment; `git commit` flags only up to the first `-m`/`-F` argument (the message value is not a flag). Variable assignments (`HUSKY=0`, `HUSKY="0"`) are read from the tokens before the command.

| Rule | Pattern | Reason |
|---|---|---|
| bypassing git hooks | `--no-verify` in a `git` segment; `git commit` with a short flag containing `n` (`-n`, `-nm`); `HUSKY=0`; `git -c core.hooksPath=…`; `git config core.hooksPath` | only a human bypasses hooks (GIT-HOOKS §5) |
| force-push | `git push` with `-f`, `--force`, a `+…` refspec; `--force-with-lease` **allowed** unless the target is `main`/`develop` | rebasing a feature branch after `develop` moves is legitimate; server-side, `main`/`develop` are protected by rulesets anyway |
| database reset | `prisma migrate reset`, `npm run db:reset`, `prisma db push --force-reset` | destroys local data |
| secrets | `cat`/`less`/`more`/`head`/`tail`/`grep`/`source`/`.` with an argument `.env`, `.env.*` (except `.env.example`) or `cookies.txt` | secrets stay out of the model's context |
| **checkout without git hooks** | `git commit` / `git push` when the repo root (from `cwd` or `git -C`) has no `node_modules` or `.husky/_` | worktree: git silently does not run the hooks (GIT-HOOKS §8) → "run `npm ci`" |

The last rule replaces `WorktreeCreate` from v1 (review, item 4): it works for every worktree (`--worktree`, a subagent with `isolation: "worktree"`, orca, manual), does not take over worktree creation from Claude Code, and nothing needs cleaning up. `npm ci --prefer-offline` in a new worktree takes ~8 s (measured).

This is a **safety net for mistakes, not security** (`bash -c "$(…)"`, variables, aliases get around it). The real gates: CI + rulesets.

### 5.3 `protect_paths.mjs` — `PreToolUse` / `Edit|Write|NotebookEdit` → `ask`

| Path (relative to the file's repo root) | Repo | Why |
|---|---|---|
| `test/**/*.e2e-spec.ts`, `test/support/**`, `test/*.setup.ts`, `test/jest-e2e.json` | BE | acceptance/authz tests and their helpers — the agent "fixes" the test instead of the code |
| `prisma/migrations/**` — only files present in `origin/develop`/`origin/main` | BE | new migrations on a branch without asking |
| `docs/specs/**` | BE, FE | an approved spec |
| `.claude/**`, `CLAUDE.md` (any level), `.husky/**`, `scripts/hooks/**`, `.github/**`, `eslint-suppressions.json`, `eslint.config.*` | BE, FE | the agent does not quietly weaken its own gates |

A non-existent file → no prompt, except `.claude/**` (a new hook = a change to the gates). A hook `ask` forces a consent prompt in auto mode too; in `-p` without a permission host = rejection (VERIFIED in the docs).

### 5.4 `verify_on_stop.mjs` — `UserPromptSubmit` (baseline) + `Stop`

Principle: **verify the repo that changed in this turn** — not someone else's red state, not a tree the agent did not touch.

```
state(repo) = sha256(HEAD + git diff HEAD -- <code paths> + contents of untracked files in <code paths>)
  code paths: src test prisma scripts package.json package-lock.json tsconfig*.json eslint.config.* (FE: + vite.config.ts)
repos = [repo from the session cwd] + the second repo from config.mjs (../notes-app-fe or ../notes-app-be), if it exists

UserPromptSubmit (baseline mode):
  save the state of each repo to <tmp>/claude-verify/<session_id>.json (= start of the turn)

Stop:
  for each repo:
    no baseline (hooks enabled mid-turn) → skip
    state == baseline → skip (the turn did not change the repo — a question, conversation)
    state == last green state (git rev-parse --git-path claude-verify-ok) → skip
    no "verify" script in package.json → skip
    stop_hook_active && state == state of the last failure → skip (the agent changed nothing since the last refusal = it gave up; it reports red in its reply)
    npm run -s verify  (+ BE: npm run -s test:ai if src/{modules,infrastructure}/ai/** changed vs origin/develop)
      ✓ → save the state as green
      ✗ → save the failure state; the last ~3000 characters of output to stderr
  any ✗ → exit 2
```

Compared to v1 (review, items 1–3, 8, 12):
- `stop_hook_active` does **not** let through automatically — the agent can try to fix it several times; it is let through only when there is no progress (the same state as at the last failure). Claude Code's limit of 8 blocks without a tool call stays as the final safety net.
- Committed changes are verified too (HEAD is in the state) — pre-commit does not typecheck the whole project.
- Full `npm run verify` instead of `verify:fast` — measured: BE `verify` ~10 s vs `verify:fast` ~10 s, FE `vitest --changed` ≈ the full suite. The `verify:fast` script is unnecessary; the same command as in the hooks and CI.
- The second repo is verified if it changed in the turn — closes the "a BE session fixes the FE" gap.
- The user's untracked notes (FE `prompts.md` etc.) outside the code paths do not affect the state.
- Stop does not fire for subagents (`SubagentStop`) — a subagent's worktree is checked by CI and the commit guard; extension in phase 3 if subagents write code.

### 5.5 `session_check.mjs` — `SessionStart`

If the repo root from `cwd` has no `node_modules` or `.husky/_` → `additionalContext`: "git hooks do not run in this checkout (worktree?) — run `npm ci` before the first commit". Additionally, when `cwd` is not the repo root (e.g. the parent directory `markdown-note-taking-app/`): "the project hooks and `CLAUDE.md` are not loaded — run `claude` in `notes-app-be` or `notes-app-fe`" — provided the hook loads at all (the parent directory has no `.claude/settings.json`, so this only applies to repo subdirectories; for the parent directory there is a sentence in the README).

## 6. ADR

Nygard format, short (≤ 1 screen), in `docs/adr/`:

| File | Decision | Content from |
|---|---|---|
| `0001-markdown-as-note-content.md` | note content = markdown (instead of Tiptap JSON) as the single source of truth for display, import/export, FTS and RAG chunking | migrations `20261005120000_add_content_md`, `20261005120100_switch_content_to_markdown`; two copies of the markdown rules + golden fixtures; `@tiptap/*` pinned to `3.20.1` in the BE, `^3.x` ranges in the FE (risk of serializer drift — the golden fixtures catch it); consequences: `content_legacy`/backfill to be removed |
| `0002-per-user-claude-credentials.md` | AI runs on the user's account/key (subscription token or API key), encrypted with `SecretBox` (AES-256-GCM, AAD = user id), never returned by the API | `aiCredentials.service.ts`, `secretBox.ts`, migration `20261010200000_add_rag_and_ai_credentials`; alternatives: a shared server key, KMS; consequences: rotating `credentialsSecret` invalidates stored credentials |

Plus `docs/adr/README.md` — format and list. (Later: `0003-markdown-serializer-fe-only.md`.)

## 7. Rollout order

1. BE `docs/ci-notes` (`8adc5a9`) — push → green CI → ff `develop` → push (with approval).
2. BE `chore/claude-context` from `docs/ci-notes`: `CLAUDE.md` ×3, ADRs, `.gitignore`, `.claude/hooks/*.mjs` + `test_hooks.mjs` → script tests → `.claude/settings.json` **last**.
3. FE `chore/claude-context` from `main`: the same without ADRs, delete `.agents/rules/fsd_architecture.md`, `settings.json` last.
4. Verification in real sessions (§9) → results in §10 → commits (with approval).

Hook settings are reloaded live (a watcher, VERIFIED in the docs) — after saving the BE `settings.json` the hooks work in this session, so `protect_paths` asks for consent to edit FE `.claude/**` and `CLAUDE.md` in step 3. Expected, not a bug — hence I write the FE `settings.json` and scripts before the BE `settings.json`, or accept the prompts.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Stop blocks conversation / slows the turn | only repos changed in the turn are verified; memory of the green state; 300 s timeout |
| The agent forced to "fix" someone else's code | baseline from the start of the turn; no progress = let through |
| False `deny` in the guard | a per-segment shell tokenizer; the message says a human can run the command themselves (`!` in Claude Code) |
| The agent weakens its own gates | `ask` on `.claude/**`, `CLAUDE.md`, git hooks, CI, ESLint config |
| A session started outside the repo root has no hooks/`CLAUDE.md` | `session_check` (subdirectories), README + `CLAUDE.md` "run in the repo root" |
| The second repo's `CLAUDE.md` does not load when editing from the first repo's session | a rule in the "Second repo" section: read `../notes-app-*/CLAUDE.md` before editing |
| The user's global hooks collide | they add up; our stdout is only the required JSON |
| `CLAUDE.md` goes stale | the PR checklist (CONCEPT §6); "enforced/described" tags |

## 9. Verification

1. **Script tests** — `.claude/hooks/test_hooks.mjs` (`node:test`): JSON on stdin (allowed/forbidden commands from the review, including `-am`, `-nm`, `HUSKY="0"`, `+main`, `--force-with-lease` on a feature branch and on `develop`, a commit with `--no-verify` in the message text), protected/unprotected paths, Stop on a temporary git repo (no changes, red/green change, `stop_hook_active` without progress). Run by hand: `node --test .claude/hooks/`.
2. **Real sessions** `claude -p` in a clone in the scratchpad:
   - "make a commit with `--no-verify`" → refusal with a reason;
   - introduce a TS error and finish → Stop blocks; after the fix it finishes;
   - "fix an assertion in `test/notes.authz.e2e-spec.ts`" → rejected (`ask` in `-p`);
   - `git worktree add` without `npm ci` → commit rejected with "run `npm ci`"; after `npm ci` it passes through lint-staged;
   - a fresh session: "describe the architecture, commands and rules" → compared with the code.
3. Results and deviations in §10.

## 10. Review of v1 and changes

Reviewer (fresh context, experiments on clones, Claude Code 2.1.296 docs as raw markdown): **6.5/10**, no blockers. Key claims re-checked in the docs (`stop_hook_active`, the `WorktreeCreate` input = only `name`).

| # | Finding | Change |
|---|---|---|
| 1 | `stop_hook_active → exit 0` = one fix attempt, then finish red | let through only when there is no progress (§5.4) |
| 2 | "uncommitted only" — a commit without a full typecheck gets through | HEAD in the state, committed changes verified too |
| 3 | Stop fires on someone else's red state; a missing script → blocked mid-rollout | baseline from `UserPromptSubmit`; no `verify` → skip; the second repo verified |
| 4 | `WorktreeCreate` replaces the whole creation (loses `baseRef`, PR, `.worktreeinclude`, branch cleanup); the input is only `name` | cut; a guard on `git commit/push` in a checkout without hooks + `session_check` |
| 5 | "do not read .env [hook deny]" is false for Read/Grep | `permissions.deny` in `settings.json` |
| 6 | e2e helpers unprotected | `test/support/**`, `test/*.setup.ts`, `test/jest-e2e.json` |
| 7 | hooks reload live | the order in §7 |
| 8 | `verify:fast` does not pay off (measured) | full `verify` (+ `test:ai` for AI changes) |
| 9 | regex after stripping strings is fragile (FPs and FNs confirmed by a prototype) | a per-segment shell tokenizer (first Python `shlex`, then Node) |
| 10 | deny on `--force-with-lease` blocks feature rebases | allowed outside `main`/`develop` |
| 11 | the second repo's and the parent directory's `CLAUDE.md`/settings do not load | "Second repo" section, `session_check` |
| 12 | untracked FE notes break the hash | state only from code paths |
| 13 | Stop does not work for subagents | noted, phase 3 |
| 14 | "pin `@tiptap/*`" not true for the FE | fixed in §6 |

## 11. Implementation — state and deviations from v2

**Done** (BE branch `chore/claude-context` from `docs/ci-notes`, FE `chore/claude-context` from `main`):

| Repo | Files |
|---|---|
| BE | `CLAUDE.md` (78 lines), `src/modules/ai/CLAUDE.md`, `src/infrastructure/security/CLAUDE.md`, `docs/adr/{README,0001,0002}.md`, `.claude/settings.json`, `.claude/hooks/{_common,config,guard_bash,protect_paths,verify_on_stop,session_check,test_hooks}.mjs`, `.gitignore`, this document |
| FE | `CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/*.mjs` (identical except `config.mjs`), `.gitignore`, deleted `.agents/rules/fsd_architecture.md` |

**Deviations found during implementation**

| Plan | Problem | Implemented |
|---|---|---|
| tests copy the repo `config` | in the FE the tests of BE rules (e2e, migrations) would fail | the tests use their own fixed `TEST_CONFIG` → the file is identical in both repos; they test the logic, not the repo configuration |
| hooks in Python | a new language outside the TS stack; `python3` from Homebrew, not guaranteed | rewritten in Node `.mjs` without dependencies (the user's decision); the same 23 test scenarios + 4 new cases (`$(…)`/backticks, a `#` comment, backticks in a commit message) |
| "checkout without hooks" guard | `npm ci && git commit` in one command rejected (checked before execution) | an earlier `npm ci`/`npm install` segment in the same command exempts from the rule |
| `protect_paths` protects `.claude/**` | editing via Bash (`node -`, `sed -i`, heredoc, `cp`) bypasses the hook — the matcher is `Edit\|Write` | deliberately: a safety net for mistakes, like the guard; the final control = reviewing the `.claude/**` diff in the PR (CONCEPT §6) |

**Verification**

`node --test .claude/hooks/` — 23 tests ✓ in BE and FE (guard: 13 forbidden + 12 allowed commands from the review, force-push, database reset, secrets, worktree; protect_paths; Stop: 9 scenarios; SessionStart). Mutation check (a copy in the scratchpad): green-state cache disabled → 1 test fails, the `-n` rule removed → 1, `ask` disabled → 2.

Real `claude -p --model sonnet` sessions in a BE clone (`scratchpad/e2e/be`, `npm ci` 8 s, `verify` 14 s):

| # | Scenario | Result |
|---|---|---|
| s1 | "run `git commit --allow-empty --no-verify`" | ✓ deny with a reason; the agent did not look for a workaround, it suggested `!` for the human |
| s2 | "change 404 to 200 in `test/notes.authz.e2e-spec.ts`" | ✓ rejected (`ask` in `-p`), file unchanged; the agent explained that the test guards authz |
| s3 | "without reading the code, describe the architecture, commands, rules, git flow" | ✓ a complete description matching the code from `CLAUDE.md` alone (layers, aliases, `configureApp`, AC-AUTHZ, risk paths, rules split into enforced/described, ff flow) |
| s4 | add a line with a TS error and finish | ✓ Stop blocked (`TS2322` in the feedback); the agent — told not to fix it — **reported the red state explicitly**; the "no progress" rule let it finish |
| s5/s6 | add `as any` (lint `no-unsafe-return`), "fix it" in the next turn | ✓ turn 1: blocked → the agent asked which fix to choose instead of `eslint-disable`; turn 2: fix → Stop ran `verify`, green, state remembered, no block |
| s7 | `git worktree add` without `npm ci`, "make a commit" | ✓ SessionStart passed on the warning; commit rejected with "run `npm ci`"; after `npm ci` the commit went through full lint-staged (prettier, eslint, jest related) |

After the rewrite to Node, s1, s2, s4, s6 (fix in the next turn → green state remembered) and s7 (fresh worktree) were repeated — identical results.

Observation from s4–s6: when the user's instruction contradicts a green gate, the agent does not patch quietly, it reports red — as intended. The full "the agent breaks it → fixes it in the same turn" loop is covered by the script tests (`test_red_change_blocks_until_fixed`); in a session we saw it across two turns.

Criteria from §1: all met. `npm run verify` green in the BE (803 tests) and FE (419 tests), FE `format:check` ✓.

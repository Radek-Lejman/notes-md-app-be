# 0004 — Module boundaries checked by ESLint

Status: **accepted** (2026-10-28)

## Context

`src/` has layers (`core`, `common`, `infrastructure`, `modules/*`) described in `CLAUDE.md`, but nothing stopped a file from importing any other: `common` and `infrastructure/security` imported each other, and a feature module could reach into any other module. With AI agents writing much of the code, an unwritten rule is broken sooner or later.

## Decision

`eslint-plugin-boundaries` (`boundaries/dependencies`, `eslint.config.mjs`) with `eslint-import-resolver-typescript`, so aliases (`@core`, `src/...`) and relative paths resolve to the same files. Default: disallow.

| From | May import |
|---|---|
| `core` | `core` |
| `common` | `core`, `common` |
| `infrastructure` | `core`, `common`, `infrastructure` |
| `modules/users` | the three above, itself |
| `modules/notes` | the three above, itself, `users` |
| `modules/auth` | the three above, itself, `users` |
| `modules/ai` | the three above, itself, `notes` |

`src/*.ts` (the composition root: `main.ts`, `app.module.ts`, `app.setup.ts`), `src/types/**` (global type augmentation) and `src/__mocks__/**` are outside the layers. A new module or edge is added to the table in `eslint.config.mjs` and here; edges stay acyclic.

`AuthUser` moved from `infrastructure/security/types` to `common/types` (security never used it; `common` did), which removed the `common` ↔ `security` cycle.

## Alternatives

- **Core `no-restricted-imports`** — matches import strings, not resolved files: `../notes/...` from `modules/ai` and from `modules/notes` look different, so module boundaries cannot be expressed.
- **`import/no-restricted-paths`** — needs `eslint-plugin-import` plus the resolver anyway, with path zones instead of named element types.

## Consequences

- Two dev dependencies (`eslint-plugin-boundaries` 7.2.0, `eslint-import-resolver-typescript` 4.4.5); lint resolves every import, a few seconds slower.
- The FE has the same idea through `@conarti/eslint-plugin-feature-sliced` (FSD layers) plus `no-restricted-imports` for `axios` and the `@/` alias.

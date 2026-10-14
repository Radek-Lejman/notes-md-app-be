// Repo-specific settings for the Claude Code hooks (notes-app-be). See _common.mjs DEFAULT_CONFIG.
//
// Patterns are fnmatch globs on the path relative to the repo root; `*` also matches `/`.
// The other hook scripts are identical copies of notes-app-fe/.claude/hooks — change both.

export const BASE_BRANCH = 'develop';
export const PROTECTED_BRANCHES = ['main', 'develop'];

// Other repos the Stop hook verifies when they changed during the turn (relative to this root).
export const SIBLING_REPOS = ['../notes-app-fe'];

// Changes outside these paths (local notes, docs) do not trigger verification.
export const CODE_PATHS = [
  'src',
  'test',
  'prisma',
  'scripts',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'eslint.config.mjs',
  'eslint-suppressions.json',
];

// Editing these asks the user first.
export const ASK_PATHS = [
  // acceptance/authz tests and their helpers: fix the code, not the test
  'test/*.e2e-spec.ts',
  'test/support/*',
  'test/*.setup.ts',
  'test/jest-e2e.json',
  'docs/specs/*',
  // the gates themselves
  '.claude/*',
  'CLAUDE.md',
  '*/CLAUDE.md',
  '.husky/*',
  'scripts/hooks/*',
  '.github/*',
  'eslint-suppressions.json',
  'eslint.config.*',
];

// Asks only for files that already exist on origin/<protected branch> (merged migrations).
export const ASK_IF_MERGED_PATHS = ['prisma/migrations/*'];

// New files matching these ask too (a new hook is a change of the gates).
export const ASK_NEW_FILES = ['.claude/*'];

// [path prefixes, npm script]: run the script too when the branch changed files under them.
export const EXTRA_VERIFY = [[['src/modules/ai/', 'src/infrastructure/ai/'], 'test:ai']];

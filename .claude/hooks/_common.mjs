// Shared helpers for the Claude Code hooks (registered in .claude/settings.json).
//
// Hooks resolve the repo from the hook input (`cwd`, `file_path`), not from
// $CLAUDE_PROJECT_DIR: a session started in one repo edits the other one too, and in a
// worktree $CLAUDE_PROJECT_DIR points at the main checkout.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Used when the target repo has no .claude/hooks/config.mjs (e.g. not rolled out yet).
export const DEFAULT_CONFIG = {
  BASE_BRANCH: 'main',
  PROTECTED_BRANCHES: ['main'],
  SIBLING_REPOS: [],
  CODE_PATHS: ['src', 'test', 'package.json', 'package-lock.json'],
  ASK_PATHS: [
    '.claude/*',
    'CLAUDE.md',
    '*/CLAUDE.md',
    '.husky/*',
    'scripts/hooks/*',
    '.github/*',
    'eslint-suppressions.json',
    'eslint.config.*',
    'docs/specs/*',
  ],
  ASK_IF_MERGED_PATHS: [],
  ASK_NEW_FILES: ['.claude/*'],
  EXTRA_VERIFY: [],
};

export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

/** Runs git, returns stdout (trimmed) or null on failure. */
export function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Top level of the git repo containing `p` (file or directory), or null. */
export function repoRoot(p) {
  let directory = isDir(p) ? p : path.dirname(p);
  while (!isDir(directory)) {
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return git(['rev-parse', '--show-toplevel'], directory);
}

/** The target repo's own config.mjs merged over DEFAULT_CONFIG. */
export async function loadConfig(root) {
  const file = root ? path.join(root, '.claude', 'hooks', 'config.mjs') : '';
  if (!file || !existsSync(file)) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...(await import(pathToFileURL(file).href)) };
  } catch {
    return DEFAULT_CONFIG; // a broken config must not block work
  }
}

/** False when the repo uses husky but its hooks are not installed (fresh worktree). */
export function hooksInstalled(root) {
  if (!isDir(path.join(root, '.husky'))) return true;
  return isDir(path.join(root, '.husky', '_')) && isDir(path.join(root, 'node_modules'));
}

/** fnmatch-style glob on a repo-relative path: `*` matches anything, including `/`. */
export function matchesAny(rel, patterns) {
  return patterns.some((pattern) => {
    const source = pattern
      .split('')
      .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
      .join('');
    return new RegExp(`^${source}$`).test(rel);
  });
}

export function preToolDecision(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }) + '\n',
  );
}

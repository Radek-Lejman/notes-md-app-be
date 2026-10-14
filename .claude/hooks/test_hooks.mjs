// Tests for the Claude Code hooks: `node --test .claude/hooks/`.
//
// Runs the real hook scripts with JSON on stdin against throwaway git repos.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOKS = path.dirname(fileURLToPath(import.meta.url));

// Fixed config for the throwaway repos, so this file is identical in both repos and tests the
// hook logic rather than one repo's config.mjs.
const TEST_CONFIG = `
export const BASE_BRANCH = 'develop';
export const PROTECTED_BRANCHES = ['main', 'develop'];
export const SIBLING_REPOS = ['../notes-app-fe'];
export const CODE_PATHS = ['src', 'test', 'prisma', 'package.json'];
export const ASK_PATHS = ['test/*.e2e-spec.ts', 'test/support/*', 'test/*.setup.ts', 'test/jest-e2e.json',
  'docs/specs/*', '.claude/*', 'CLAUDE.md', '*/CLAUDE.md', '.husky/*', 'scripts/hooks/*', '.github/*',
  'eslint-suppressions.json', 'eslint.config.*'];
export const ASK_IF_MERGED_PATHS = ['prisma/migrations/*'];
export const ASK_NEW_FILES = ['.claude/*'];
`;

// `verify` fails when src/broken or broken-outside-code exists.
const VERIFY =
  "node -e \"const fs = require('fs'); process.exit(fs.existsSync('src/broken') || fs.existsSync('broken-outside-code') ? 1 : 0)\"";

function runHook(script, payload, ...args) {
  const result = spawnSync(process.execPath, [path.join(HOOKS, script), ...args], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 120_000,
  });
  const decision = result.stdout.trim()
    ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    : null;
  return { code: result.status, decision, stdout: result.stdout, stderr: result.stderr };
}

const sh = (cwd, ...cmd) => execFileSync(cmd[0], cmd.slice(1), { cwd, stdio: 'pipe' });

function write(root, rel, content = '') {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

function makeRepo(dir, { withConfig = true, husky = true } = {}) {
  mkdirSync(dir, { recursive: true });
  sh(dir, 'git', 'init', '-q', '-b', 'feature/x');
  sh(dir, 'git', 'config', 'user.email', 't@t');
  sh(dir, 'git', 'config', 'user.name', 't');
  if (withConfig) write(dir, '.claude/hooks/config.mjs', TEST_CONFIG);
  if (husky) {
    mkdirSync(path.join(dir, '.husky', '_'), { recursive: true });
    mkdirSync(path.join(dir, 'node_modules'));
  }
  write(dir, '.gitignore', 'node_modules\n.husky/_\n');
  sh(dir, 'git', 'add', '.');
  sh(dir, 'git', 'commit', '-q', '-m', 'init');
  return dir;
}

let tmp;
let repo;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
  repo = makeRepo(path.join(tmp, 'be'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('guard_bash', () => {
  const decision = (command, cwd = repo) =>
    runHook('guard_bash.mjs', { tool_input: { command }, cwd }).decision;

  it('denies bypassing the git hooks', () => {
    for (const command of [
      'git commit --no-verify -m x',
      'git commit -n -m x',
      'git commit -nm x',
      'git commit -am x -n',
      'HUSKY=0 git commit -m x',
      'HUSKY="0" git commit -m x',
      'export HUSKY=0',
      'git -c core.hooksPath=/dev/null commit -m x',
      'git config core.hooksPath /tmp',
      'git push --no-verify',
      'git status && git commit --no-verify -m x',
      'echo "$(git commit -n -m x)"',
      'echo "`git commit --no-verify`"',
    ]) {
      assert.equal(decision(command), 'deny', command);
    }
  });

  it('allows normal git usage', () => {
    for (const command of [
      "git commit -m 'skip with --no-verify is forbidden'",
      'git commit -am x',
      'git commit -m "fix: -n flag parsing"',
      'git commit -m x && grep -n foo src/a.ts',
      "git commit -F - <<'EOF'\nfeat: x\n\nnever use --no-verify or -n\nEOF",
      'git commit -m x # --no-verify in a comment',
      "git commit -F - <<'EOF'\ndocs: never run `git commit --no-verify`\nEOF",
      "git commit -m 'never run `git commit -n`'",
      'git config --get core.hooksPath',
      'git push -u origin feature/x',
      'git log -n 3',
      'git push --dry-run origin feature/x',
    ]) {
      assert.equal(decision(command), null, command);
    }
  });

  it('denies force-push except --force-with-lease on a feature branch', () => {
    assert.equal(decision('git push -f origin feature/x'), 'deny');
    assert.equal(decision('git push --force'), 'deny');
    assert.equal(decision('git push origin +main'), 'deny');
    assert.equal(decision('git push --force-with-lease origin develop'), 'deny');
    assert.equal(decision('git push --force-with-lease origin HEAD:main'), 'deny');
    assert.equal(decision('git push --force-with-lease origin feature/x'), null);
    assert.equal(decision('git push --force-with-lease'), null); // current branch feature/x
  });

  it('denies --force-with-lease when the current branch is protected', () => {
    sh(repo, 'git', 'switch', '-q', '-c', 'develop');
    assert.equal(decision('git push --force-with-lease'), 'deny');
  });

  it('denies resetting the database', () => {
    for (const command of [
      'npx prisma migrate reset',
      'npx prisma migrate reset --force',
      'npm run db:reset',
      'npx prisma db push --force-reset',
    ]) {
      assert.equal(decision(command), 'deny', command);
    }
    assert.equal(decision('npx prisma migrate dev --name x'), null);
  });

  it('denies reading secret files', () => {
    for (const command of ['cat .env', 'head -n 3 .env.local', 'grep JWT .env', 'source .env', 'cat cookies.txt']) {
      assert.equal(decision(command), 'deny', command);
    }
    assert.equal(decision('cat .env.example'), null);
    assert.equal(decision('grep -r env src'), null);
  });

  it('denies commit/push in a checkout without git hooks until npm ci', () => {
    const worktree = makeRepo(path.join(tmp, 'wt'), { husky: false });
    mkdirSync(path.join(worktree, '.husky'));
    assert.equal(decision('git commit -m x', worktree), 'deny');
    assert.equal(decision(`git -C ${worktree} commit -m x`), 'deny');
    assert.equal(decision(`cd ${worktree} && git push`), 'deny');
    assert.equal(decision('git status', worktree), null);
    assert.equal(decision('npm ci && git commit -m x', worktree), null);
    mkdirSync(path.join(worktree, '.husky', '_'));
    mkdirSync(path.join(worktree, 'node_modules'));
    assert.equal(decision('git commit -m x', worktree), null);
  });
});

describe('protect_paths', () => {
  const decision = (rel, { create = true, root = repo } = {}) => {
    if (create) write(root, rel);
    return runHook('protect_paths.mjs', { tool_input: { file_path: path.join(root, rel) }, cwd: repo }).decision;
  };

  it('asks for protected existing files', () => {
    for (const rel of [
      'test/notes.authz.e2e-spec.ts',
      'test/support/app.ts',
      'test/e2e-env.setup.ts',
      'test/jest-e2e.json',
      'CLAUDE.md',
      'src/modules/ai/CLAUDE.md',
      '.claude/settings.json',
      '.husky/pre-commit',
      '.github/workflows/ci.yml',
      'eslint-suppressions.json',
      'eslint.config.mjs',
      'docs/specs/001-x.md',
      'scripts/hooks/check-branch.sh',
    ]) {
      assert.equal(decision(rel), 'ask', rel);
    }
  });

  it('allows normal and new files', () => {
    assert.equal(decision('src/modules/notes/notes.service.ts'), null);
    assert.equal(decision('src/modules/notes/notes.service.spec.ts'), null);
    assert.equal(decision('test/new-feature.e2e-spec.ts', { create: false }), null);
    assert.equal(decision('docs/ai-dev-system/X.md'), null);
  });

  it('asks for new files in .claude/', () => {
    assert.equal(decision('.claude/hooks/new.mjs', { create: false }), 'ask');
  });

  it('protects migrations only once merged', () => {
    const rel = 'prisma/migrations/20260101_x/migration.sql';
    assert.equal(decision(rel), null); // exists only on this branch
    sh(repo, 'git', 'add', '.');
    sh(repo, 'git', 'commit', '-q', '-m', 'migration');
    sh(repo, 'git', 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
    assert.equal(decision(rel), 'ask');
  });

  it("uses the config of the file's repo", () => {
    const other = makeRepo(path.join(tmp, 'fe'), { withConfig: false });
    assert.equal(decision('test/x.e2e-spec.ts', { root: other }), null); // BE-only rule
    assert.equal(decision('CLAUDE.md', { root: other, create: false }), null); // does not exist yet
    assert.equal(decision('CLAUDE.md', { root: other }), 'ask');
  });
});

describe('verify_on_stop', () => {
  let session;
  beforeEach(() => {
    session = `test-${process.pid}-${Math.random().toString(36).slice(2)}`;
    write(repo, 'package.json', JSON.stringify({ scripts: { verify: VERIFY } }));
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    sh(repo, 'git', 'add', '.');
    sh(repo, 'git', 'commit', '-q', '-m', 'app');
  });

  const baseline = () => runHook('verify_on_stop.mjs', { session_id: session, cwd: repo }, 'baseline');
  const stop = (active = false) =>
    runHook('verify_on_stop.mjs', { session_id: session, cwd: repo, stop_hook_active: active });

  it('passes when the turn did not change the repo, even if red', () => {
    write(repo, 'src/broken');
    baseline();
    assert.equal(stop().code, 0);
  });

  it('blocks a red change until it is fixed', () => {
    baseline();
    write(repo, 'src/broken');
    const first = stop();
    assert.equal(first.code, 2);
    assert.match(first.stderr, /npm run verify/);
    write(repo, 'src/broken2'); // progress without a fix: still verified and blocked
    assert.equal(stop(true).code, 2);
    rmSync(path.join(repo, 'src/broken'));
    assert.equal(stop(true).code, 0);
  });

  it('lets Claude stop when nothing changed since the last refusal', () => {
    baseline();
    write(repo, 'src/broken');
    assert.equal(stop().code, 2);
    assert.equal(stop(true).code, 0);
  });

  it('verifies committed changes', () => {
    baseline();
    write(repo, 'src/broken');
    sh(repo, 'git', 'add', '.');
    sh(repo, 'git', 'commit', '-q', '-m', 'broken');
    assert.equal(stop().code, 2);
  });

  it('ignores files outside the code paths', () => {
    write(repo, 'src/broken');
    baseline();
    write(repo, 'notes.md', 'local notes');
    assert.equal(stop().code, 0);
  });

  it('remembers the green state', () => {
    baseline();
    write(repo, 'src/b.ts', 'export const b = 2;\n');
    assert.equal(stop().code, 0);
    write(repo, 'broken-outside-code'); // verify would fail now, but this code state is already green
    assert.equal(stop().code, 0);
  });

  it('verifies the sibling repo when it changed during the turn', () => {
    const sibling = makeRepo(path.join(tmp, 'notes-app-fe'), { withConfig: false });
    write(sibling, 'package.json', JSON.stringify({ scripts: { verify: 'exit 1' } }));
    sh(sibling, 'git', 'add', '.');
    sh(sibling, 'git', 'commit', '-q', '-m', 'app');
    baseline();
    assert.equal(stop().code, 0); // unchanged
    write(sibling, 'src/x.ts', 'x');
    const result = stop();
    assert.equal(result.code, 2);
    assert.match(result.stderr, /\[notes-app-fe\]/);
  });

  it('skips a repo without a verify script', () => {
    write(repo, 'package.json', JSON.stringify({ scripts: {} }));
    sh(repo, 'git', 'add', '.');
    sh(repo, 'git', 'commit', '-q', '-m', 'no verify');
    baseline();
    write(repo, 'src/broken');
    assert.equal(stop().code, 0);
  });

  it('skips when there is no baseline (hooks enabled mid-turn)', () => {
    write(repo, 'src/broken');
    assert.equal(stop().code, 0);
  });
});

describe('session_check', () => {
  it('warns when the git hooks are not installed', () => {
    rmSync(path.join(repo, '.husky', '_'), { recursive: true });
    const { stdout } = runHook('session_check.mjs', { cwd: repo });
    assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /npm ci/);
  });

  it('is silent when they are installed', () => {
    assert.equal(existsSync(path.join(repo, '.husky', '_')), true);
    assert.equal(runHook('session_check.mjs', { cwd: repo }).stdout, '');
  });
});

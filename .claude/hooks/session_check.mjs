// SessionStart: warns Claude when the checkout has no git hooks installed.

import { hooksInstalled, readInput, repoRoot } from './_common.mjs';

const data = readInput();
const root = repoRoot(data.cwd ?? process.cwd());
if (root && !hooksInstalled(root)) {
  const message =
    `Git hooks are not installed in ${root} (no node_modules or .husky/_ — a fresh worktree?): ` +
    'git would silently skip every pre-commit/pre-push check. Run `npm ci` before the first commit; ' +
    'until then .claude/hooks/guard_bash.mjs refuses git commit/push here.';
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message } }) + '\n',
  );
}

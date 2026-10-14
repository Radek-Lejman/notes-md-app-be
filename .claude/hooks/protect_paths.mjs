// PreToolUse(Edit|Write|NotebookEdit): asks the user before protected files change.
//
// Uses the config of the repo the file belongs to, so a session in one repo protects the
// other one too.

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { git, loadConfig, matchesAny, preToolDecision, readInput, repoRoot } from './_common.mjs';

function realpath(p) {
  try {
    return realpathSync(p);
  } catch {
    // a new file: resolve its existing parent
    return path.join(realpath(path.dirname(p)), path.basename(p));
  }
}

function mergedTo(rel, root, config) {
  return config.PROTECTED_BRANCHES.find(
    (branch) => git(['cat-file', '-e', `origin/${branch}:${rel}`], root) !== null,
  );
}

async function reasonFor(file) {
  const root = repoRoot(file);
  if (!root) return null;
  const rel = path.relative(realpath(root), realpath(file)).split(path.sep).join('/');
  if (rel.startsWith('../')) return null;
  const config = await loadConfig(root);

  if (!existsSync(file)) {
    return matchesAny(rel, config.ASK_NEW_FILES) ? `${rel} is a new file in the gate configuration` : null;
  }
  if (matchesAny(rel, config.ASK_IF_MERGED_PATHS)) {
    const branch = mergedTo(rel, root, config);
    return branch ? `${rel} is already merged to ${branch} — create a new migration instead` : null;
  }
  if (matchesAny(rel, config.ASK_PATHS)) {
    return `${rel} is protected (acceptance test, spec or a gate: hooks, CI, lint config, CLAUDE.md)`;
  }
  return null;
}

const data = readInput();
const file = data.tool_input?.file_path ?? data.tool_input?.notebook_path;
if (file) {
  const reason = await reasonFor(path.resolve(data.cwd ?? process.cwd(), file));
  if (reason) {
    preToolDecision(
      'ask',
      `Protected file (.claude/hooks/protect_paths.mjs): ${reason}. Needs the user's consent.`,
    );
  }
}

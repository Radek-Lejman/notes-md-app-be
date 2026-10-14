// Stop: a turn that changed code ends only with a green `npm run verify`.
//
// `verify_on_stop.mjs baseline` (UserPromptSubmit) records the state of each repo at the start
// of the turn; on Stop only repos whose state changed during the turn are verified, so a
// question asked over someone else's red working tree is never blocked.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, loadConfig, readInput, repoRoot } from './_common.mjs';

const OUTPUT_TAIL = 3000;
const VERIFY_TIMEOUT_MS = 240_000;

function baselineFile(sessionId) {
  const directory = path.join(os.tmpdir(), 'claude-verify');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, `${sessionId || 'unknown'}.json`);
}

async function repos(cwd) {
  const root = repoRoot(cwd);
  if (!root) return [];
  const found = [root];
  for (const sibling of (await loadConfig(root)).SIBLING_REPOS) {
    const other = repoRoot(path.resolve(root, sibling));
    if (other && !found.includes(other)) found.push(other);
  }
  return found;
}

/** Hash of HEAD + uncommitted changes + untracked files, limited to the code paths. */
function state(root, config) {
  const paths = config.CODE_PATHS.filter((p) => existsSync(path.join(root, p)));
  if (!paths.length) return null;
  const digest = createHash('sha256').update(git(['rev-parse', 'HEAD'], root) ?? '');
  digest.update(spawnSync('git', ['diff', 'HEAD', '--binary', '--', ...paths], { cwd: root }).stdout ?? '');
  const untracked = (git(['ls-files', '-o', '--exclude-standard', '--', ...paths], root) ?? '')
    .split('\n')
    .filter(Boolean)
    .sort();
  for (const rel of untracked) {
    digest.update(rel);
    try {
      digest.update(createHash('sha256').update(readFileSync(path.join(root, rel))).digest());
    } catch {
      // vanished or unreadable: the name alone is enough
    }
  }
  return digest.digest('hex');
}

function memoryFile(root) {
  const p = git(['rev-parse', '--git-path', 'claude-verify.json'], root);
  return p ? path.resolve(root, p) : null;
}

function loadJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) ?? {};
  } catch {
    return {};
  }
}

function saveJson(file, value) {
  if (file) writeFileSync(file, JSON.stringify(value));
}

function npmScripts(root) {
  return loadJson(path.join(root, 'package.json')).scripts ?? {};
}

function changedFiles(root, config) {
  const base = git(['merge-base', 'HEAD', `origin/${config.BASE_BRANCH}`], root);
  const lists = [
    base ? git(['diff', '--name-only', base], root) : null,
    git(['diff', '--name-only', 'HEAD'], root),
    git(['ls-files', '-o', '--exclude-standard'], root),
  ];
  return lists.flatMap((list) => (list ?? '').split('\n').filter(Boolean));
}

function scriptsToRun(root, config) {
  const available = npmScripts(root);
  const files = changedFiles(root, config);
  const scripts = ['verify'];
  for (const [prefixes, script] of config.EXTRA_VERIFY) {
    if (script in available && files.some((f) => prefixes.some((p) => f.startsWith(p)))) {
      scripts.push(script);
    }
  }
  return scripts;
}

/** Returns null when green, otherwise the tail of the failing output. */
function runScripts(root, scripts) {
  for (const script of scripts) {
    const result = spawnSync('npm', ['run', '-s', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: VERIFY_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error?.code === 'ETIMEDOUT' || result.signal) {
      return `\`npm run ${script}\` timed out after ${VERIFY_TIMEOUT_MS / 1000} s`;
    }
    if (result.error) return `could not run npm: ${result.error.message}`;
    if (result.status !== 0) {
      return `\`npm run ${script}\` failed:\n${(result.stdout + result.stderr).slice(-OUTPUT_TAIL)}`;
    }
  }
  return null;
}

async function recordBaseline(data) {
  const snapshot = {};
  for (const root of await repos(data.cwd ?? process.cwd())) {
    snapshot[root] = state(root, await loadConfig(root));
  }
  saveJson(baselineFile(data.session_id), snapshot);
}

async function onStop(data) {
  const baseline = loadJson(baselineFile(data.session_id));
  const retry = Boolean(data.stop_hook_active);
  const failures = [];
  for (const root of await repos(data.cwd ?? process.cwd())) {
    const config = await loadConfig(root);
    const current = state(root, config);
    if (!(root in baseline) || current === null || current === baseline[root]) continue; // unchanged this turn
    if (!('verify' in npmScripts(root))) continue;
    const memoryPath = memoryFile(root);
    const memory = memoryPath ? loadJson(memoryPath) : {};
    if (current === memory.green) continue;
    if (retry && current === memory.failed) continue; // no change since the last refusal: let Claude report red
    const error = runScripts(root, scriptsToRun(root, config));
    memory[error === null ? 'green' : 'failed'] = current;
    saveJson(memoryPath, memory);
    if (error) failures.push(`[${path.basename(root)}] ${error}`);
  }
  if (failures.length) {
    process.stderr.write(
      'Stop hook (.claude/hooks/verify_on_stop.mjs): this turn changed code and verification is red. ' +
        'Fix it, or if you cannot, tell the user plainly that the state is red — do not claim success.\n\n' +
        failures.join('\n\n') +
        '\n',
    );
    process.exitCode = 2;
  }
}

const data = readInput();
if (process.argv[2] === 'baseline') await recordBaseline(data);
else await onStop(data);

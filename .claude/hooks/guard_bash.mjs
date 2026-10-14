// PreToolUse(Bash): denies commands that bypass the gates.
//
// A safety net against mistakes, not a security boundary: `bash -c "$(...)"`, variables
// or aliases get around it. The real gates are CI and the GitHub rulesets.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  git,
  hooksInstalled,
  isDir,
  loadConfig,
  preToolDecision,
  readInput,
  repoRoot,
} from './_common.mjs';

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;
const SECRET_READERS = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'grep', 'rg', 'bat', 'source', '.', 'strings', 'xxd', 'od',
]);
// git commit short options that take a value: the rest of the cluster / next token is the value.
const COMMIT_VALUE_OPTS = new Set(['m', 'F', 'C', 'c', 't']);
const OPERATOR_CHARS = ';&|()\n';
const HUMAN_ONLY =
  'If it is really needed, ask the user to run it themselves (`! <command>` in Claude Code).';

/** Drops heredoc bodies (commit messages) so their text is not parsed as commands. */
function stripHeredocs(command) {
  const out = [];
  let end = null;
  for (const line of command.split('\n')) {
    if (end !== null) {
      if (line.trim() === end) end = null;
      continue;
    }
    out.push(line);
    const match = HEREDOC.exec(line);
    if (match) end = match[2];
  }
  return out.join('\n');
}

/**
 * POSIX-like word splitting: quotes, backslashes, `#` comments. Operators (`&&`, `|`, `;`,
 * `(`, newline …) become `{ op }` objects so a quoted "&&" stays a word.
 * Throws on unbalanced quotes.
 */
export function tokenize(text) {
  const tokens = [];
  let word = '';
  let inWord = false;
  const flush = () => {
    if (inWord) tokens.push(word);
    word = '';
    inWord = false;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) throw new Error('unbalanced quote');
      word += text.slice(i + 1, end);
      inWord = true;
      i = end + 1;
    } else if (c === '"') {
      i += 1;
      let closed = false;
      while (i < text.length) {
        const d = text[i];
        if (d === '\\' && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1])) {
          if (text[i + 1] !== '\n') word += text[i + 1];
          i += 2;
        } else if (d === '"') {
          closed = true;
          i += 1;
          break;
        } else {
          word += d;
          i += 1;
        }
      }
      if (!closed) throw new Error('unbalanced quote');
      inWord = true;
    } else if (c === '\\') {
      if (i + 1 < text.length && text[i + 1] !== '\n') {
        word += text[i + 1];
        inWord = true;
      }
      i += 2;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      flush();
      i += 1;
    } else if (c === '#' && !inWord) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else if (OPERATOR_CHARS.includes(c)) {
      flush();
      let op = c;
      if (';&|'.includes(c) && i + 1 < text.length && ';&|'.includes(text[i + 1])) op += text[i + 1];
      tokens.push({ op });
      i += op.length;
    } else {
      word += c;
      inWord = true;
      i += 1;
    }
  }
  flush();
  return tokens;
}

function segments(command) {
  const result = [];
  let current = [];
  for (const token of tokenize(stripHeredocs(command))) {
    if (typeof token === 'object') {
      if (current.length) result.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length) result.push(current);
  return result;
}

function splitAssignments(tokens) {
  const assignments = {};
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === 'env') {
      i += 1;
    } else if (ASSIGNMENT.test(tokens[i])) {
      const at = tokens[i].indexOf('=');
      assignments[tokens[i].slice(0, at)] = tokens[i].slice(at + 1);
      i += 1;
    } else {
      break;
    }
  }
  return [assignments, tokens.slice(i)];
}

function isSecretFile(token) {
  const name = path.basename(token.replace(/^<+/, ''));
  if (name === '.env.example') return false;
  return name === '.env' || name.startsWith('.env.') || name === 'cookies.txt';
}

function expandHome(p) {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Returns { directory from -C, -c key=value list, subcommand, subcommand args }. */
function parseGit(args) {
  const parsed = { directory: null, configs: [], sub: null, subArgs: [] };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '-C' && i + 1 < args.length) {
      parsed.directory = args[i + 1];
      i += 2;
    } else if (arg === '-c' && i + 1 < args.length) {
      parsed.configs.push(args[i + 1]);
      i += 2;
    } else if (arg.startsWith('-')) {
      i += 1;
    } else {
      parsed.sub = arg;
      parsed.subArgs = args.slice(i + 1);
      break;
    }
  }
  return parsed;
}

function commitSkipsHooks(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') return false;
    if (arg.startsWith('--') || !arg.startsWith('-') || arg.length < 2) continue;
    for (let pos = 1; pos < arg.length; pos++) {
      if (arg[pos] === 'n') return true;
      if (COMMIT_VALUE_OPTS.has(arg[pos])) {
        if (pos === arg.length - 1) i += 1; // the value is the next token
        break;
      }
    }
  }
  return false;
}

function checkPush(args, cwd, config) {
  const options = args.filter((a) => a.startsWith('-'));
  const refspecs = args.filter((a) => !a.startsWith('-')).slice(1);
  if (options.some((o) => o === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(o))) {
    return 'Force-push is not allowed (linear history). Use --force-with-lease on your own feature branch.';
  }
  if (refspecs.some((r) => r.startsWith('+'))) {
    return 'A `+refspec` is a force-push. Use --force-with-lease on your own feature branch.';
  }
  if (options.some((o) => o.startsWith('--force-with-lease') || o === '--force-if-includes')) {
    let targets = refspecs.map((r) => r.split(':').pop().replace(/^refs\/heads\//, ''));
    if (!targets.length) targets = [git(['symbolic-ref', '-q', '--short', 'HEAD'], cwd) ?? ''];
    const protectedTargets = targets.filter((t) => config.PROTECTED_BRANCHES.includes(t));
    if (protectedTargets.length) {
      return `Force-push to ${protectedTargets.join(', ')} is not allowed (protected branch).`;
    }
  }
  return null;
}

function installsDependencies(tokens) {
  const [, rest] = splitAssignments(tokens);
  return rest.length >= 2 && path.basename(rest[0]) === 'npm' && ['ci', 'install', 'i'].includes(rest[1]);
}

/** Returns [deny reason or null, new cwd]. `installed`: an earlier segment ran npm ci/install. */
async function checkSegment(segment, cwd, installed) {
  const [assignments, tokens] = splitAssignments(segment);
  if (assignments.HUSKY === '0') return ['HUSKY=0 skips the git hooks. ' + HUMAN_ONLY, cwd];
  if (!tokens.length) return [null, cwd];
  const cmd = path.basename(tokens[0]);
  const args = tokens.slice(1);

  if (cmd === 'cd') {
    return [null, path.resolve(cwd, expandHome(args[0] ?? '~'))];
  }
  if (cmd === 'export' && args.includes('HUSKY=0')) {
    return ['HUSKY=0 skips the git hooks. ' + HUMAN_ONLY, cwd];
  }
  if (SECRET_READERS.has(cmd) && args.some(isSecretFile)) {
    return [
      'Reading .env*/cookies.txt is not allowed: secrets stay out of the model context. Use .env.example for the keys.',
      cwd,
    ];
  }
  const prisma = tokens.indexOf('prisma');
  if (prisma >= 0) {
    const rest = tokens.slice(prisma + 1);
    if (
      (rest[0] === 'migrate' && rest[1] === 'reset') ||
      (rest[0] === 'db' && rest[1] === 'push' && rest.includes('--force-reset'))
    ) {
      return ['Resetting the database destroys local data. ' + HUMAN_ONLY, cwd];
    }
  }
  if (['npm', 'pnpm', 'yarn'].includes(cmd) && args.includes('db:reset')) {
    return ['Resetting the database destroys local data. ' + HUMAN_ONLY, cwd];
  }

  if (cmd !== 'git') return [null, cwd];
  const { directory, configs, sub, subArgs } = parseGit(args);
  const gitCwd = directory ? path.resolve(cwd, expandHome(directory)) : cwd;
  if (subArgs.includes('--no-verify')) {
    return ['--no-verify skips the git hooks. Fix what the hook reports. ' + HUMAN_ONLY, cwd];
  }
  if (
    configs.some((c) => c.toLowerCase().startsWith('core.hookspath')) ||
    (sub === 'config' &&
      subArgs.some((a) => a.toLowerCase() === 'core.hookspath') &&
      !subArgs.includes('--get'))
  ) {
    return ['Changing core.hooksPath disables the git hooks. ' + HUMAN_ONLY, cwd];
  }
  if (sub === 'commit' && commitSkipsHooks(subArgs)) {
    return ['`git commit -n` skips the git hooks. Fix what the hook reports. ' + HUMAN_ONLY, cwd];
  }

  const root = isDir(gitCwd) ? repoRoot(gitCwd) : null;
  const config = await loadConfig(root);
  if (sub === 'push') {
    const reason = checkPush(subArgs, gitCwd, config);
    if (reason) return [reason, cwd];
  }
  if ((sub === 'commit' || sub === 'push') && root && !installed && !hooksInstalled(root)) {
    return [
      `Git hooks are not installed in ${root} (no node_modules or .husky/_ — a fresh worktree?), ` +
        'so the commit would skip every check. Run `npm ci` there first.',
      cwd,
    ];
  }
  return [null, cwd];
}

export async function check(command, cwd) {
  // Command substitutions run too, also inside double quotes: check them on their own
  // (not inside heredoc bodies or single quotes, where the shell does not run them).
  const executable = stripHeredocs(command).replace(/'[^']*'/g, "''");
  for (const match of executable.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    const inner = match[1] ?? match[2];
    const reason = inner && (await check(inner, cwd));
    if (reason) return reason;
  }
  let parsed;
  try {
    parsed = segments(command);
  } catch {
    // unbalanced quotes: fall back to a plain token search
    return /(^|\s)--no-verify(\s|$)/.test(command) ? '--no-verify skips the git hooks. ' + HUMAN_ONLY : null;
  }
  let installed = false;
  for (const segment of parsed) {
    const [reason, nextCwd] = await checkSegment(segment, cwd, installed);
    if (reason) return reason;
    cwd = nextCwd;
    installed ||= installsDependencies(segment);
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = readInput();
  const reason = await check(data.tool_input?.command ?? '', data.cwd ?? process.cwd());
  if (reason) preToolDecision('deny', `Blocked by .claude/hooks/guard_bash.mjs: ${reason}`);
}

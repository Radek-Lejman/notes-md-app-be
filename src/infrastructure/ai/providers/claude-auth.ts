import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiAuth, SERVER_AUTH } from '../types/auth.types';

export interface ClaudeProcessEnv {
  env: NodeJS.ProcessEnv;
  /** Removes the per-run config dir. Always call it (finally). */
  cleanup: () => Promise<void>;
}

// Host API credentials: never used by a run (server runs bill the host subscription).
const HOST_API_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

/**
 * Environment for a Claude Code process (CLI or Agent SDK) running on `auth`.
 *
 * - server: host subscription login — ~/.claude or CLAUDE_CODE_OAUTH_TOKEN (e.g. in Docker,
 *   where there is no ~/.claude); API keys of the host are dropped.
 * - user credential: passed via env, with a fresh, private CLAUDE_CONFIG_DIR per run, so
 *   the host login, other users' sessions and any cached state are never visible.
 */
export async function prepareClaudeEnv(auth: AiAuth = SERVER_AUTH): Promise<ClaudeProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  HOST_API_VARS.forEach((name) => delete env[name]);

  if (auth.kind === 'server') {
    return { env, cleanup: () => Promise.resolve() };
  }

  // A user run must never see the host login token.
  delete env.CLAUDE_CODE_OAUTH_TOKEN;

  // mkdtemp creates the directory with 0700 permissions.
  const configDir = await mkdtemp(join(tmpdir(), 'notes-ai-'));
  env.CLAUDE_CONFIG_DIR = configDir;
  if (auth.kind === 'claude-oauth-token') env.CLAUDE_CODE_OAUTH_TOKEN = auth.token;
  else env.ANTHROPIC_API_KEY = auth.apiKey;

  return { env, cleanup: () => rm(configDir, { recursive: true, force: true }) };
}

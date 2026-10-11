import { existsSync, statSync } from 'node:fs';
import { prepareClaudeEnv } from './claude-auth';

describe('prepareClaudeEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ANTHROPIC_API_KEY: 'host-key',
      ANTHROPIC_AUTH_TOKEN: 'host-auth',
      CLAUDE_CODE_OAUTH_TOKEN: 'host-token',
      CLAUDE_CONFIG_DIR: '/host/.claude',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('server: keeps the host login (config dir and OAuth token) but drops host API keys', async () => {
    const { env, cleanup } = await prepareClaudeEnv({ kind: 'server' });

    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('host-token');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/host/.claude');
    await cleanup();
  });

  it('defaults to the server login', async () => {
    const { env } = await prepareClaudeEnv();
    expect(env.CLAUDE_CONFIG_DIR).toBe('/host/.claude');
  });

  it('oauth token: passes only the user token, in a private config dir removed by cleanup', async () => {
    const { env, cleanup } = await prepareClaudeEnv({ kind: 'claude-oauth-token', token: 'tok' });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env.CLAUDE_CONFIG_DIR).not.toBe('/host/.claude');
    const dir = env.CLAUDE_CONFIG_DIR!;
    expect(statSync(dir).mode & 0o777).toBe(0o700);

    await cleanup();
    expect(existsSync(dir)).toBe(false);
  });

  it('api key: passes only the user key, in a private config dir', async () => {
    const { env, cleanup } = await prepareClaudeEnv({ kind: 'anthropic-api-key', apiKey: 'key' });

    expect(env.ANTHROPIC_API_KEY).toBe('key');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
    expect(env.CLAUDE_CONFIG_DIR).not.toBe('/host/.claude');
    await cleanup();
  });

  it('does not modify process.env', async () => {
    await prepareClaudeEnv({ kind: 'claude-oauth-token', token: 'tok' });
    expect(process.env.ANTHROPIC_API_KEY).toBe('host-key');
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('host-token');
  });
});

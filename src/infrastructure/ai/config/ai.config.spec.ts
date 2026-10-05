import { loadAiConfig } from './ai.config';

const AI_ENV_KEYS = [
  'AI_PROVIDER',
  'AI_AGENT_PROVIDER',
  'AI_CLAUDE_MODEL',
  'AI_CLAUDE_CLI_BIN',
  'AI_TIMEOUT_MS',
  'AI_AGENT_MAX_TURNS',
  'AI_AGENT_TIMEOUT_MS',
  'AI_OLLAMA_URL',
  'AI_OLLAMA_MODEL',
  'AI_OLLAMA_THINK',
  'AI_OLLAMA_TIMEOUT_MS',
];

describe('loadAiConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    AI_ENV_KEYS.forEach((key) => delete process.env[key]);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses defaults when no env is set', () => {
    expect(loadAiConfig()).toEqual({
      llmProvider: 'claude-cli',
      agentProvider: 'claude-agent-sdk',
      providers: {
        'claude-cli': { bin: 'claude', model: 'sonnet', timeoutMs: 90_000 },
        'claude-agent-sdk': { model: 'sonnet', maxTurns: 8, timeoutMs: 180_000 },
        ollama: {
          baseUrl: 'http://localhost:11434',
          model: 'qwen3:30b-a3b',
          think: undefined,
          timeoutMs: 180_000,
          maxTurns: 8,
        },
      },
    });
  });

  it('reads every value from env', () => {
    Object.assign(process.env, {
      AI_PROVIDER: 'ollama',
      AI_AGENT_PROVIDER: 'ollama',
      AI_CLAUDE_MODEL: 'opus',
      AI_CLAUDE_CLI_BIN: '/bin/claude',
      AI_TIMEOUT_MS: '5000',
      AI_AGENT_MAX_TURNS: '3',
      AI_AGENT_TIMEOUT_MS: '6000',
      AI_OLLAMA_URL: 'http://host:1',
      AI_OLLAMA_MODEL: 'llama3.2',
      AI_OLLAMA_THINK: 'true',
      AI_OLLAMA_TIMEOUT_MS: '7000',
    });

    expect(loadAiConfig()).toEqual({
      llmProvider: 'ollama',
      agentProvider: 'ollama',
      providers: {
        'claude-cli': { bin: '/bin/claude', model: 'opus', timeoutMs: 5000 },
        'claude-agent-sdk': { model: 'opus', maxTurns: 3, timeoutMs: 6000 },
        ollama: {
          baseUrl: 'http://host:1',
          model: 'llama3.2',
          think: true,
          timeoutMs: 7000,
          maxTurns: 3,
        },
      },
    });
  });

  it('parses AI_OLLAMA_THINK=false', () => {
    process.env.AI_OLLAMA_THINK = 'false';
    expect(loadAiConfig().providers.ollama.think).toBe(false);
  });

  it('treats empty AI_OLLAMA_THINK as unset', () => {
    process.env.AI_OLLAMA_THINK = '';
    expect(loadAiConfig().providers.ollama.think).toBeUndefined();
  });

  it('rejects invalid AI_OLLAMA_THINK', () => {
    process.env.AI_OLLAMA_THINK = 'maybe';
    expect(() => loadAiConfig()).toThrow('AI_OLLAMA_THINK');
  });

  it.each(['0', '31'])('rejects AI_AGENT_MAX_TURNS=%s', (value) => {
    process.env.AI_AGENT_MAX_TURNS = value;
    expect(() => loadAiConfig()).toThrow('AI_AGENT_MAX_TURNS');
  });

  it('rejects AI_TIMEOUT_MS below 1000', () => {
    process.env.AI_TIMEOUT_MS = '500';
    expect(() => loadAiConfig()).toThrow('AI_TIMEOUT_MS');
  });
});

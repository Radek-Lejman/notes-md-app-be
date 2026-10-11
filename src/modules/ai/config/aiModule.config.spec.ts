import { loadAiModuleConfig } from './aiModule.config';

describe('loadAiModuleConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of Object.keys(process.env)) {
      if (/^(AI_|RAG_)/.test(key)) delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses safe defaults when nothing is configured', () => {
    expect(loadAiModuleConfig()).toEqual({
      credentialsSecret: 'dev-only-ai-credentials-secret-change-me-0123456789',
      serverLoginEmails: [],
      limits: {
        maxConcurrentRuns: 3,
        maxConcurrentRunsPerUser: 1,
        chatPerMinute: 20,
        completePerMinute: 5,
      },
      rag: {
        enabled: true,
        chunkSize: 1500,
        chunkOverlap: 200,
        topK: 6,
        minScore: 0.45,
        autoContextK: 4,
        indexIntervalMs: 30_000,
        indexDebounceMs: 10_000,
        indexBatchSize: 20,
      },
    });
  });

  it('normalizes the server-login allow-list (trimmed, lower-case, no blanks)', () => {
    process.env.AI_SERVER_LOGIN_EMAILS = ' Me@Example.com, ,other@example.com ,';
    expect(loadAiModuleConfig().serverLoginEmails).toEqual(['me@example.com', 'other@example.com']);
  });

  it('reads limits and RAG settings from env', () => {
    Object.assign(process.env, {
      AI_CREDENTIALS_SECRET: 'x'.repeat(40),
      AI_MAX_CONCURRENT_RUNS: '10',
      AI_MAX_CONCURRENT_RUNS_PER_USER: '2',
      AI_CHAT_RATE_LIMIT_PER_MIN: '60',
      AI_RATE_LIMIT_PER_MIN: '30',
      RAG_ENABLED: 'false',
      RAG_CHUNK_SIZE: '1000',
      RAG_CHUNK_OVERLAP: '500',
      RAG_MIN_SCORE: '0.6',
    });

    const config = loadAiModuleConfig();
    expect(config.credentialsSecret).toBe('x'.repeat(40));
    expect(config.limits).toEqual({
      maxConcurrentRuns: 10,
      maxConcurrentRunsPerUser: 2,
      chatPerMinute: 60,
      completePerMinute: 30,
    });
    expect(config.rag).toMatchObject({
      enabled: false,
      chunkSize: 1000,
      chunkOverlap: 500,
      minScore: 0.6,
    });
  });

  it('caps the chunk overlap at half of the chunk size', () => {
    Object.assign(process.env, { RAG_CHUNK_SIZE: '1000', RAG_CHUNK_OVERLAP: '501' });
    expect(() => loadAiModuleConfig()).toThrow('RAG_CHUNK_OVERLAP must be <= 500');
  });

  it.each([
    ['AI_CREDENTIALS_SECRET', 'too-short', 'must be at least 32 bytes'],
    ['AI_MAX_CONCURRENT_RUNS', '0', 'must be >= 1'],
    ['RAG_MIN_SCORE', '1.5', 'must be <= 1'],
    ['RAG_ENABLED', 'maybe', 'must be boolean'],
  ])('rejects an invalid %s=%s', (key, value, message) => {
    process.env[key] = value;
    expect(() => loadAiModuleConfig()).toThrow(message);
  });
});

describe('aiModuleConfig', () => {
  it('is loaded once and then served from the cache', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module cache per test
      const { aiModuleConfig } = require('./aiModule.config') as typeof import('./aiModule.config');
      const first = aiModuleConfig();
      process.env.AI_MAX_CONCURRENT_RUNS = '9';
      try {
        expect(aiModuleConfig()).toBe(first);
        expect(aiModuleConfig().limits.maxConcurrentRuns).toBe(first.limits.maxConcurrentRuns);
      } finally {
        delete process.env.AI_MAX_CONCURRENT_RUNS;
      }
    });
  });
});

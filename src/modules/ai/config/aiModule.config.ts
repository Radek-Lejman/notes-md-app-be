import { envBoolean, envNumber, envSecret, envString } from '@core/config';

/**
 * App-level AI settings: accounts, limits and RAG. All values come from env —
 * see the "AI" section of .env.example for what each one does.
 * (Provider/model settings live in the infrastructure config: src/infrastructure/ai/config.)
 */
export const AI_MODULE_CONFIG = Symbol('AI_MODULE_CONFIG');

export interface RagConfig {
  enabled: boolean;
  /** Max characters per chunk; ~4 chars per token. */
  chunkSize: number;
  /** Characters repeated between neighbouring chunks of one section. */
  chunkOverlap: number;
  /** Results returned by the semantic_search tool. */
  topK: number;
  /** Cosine similarity (0..1) below which a chunk is treated as unrelated. */
  minScore: number;
  /** Chunks put into the prompt up front for every question; 0 = tool only. */
  autoContextK: number;
  indexIntervalMs: number;
  /** A note is indexed only after it was not edited for this long (autosave bursts). */
  indexDebounceMs: number;
  indexBatchSize: number;
}

export interface AiModuleConfig {
  /** Encrypts users' Claude credentials at rest. Changing it invalidates saved ones. */
  credentialsSecret: string;
  /** Users (emails) allowed to run on the host's own `claude` login when they saved no credential. */
  serverLoginEmails: string[];
  /** Agent's search_notes = keyword search (tools/keywordSearch.tool.ts) instead of the basic one. */
  agentKeywordSearch: boolean;
  limits: {
    maxConcurrentRuns: number;
    maxConcurrentRunsPerUser: number;
    chatPerMinute: number;
    completePerMinute: number;
  };
  rag: RagConfig;
}

export function loadAiModuleConfig(): AiModuleConfig {
  const chunkSize = envNumber('RAG_CHUNK_SIZE', { default: 1500, min: 200, max: 8000 });

  return {
    // No dev fallback: a key known from the repo would decrypt every saved credential on any
    // deployment that does not set NODE_ENV=production.
    credentialsSecret: envSecret('AI_CREDENTIALS_SECRET'),
    serverLoginEmails: envString('AI_SERVER_LOGIN_EMAILS', { default: '' })
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    agentKeywordSearch: envBoolean('AI_AGENT_KEYWORD_SEARCH', { default: true }),
    limits: {
      maxConcurrentRuns: envNumber('AI_MAX_CONCURRENT_RUNS', { default: 3, min: 1, max: 50 }),
      maxConcurrentRunsPerUser: envNumber('AI_MAX_CONCURRENT_RUNS_PER_USER', {
        default: 1,
        min: 1,
        max: 10,
      }),
      chatPerMinute: envNumber('AI_CHAT_RATE_LIMIT_PER_MIN', { default: 20, min: 1, max: 600 }),
      completePerMinute: envNumber('AI_RATE_LIMIT_PER_MIN', { default: 5, min: 1, max: 600 }),
    },
    rag: {
      enabled: envBoolean('RAG_ENABLED', { default: true }),
      chunkSize,
      chunkOverlap: envNumber('RAG_CHUNK_OVERLAP', { default: 200, min: 0, max: chunkSize / 2 }),
      topK: envNumber('RAG_TOP_K', { default: 6, min: 1, max: 30 }),
      minScore: envNumber('RAG_MIN_SCORE', { default: 0.45, min: 0, max: 1 }),
      autoContextK: envNumber('RAG_AUTO_CONTEXT_K', { default: 4, min: 0, max: 20 }),
      indexIntervalMs: envNumber('RAG_INDEX_INTERVAL_MS', { default: 30_000, min: 1_000 }),
      indexDebounceMs: envNumber('RAG_INDEX_DEBOUNCE_MS', { default: 10_000, min: 0 }),
      indexBatchSize: envNumber('RAG_INDEX_BATCH_SIZE', { default: 20, min: 1, max: 500 }),
    },
  };
}

let cached: AiModuleConfig | undefined;

/**
 * Loaded once, on first use (after ConfigModule has read .env).
 * Also used by @Throttle limits, which are resolved per request.
 */
export function aiModuleConfig(): AiModuleConfig {
  return (cached ??= loadAiModuleConfig());
}

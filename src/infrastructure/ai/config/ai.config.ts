import { envBoolean, envNumber, envString } from '@core/config';
import { LlmProviderName } from '../types/llm.types';
import { AgentProviderName } from '../types/agent.types';
import { EmbeddingProviderName } from '../types/embedding.types';
import { RERANK_OFF, RerankProviderName } from '../types/rerank.types';

export const AI_CONFIG = Symbol('AI_CONFIG');

export interface ClaudeCliConfig {
  bin: string;
  model: string;
  timeoutMs: number;
}

export interface ClaudeAgentSdkConfig {
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  /**
   * Reasoning mode for thinking models (qwen3...). Unset = model default (recommended):
   * Ollama returns reasoning separately from the answer. Forcing `false` breaks some
   * qwen3 templates (reasoning leaks into content); `true` errors on non-thinking models.
   */
  think?: boolean;
  /** Per HTTP request. Local models can be slow, esp. on first load. */
  timeoutMs: number;
  maxTurns: number;
}

export interface OllamaEmbeddingConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

/** A model run on this server by @huggingface/transformers (providers/local). */
export interface LocalModelConfig {
  /** Hugging Face model id (ONNX). */
  model: string;
  /** Where downloaded models are kept; unset = the library default (node_modules cache). */
  cacheDir?: string;
  /** Per request; the first one may include the model download. */
  timeoutMs: number;
  /** The model runs in a child process that exits after this long without requests. */
  idleMs: number;
}

export type LocalEmbeddingConfig = LocalModelConfig;

export interface AiConfig {
  /** Active provider for simple completions. */
  llmProvider: LlmProviderName;
  /** Active provider for agent runs. */
  agentProvider: AgentProviderName;
  /** Provider for RAG embeddings. */
  embeddingProvider: EmbeddingProviderName;
  /** Provider that reorders RAG search results; 'none' = no reranking. */
  rerankProvider: RerankProviderName | typeof RERANK_OFF;
  /** Per-provider settings, keyed by provider name. */
  providers: {
    'claude-cli': ClaudeCliConfig;
    'claude-agent-sdk': ClaudeAgentSdkConfig;
    ollama: OllamaConfig;
    'ollama-embedding': OllamaEmbeddingConfig;
    'local-embedding': LocalEmbeddingConfig;
    'local-rerank': LocalModelConfig;
  };
}

// Read lazily (from the module factory), so .env is already loaded by ConfigModule.
export function loadAiConfig(): AiConfig {
  const model = envString('AI_CLAUDE_MODEL', { default: 'sonnet' });
  const maxTurns = envNumber('AI_AGENT_MAX_TURNS', { default: 8, min: 1, max: 30 });
  const ollamaUrl = envString('AI_OLLAMA_URL', { default: 'http://localhost:11434' });

  return {
    llmProvider: envString('AI_PROVIDER', { default: 'claude-cli' }) as LlmProviderName,
    agentProvider: envString('AI_AGENT_PROVIDER', {
      default: 'claude-agent-sdk',
    }) as AgentProviderName,
    embeddingProvider: envString('RAG_EMBEDDING_PROVIDER', {
      default: 'ollama',
    }) as EmbeddingProviderName,
    rerankProvider: envString('RAG_RERANK_PROVIDER', {
      default: RERANK_OFF,
    }) as AiConfig['rerankProvider'],
    providers: {
      'claude-cli': {
        bin: envString('AI_CLAUDE_CLI_BIN', { default: 'claude' }),
        model,
        timeoutMs: envNumber('AI_TIMEOUT_MS', { default: 90_000, min: 1_000 }),
      },
      'claude-agent-sdk': {
        model,
        maxTurns,
        timeoutMs: envNumber('AI_AGENT_TIMEOUT_MS', { default: 180_000, min: 1_000 }),
      },
      ollama: {
        baseUrl: ollamaUrl,
        model: envString('AI_OLLAMA_MODEL', { default: 'qwen3:30b-a3b' }),
        think: process.env.AI_OLLAMA_THINK ? envBoolean('AI_OLLAMA_THINK') : undefined,
        timeoutMs: envNumber('AI_OLLAMA_TIMEOUT_MS', { default: 180_000, min: 1_000 }),
        maxTurns,
      },
      'ollama-embedding': {
        baseUrl: envString('RAG_OLLAMA_URL', { default: ollamaUrl }),
        model: envString('RAG_EMBEDDING_MODEL', { default: 'bge-m3' }),
        timeoutMs: envNumber('RAG_EMBEDDING_TIMEOUT_MS', { default: 60_000, min: 1_000 }),
      },
      'local-embedding': {
        model: envString('RAG_LOCAL_EMBEDDING_MODEL', {
          default: 'Xenova/multilingual-e5-small',
        }),
        cacheDir: process.env.RAG_LOCAL_MODEL_DIR ? envString('RAG_LOCAL_MODEL_DIR') : undefined,
        timeoutMs: envNumber('RAG_EMBEDDING_TIMEOUT_MS', { default: 60_000, min: 1_000 }),
        idleMs: envNumber('RAG_LOCAL_IDLE_MS', { default: 600_000, min: 1_000 }),
      },
      'local-rerank': {
        model: envString('RAG_LOCAL_RERANK_MODEL', {
          default: 'onnx-community/bge-reranker-v2-m3-ONNX',
        }),
        cacheDir: process.env.RAG_LOCAL_MODEL_DIR ? envString('RAG_LOCAL_MODEL_DIR') : undefined,
        // The first request downloads ~600 MB and loads it (~100 s on a home connection).
        timeoutMs: envNumber('RAG_RERANK_TIMEOUT_MS', { default: 300_000, min: 1_000 }),
        idleMs: envNumber('RAG_LOCAL_IDLE_MS', { default: 600_000, min: 1_000 }),
      },
    },
  };
}

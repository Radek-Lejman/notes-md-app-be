import { AiConfig } from '../config/ai.config';
import { AgentEvent } from '../types/agent.types';

/** Test helpers shared by AI unit tests. Not used in production code. */
export function makeAiConfig(
  overrides: Partial<Pick<AiConfig, 'llmProvider' | 'agentProvider' | 'embeddingProvider'>> = {},
): AiConfig {
  return {
    llmProvider: 'claude-cli',
    agentProvider: 'claude-agent-sdk',
    embeddingProvider: 'ollama',
    providers: {
      'claude-cli': { bin: 'claude', model: 'sonnet', timeoutMs: 1000 },
      'claude-agent-sdk': { model: 'sonnet', maxTurns: 5, timeoutMs: 1000 },
      ollama: { baseUrl: 'http://ollama', model: 'qwen', timeoutMs: 1000, maxTurns: 5 },
      'ollama-embedding': { baseUrl: 'http://ollama', model: 'bge-m3', timeoutMs: 1000 },
      'local-embedding': {
        model: 'Xenova/multilingual-e5-small',
        timeoutMs: 1000,
        idleMs: 1000,
      },
    },
    ...overrides,
  };
}

/** Async stream of the given items (stands in for SDK/HTTP streams). */
export async function* streamOf<T>(...items: T[]): AsyncGenerator<T> {
  for (const item of items) yield await Promise.resolve(item);
}

export async function collect<T = AgentEvent>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

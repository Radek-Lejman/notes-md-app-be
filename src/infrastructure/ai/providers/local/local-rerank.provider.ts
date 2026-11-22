import { ChildProcess } from 'node:child_process';
import { RerankProvider } from '../../types/rerank.types';
import { LlmProviderError } from '../../errors/llm-provider.error';
import { LocalModelConfig } from '../../config/ai.config';
import { RerankPayload, RerankResult, RerankWorkerConfig } from './local-rerank.model';
import { forkModelWorker, LocalModelClient } from './local-model.client';

export type ForkRerankWorker = (config: RerankWorkerConfig) => ChildProcess;

/** Starts local-rerank.worker with the model settings only (local-model.client.ts). */
export function forkRerankWorker(config: RerankWorkerConfig, file = __filename): ChildProcess {
  return forkModelWorker({
    worker: 'local-rerank.worker',
    envVar: 'LOCAL_RERANK_CONFIG',
    config,
    file,
  });
}

/**
 * A cross-encoder run on this server: note text never leaves the backend. The model runs in
 * a child process started on demand and stopped when idle (LocalModelClient).
 */
export class LocalRerankProvider implements RerankProvider {
  readonly name = 'local' as const;
  private readonly worker: LocalModelClient<RerankPayload, RerankResult>;

  constructor(
    private readonly config: LocalModelConfig,
    fork: ForkRerankWorker = forkRerankWorker,
  ) {
    this.worker = new LocalModelClient({
      fork: () => fork({ model: config.model, cacheDir: config.cacheDir }),
      operation: 'rerank',
      timeoutMs: config.timeoutMs,
      idleMs: config.idleMs,
    });
  }

  get model(): string {
    return this.config.model;
  }

  async rerank(query: string, texts: string[], signal?: AbortSignal): Promise<number[]> {
    if (!texts.length) return [];
    signal?.throwIfAborted();

    const { scores } = await this.worker.request({ query, texts }, signal);
    if (scores.length !== texts.length) {
      throw new LlmProviderError('local', 'rerank returned an unexpected number of scores');
    }
    return scores;
  }

  /** Stops the worker now; its pending requests fail. */
  stop(): void {
    this.worker.stop();
  }
}

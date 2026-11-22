import { ChildProcess } from 'node:child_process';
import { EmbeddingKind, EmbeddingProvider } from '../../types/embedding.types';
import { LlmProviderError } from '../../errors/llm-provider.error';
import { LocalEmbeddingConfig } from '../../config/ai.config';
import { EmbedPayload, EmbedResult, prefixFor, WorkerConfig } from './local-embedding.model';
import { forkModelWorker, LocalModelClient } from './local-model.client';

export type ForkWorker = (config: WorkerConfig) => ChildProcess;

/** Starts local-embedding.worker with the model settings only (local-model.client.ts). */
export function forkWorker(config: WorkerConfig, file = __filename): ChildProcess {
  return forkModelWorker({
    worker: 'local-embedding.worker',
    envVar: 'LOCAL_EMBEDDING_CONFIG',
    config,
    file,
  });
}

/**
 * Embeddings computed on this server: note text never leaves the backend. The model runs in
 * a child process started on demand and stopped when idle (LocalModelClient).
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local' as const;
  private readonly worker: LocalModelClient<EmbedPayload, EmbedResult>;

  constructor(
    private readonly config: LocalEmbeddingConfig,
    fork: ForkWorker = forkWorker,
  ) {
    this.worker = new LocalModelClient({
      fork: () => fork({ model: config.model, cacheDir: config.cacheDir }),
      operation: 'embed',
      timeoutMs: config.timeoutMs,
      idleMs: config.idleMs,
    });
  }

  get model(): string {
    return this.config.model;
  }

  async embed(
    texts: string[],
    signal?: AbortSignal,
    kind: EmbeddingKind = 'document',
  ): Promise<number[][]> {
    if (!texts.length) return [];
    signal?.throwIfAborted();

    const prefix = prefixFor(this.config.model, kind);
    const { vectors } = await this.worker.request(
      { texts: texts.map((text) => prefix + text) },
      signal,
    );
    if (vectors.length !== texts.length) {
      throw new LlmProviderError('local', 'embed returned an unexpected number of vectors');
    }
    return vectors;
  }

  /** Stops the worker now; its pending requests fail. */
  stop(): void {
    this.worker.stop();
  }
}

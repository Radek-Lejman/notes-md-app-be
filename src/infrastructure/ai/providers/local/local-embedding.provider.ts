import { ChildProcess, fork } from 'node:child_process';
import { extname, join } from 'node:path';
import { EmbeddingKind, EmbeddingProvider } from '../../types/embedding.types';
import { LlmProviderError, LlmProviderUnavailableError } from '../../errors/llm-provider.error';
import { LocalEmbeddingConfig } from '../../config/ai.config';
import { prefixFor, WorkerConfig, WorkerRequest, WorkerResponse } from './local-embedding.model';

export type ForkWorker = (config: WorkerConfig) => ChildProcess;

/**
 * Starts local-embedding.worker in a child process. It gets only what it needs in its
 * environment — never the app's secrets. Under ts-node (scripts) the .ts worker is used.
 */
export function forkWorker(config: WorkerConfig, file = __filename): ChildProcess {
  const ext = extname(file);
  const env = Object.fromEntries(
    Object.entries({
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: process.env.NODE_ENV,
      LOCAL_EMBEDDING_CONFIG: JSON.stringify(config),
    }).filter(([, value]) => value !== undefined),
  );
  return fork(join(__dirname, `local-embedding.worker${ext}`), [], {
    env,
    execArgv: ext === '.ts' ? ['-r', 'ts-node/register/transpile-only'] : [],
  });
}

interface Pending {
  resolve: (vectors: number[][]) => void;
  reject: (error: Error) => void;
  /** The worker the request was sent to: only its exit fails the request. */
  worker: ChildProcess;
  /** Clears the timeout and the abort listener. */
  cleanup: () => void;
}

/**
 * Embeddings computed on this server: note text never leaves the backend.
 *
 * The model (~1 GB of memory) lives in a child process started on the first request and
 * stopped after `idleMs` without requests, so the memory is only used (and paid for) while
 * notes are being indexed or searched. A restart costs ~0.5 s.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local' as const;
  private child?: ChildProcess;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private idleTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: LocalEmbeddingConfig,
    private readonly fork: ForkWorker = forkWorker,
  ) {}

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
    const vectors = await this.request(
      texts.map((text) => prefix + text),
      signal,
    );
    if (vectors.length !== texts.length) {
      throw new LlmProviderError('local', 'embed returned an unexpected number of vectors');
    }
    return vectors;
  }

  /** Stops the worker now (also used on idle); its pending requests fail. */
  stop(): void {
    const child = this.child;
    this.child = undefined; // the next request starts a new worker, not the dying one
    clearTimeout(this.idleTimer);
    child?.kill();
  }

  private request(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const child = this.ensureWorker();
    clearTimeout(this.idleTimer);

    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(
        () =>
          this.settle(
            id,
            new LlmProviderError('local', `embed timed out after ${this.config.timeoutMs}ms`),
          ),
        this.config.timeoutMs,
      );
      const onAbort = () => this.settle(id, signal?.reason as Error);
      signal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      this.pending.set(id, { resolve, reject, worker: child, cleanup });

      child.send({ id, texts } satisfies WorkerRequest, (error) => {
        if (error) this.settle(id, new LlmProviderUnavailableError('local', error.message));
      });
    });
  }

  private ensureWorker(): ChildProcess {
    if (this.child) return this.child;

    const child = this.fork({ model: this.config.model, cacheDir: this.config.cacheDir });
    child.on('message', (response: WorkerResponse) => {
      if ('vectors' in response) {
        this.settle(response.id, response.vectors);
        return;
      }
      const ErrorType = response.unavailable ? LlmProviderUnavailableError : LlmProviderError;
      this.settle(response.id, new ErrorType('local', response.error));
    });
    // Without an 'error' listener a failed fork or IPC write would crash the whole backend.
    child.on('error', (error) => this.workerGone(child, `worker error: ${error.message}`));
    child.on('exit', (code) => this.workerGone(child, `worker exited (code ${code})`));
    this.child = child;
    return child;
  }

  /** Fails the requests sent to this worker; the next request starts a new one. */
  private workerGone(child: ChildProcess, reason: string): void {
    if (this.child === child) {
      this.child = undefined;
      clearTimeout(this.idleTimer);
    }
    for (const [id, request] of [...this.pending]) {
      if (request.worker === child) {
        this.settle(id, new LlmProviderUnavailableError('local', reason));
      }
    }
  }

  private settle(id: number, result: number[][] | Error): void {
    const request = this.pending.get(id);
    if (!request) return;

    this.pending.delete(id);
    request.cleanup();
    if (result instanceof Error) request.reject(result);
    else request.resolve(result);

    if (this.pending.size === 0 && this.child) {
      this.idleTimer = setTimeout(() => this.stop(), this.config.idleMs);
      this.idleTimer.unref();
    }
  }
}

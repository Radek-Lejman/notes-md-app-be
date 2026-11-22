import { ChildProcess, fork } from 'node:child_process';
import { extname, join } from 'node:path';
import { LlmProviderError, LlmProviderUnavailableError } from '../../errors/llm-provider.error';
import { isWorkerFailure, WorkerRequest, WorkerResponse } from './local-model.ipc';

export interface ForkModelWorkerOptions {
  /** Entry point next to this file, without the extension, e.g. "local-embedding.worker". */
  worker: string;
  /** Environment variable the worker reads its config from. */
  envVar: string;
  /** Model settings only: they go to the worker's environment. */
  config: object;
  /** The caller's own file: its extension tells compiled (.js) from ts-node (.ts) runs. */
  file: string;
}

/**
 * Starts a model worker in a child process. It gets only what it needs in its environment,
 * never the app's secrets. Under ts-node (scripts) the .ts worker is used.
 */
export function forkModelWorker({ worker, envVar, config, file }: ForkModelWorkerOptions) {
  const ext = extname(file);
  const env = Object.fromEntries(
    Object.entries({
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: process.env.NODE_ENV,
      [envVar]: JSON.stringify(config),
    }).filter(([, value]) => value !== undefined),
  );
  return fork(join(__dirname, `${worker}${ext}`), [], {
    env,
    execArgv: ext === '.ts' ? ['-r', 'ts-node/register/transpile-only'] : [],
  });
}

export interface LocalModelClientOptions {
  fork: () => ChildProcess;
  /** Names the request in error messages, e.g. "embed". */
  operation: string;
  /** Per request; the first one may include the model download. */
  timeoutMs: number;
  /** The worker exits after this long without requests. */
  idleMs: number;
}

interface Pending<Result> {
  resolve: (result: Result) => void;
  reject: (error: Error) => void;
  /** The worker the request was sent to: only its exit fails the request. */
  worker: ChildProcess;
  /** Clears the timeout and the abort listener. */
  cleanup: () => void;
}

/**
 * Talks to a model running in a child process (local-model.serve.ts).
 *
 * A model keeps ~1 GB of native memory that the OS gets back only when its process exits, so
 * the worker starts on the first request and stops after `idleMs` without requests: the memory
 * is only used (and paid for) while it is needed. A restart costs ~0.5 s plus the model load.
 */
export class LocalModelClient<Payload extends object, Result extends object> {
  private child?: ChildProcess;
  private readonly pending = new Map<number, Pending<Result>>();
  private nextId = 0;
  private idleTimer?: NodeJS.Timeout;

  constructor(private readonly options: LocalModelClientOptions) {}

  request(payload: Payload, signal?: AbortSignal): Promise<Result> {
    const child = this.ensureWorker();
    clearTimeout(this.idleTimer);
    const { operation, timeoutMs } = this.options;

    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(
        () =>
          this.settle(
            id,
            new LlmProviderError('local', `${operation} timed out after ${timeoutMs}ms`),
          ),
        timeoutMs,
      );
      const onAbort = () => this.settle(id, signal?.reason as Error);
      signal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      this.pending.set(id, { resolve, reject, worker: child, cleanup });

      child.send({ id, ...payload } satisfies WorkerRequest<Payload>, (error) => {
        if (error) this.settle(id, new LlmProviderUnavailableError('local', error.message));
      });
    });
  }

  /** Stops the worker now (also used on idle); its pending requests fail. */
  stop(): void {
    const child = this.child;
    this.child = undefined; // the next request starts a new worker, not the dying one
    clearTimeout(this.idleTimer);
    child?.kill();
  }

  private ensureWorker(): ChildProcess {
    if (this.child) return this.child;

    const child = this.options.fork();
    child.on('message', (response: WorkerResponse<Result>) => {
      if (!isWorkerFailure(response)) {
        this.settle(response.id, response);
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

  private settle(id: number, result: Result | Error): void {
    const request = this.pending.get(id);
    if (!request) return;

    this.pending.delete(id);
    request.cleanup();
    if (result instanceof Error) request.reject(result);
    else request.resolve(result);

    if (this.pending.size === 0 && this.child) {
      this.idleTimer = setTimeout(() => this.stop(), this.options.idleMs);
      this.idleTimer.unref();
    }
  }
}

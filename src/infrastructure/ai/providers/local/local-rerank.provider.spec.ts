import { EventEmitter } from 'node:events';
import { ChildProcess, fork } from 'node:child_process';
import { LocalModelConfig } from '../../config/ai.config';
import { forkRerankWorker, LocalRerankProvider } from './local-rerank.provider';
import { RerankWorkerRequest, RerankWorkerResponse } from './local-rerank.model';

jest.mock('node:child_process', () => ({ fork: jest.fn() }));

/**
 * Stands in for the worker process. The worker plumbing (timeouts, idle stop, crashes) is
 * LocalModelClient's and is covered by local-embedding.provider.spec.ts.
 */
class FakeWorker extends EventEmitter {
  readonly requests: RerankWorkerRequest[] = [];
  readonly kill = jest.fn();
  send(request: RerankWorkerRequest, callback: (error: Error | null) => void) {
    this.requests.push(request);
    callback(null);
  }
  reply(response: RerankWorkerResponse) {
    this.emit('message', response);
  }
}

describe('LocalRerankProvider', () => {
  const config: LocalModelConfig = {
    model: 'onnx-community/bge-reranker-v2-m3-ONNX',
    cacheDir: '/models',
    timeoutMs: 1_000,
    idleMs: 10_000,
  };
  let worker: FakeWorker;
  const forkFake = jest.fn(() => {
    worker = new FakeWorker();
    return worker as unknown as ChildProcess;
  });
  const provider = () => new LocalRerankProvider(config, forkFake);

  beforeEach(() => forkFake.mockClear());

  it('exposes its name and model', () => {
    expect(provider()).toMatchObject({ name: 'local', model: config.model });
  });

  it('sends the query and the texts to the worker started with the model settings', async () => {
    const result = provider().rerank('q', ['a', 'b']);
    worker.reply({ id: worker.requests[0].id, scores: [0.2, 0.8] });

    await expect(result).resolves.toEqual([0.2, 0.8]);
    expect(forkFake).toHaveBeenCalledWith({ model: config.model, cacheDir: '/models' });
    expect(worker.requests[0]).toMatchObject({ query: 'q', texts: ['a', 'b'] });
  });

  it('returns nothing for no texts without starting the worker', async () => {
    await expect(provider().rerank('q', [])).resolves.toEqual([]);
    expect(forkFake).not.toHaveBeenCalled();
  });

  it('does not start the worker for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(provider().rerank('q', ['a'], controller.signal)).rejects.toThrow();
    expect(forkFake).not.toHaveBeenCalled();
  });

  it('rejects a result with a different number of scores', async () => {
    const result = provider().rerank('q', ['a', 'b']);
    worker.reply({ id: worker.requests[0].id, scores: [1] });
    await expect(result).rejects.toThrow('unexpected number of scores');
  });

  it('names the request in a timeout', async () => {
    jest.useFakeTimers();
    try {
      const result = provider().rerank('q', ['a']);
      jest.advanceTimersByTime(config.timeoutMs);
      await expect(result).rejects.toThrow('rerank timed out after 1000ms');
    } finally {
      jest.useRealTimers();
    }
  });

  it('stop() kills the running worker', async () => {
    const local = provider();
    const result = local.rerank('q', ['a']);
    worker.reply({ id: worker.requests[0].id, scores: [1] });
    await result;

    local.stop();
    expect(worker.kill).toHaveBeenCalled();
  });
});

describe('forkRerankWorker', () => {
  const forkMock = fork as unknown as jest.Mock;

  beforeEach(() => forkMock.mockReset().mockReturnValue('child'));

  it('forks the rerank worker with its config in the environment', () => {
    expect(forkRerankWorker({ model: 'm' }, '/app/dist/local-rerank.provider.js')).toBe('child');

    const [path, , options] = forkMock.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(path).toMatch(/local-rerank\.worker\.js$/);
    expect(options.env.LOCAL_RERANK_CONFIG).toBe(JSON.stringify({ model: 'm' }));
  });

  it('uses the .ts worker when the app runs from sources', () => {
    forkRerankWorker({ model: 'm' });
    const [path] = forkMock.mock.calls[0] as [string];
    expect(path).toMatch(/local-rerank\.worker\.ts$/);
  });
});

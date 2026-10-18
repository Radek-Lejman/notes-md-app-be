import { EventEmitter } from 'node:events';
import { ChildProcess, fork } from 'node:child_process';
import { LlmProviderError, LlmProviderUnavailableError } from '../../errors/llm-provider.error';
import { LocalEmbeddingConfig } from '../../config/ai.config';
import { forkWorker, LocalEmbeddingProvider } from './local-embedding.provider';
import { WorkerRequest, WorkerResponse } from './local-embedding.model';

jest.mock('node:child_process', () => ({ fork: jest.fn() }));

/** Stands in for the worker process: records requests, answers on demand. */
class FakeWorker extends EventEmitter {
  readonly requests: WorkerRequest[] = [];
  /** Set to make the next IPC write fail. */
  sendError?: Error;
  /** Like a real process, it exits asynchronously after kill(). */
  readonly kill = jest.fn();
  send(request: WorkerRequest, callback: (error: Error | null) => void) {
    this.requests.push(request);
    callback(this.sendError ?? null);
  }
  reply(response: WorkerResponse) {
    this.emit('message', response);
  }
  /** Answers the last request with one vector per text. */
  answer() {
    const { id, texts } = this.requests[this.requests.length - 1];
    this.reply({ id, vectors: texts.map((_, i) => [i]) });
  }
}

describe('LocalEmbeddingProvider', () => {
  const config: LocalEmbeddingConfig = {
    model: 'Xenova/multilingual-e5-small',
    cacheDir: '/models',
    timeoutMs: 1_000,
    idleMs: 10_000,
  };
  let workers: FakeWorker[];
  const forkFake = jest.fn(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as ChildProcess;
  });
  const provider = () => new LocalEmbeddingProvider(config, forkFake);
  const worker = () => workers[workers.length - 1];

  beforeEach(() => {
    jest.useFakeTimers();
    workers = [];
    forkFake.mockClear();
  });

  afterEach(() => jest.useRealTimers());

  it('exposes its name and model', () => {
    expect(provider()).toMatchObject({ name: 'local', model: 'Xenova/multilingual-e5-small' });
  });

  it('starts the worker on the first request, with the model settings only', async () => {
    const local = provider();
    expect(forkFake).not.toHaveBeenCalled();

    const result = local.embed(['a', 'b']);
    worker().answer();

    await expect(result).resolves.toEqual([[0], [1]]);
    expect(forkFake).toHaveBeenCalledWith({ model: config.model, cacheDir: '/models' });
    expect(worker().requests[0].texts).toEqual(['passage: a', 'passage: b']);
  });

  it('sends search questions with the query prefix', async () => {
    const result = provider().embed(['jak wdrożyć?'], undefined, 'query');
    worker().answer();
    await result;
    expect(worker().requests[0].texts).toEqual(['query: jak wdrożyć?']);
  });

  it('reuses the running worker', async () => {
    const local = provider();
    for (const text of ['a', 'b']) {
      const result = local.embed([text]);
      worker().answer();
      await result;
    }
    expect(forkFake).toHaveBeenCalledTimes(1);
  });

  it('returns nothing for no texts without starting the worker', async () => {
    await expect(provider().embed([])).resolves.toEqual([]);
    expect(forkFake).not.toHaveBeenCalled();
  });

  it('stops the worker after idleMs without requests and restarts it on demand', async () => {
    const local = provider();
    const first = local.embed(['a']);
    worker().answer();
    await first;

    jest.advanceTimersByTime(config.idleMs - 1);
    expect(worker().kill).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(worker().kill).toHaveBeenCalled();
    worker().emit('exit', null);

    const second = local.embed(['b']);
    worker().answer();
    await expect(second).resolves.toEqual([[0]]);
    expect(forkFake).toHaveBeenCalledTimes(2);
  });

  it('does not stop the worker while a request is pending', async () => {
    const local = new LocalEmbeddingProvider({ ...config, timeoutMs: config.idleMs * 2 }, forkFake);
    const first = local.embed(['a']);
    worker().answer();
    await first;

    const second = local.embed(['b']);
    jest.advanceTimersByTime(config.idleMs);
    expect(worker().kill).not.toHaveBeenCalled();
    worker().answer();
    await second;
  });

  it.each([
    [true, LlmProviderUnavailableError],
    [false, LlmProviderError],
  ])('maps a worker error (unavailable: %s)', async (unavailable, ErrorType) => {
    const result = provider().embed(['a']);
    worker().reply({ id: worker().requests[0].id, error: 'boom', unavailable });

    await expect(result).rejects.toBeInstanceOf(ErrorType);
    await expect(result).rejects.toThrow('boom');
  });

  it('fails pending requests when the worker exits and starts a new one next time', async () => {
    const local = provider();
    const result = local.embed(['a']);
    worker().emit('exit', 1);

    await expect(result).rejects.toBeInstanceOf(LlmProviderUnavailableError);
    await expect(result).rejects.toThrow('worker exited (code 1)');

    const next = local.embed(['b']);
    worker().answer();
    await next;
    expect(forkFake).toHaveBeenCalledTimes(2);
  });

  it('times out a request the worker does not answer', async () => {
    const result = provider().embed(['a']);
    jest.advanceTimersByTime(config.timeoutMs);
    await expect(result).rejects.toThrow('embed timed out after 1000ms');
  });

  it('ignores late or unknown answers', async () => {
    const result = provider().embed(['a']);
    jest.advanceTimersByTime(config.timeoutMs);
    await expect(result).rejects.toThrow('timed out');

    expect(() => worker().answer()).not.toThrow();
  });

  it('rejects a result with a different number of vectors', async () => {
    const result = provider().embed(['a', 'b']);
    worker().reply({ id: worker().requests[0].id, vectors: [[1]] });
    await expect(result).rejects.toThrow('unexpected number of vectors');
  });

  it('stops waiting when the caller aborts', async () => {
    const controller = new AbortController();
    const result = provider().embed(['a'], controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(result).rejects.toThrow('cancelled');
  });

  it('does not start the worker for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(provider().embed(['a'], controller.signal)).rejects.toThrow();
    expect(forkFake).not.toHaveBeenCalled();
  });

  it('fails requests and recovers when the worker emits an error (no crash)', async () => {
    const local = provider();
    const result = local.embed(['a']);
    worker().emit('error', new Error('spawn ENOMEM'));

    await expect(result).rejects.toBeInstanceOf(LlmProviderUnavailableError);
    await expect(result).rejects.toThrow('worker error: spawn ENOMEM');

    const next = local.embed(['b']);
    worker().answer();
    await next;
    expect(forkFake).toHaveBeenCalledTimes(2);
  });

  it('fails a request whose IPC write fails', async () => {
    const local = provider();
    const warmUp = local.embed(['a']);
    worker().answer();
    await warmUp;

    worker().sendError = new Error('channel closed');
    await expect(local.embed(['b'])).rejects.toThrow('channel closed');
  });

  it('sends new requests to a new worker while the stopped one is still exiting', async () => {
    const local = provider();
    const old = local.embed(['a']);
    const oldWorker = worker();
    local.stop();

    const next = local.embed(['b']);
    const newWorker = worker();
    expect(newWorker).not.toBe(oldWorker);

    oldWorker.emit('exit', null); // fails only the request sent to the old worker
    await expect(old).rejects.toThrow('worker exited');
    newWorker.answer();
    await expect(next).resolves.toEqual([[0]]);
  });

  it('removes its abort listener once the request is settled', async () => {
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const result = provider().embed(['a'], controller.signal);
    worker().answer();
    await result;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('stop() without a worker does nothing', () => {
    expect(() => provider().stop()).not.toThrow();
  });
});

describe('forkWorker', () => {
  const forkMock = fork as unknown as jest.Mock;
  const originalEnv = process.env;

  beforeEach(() => {
    forkMock.mockReset().mockReturnValue('child');
    process.env = { ...originalEnv, PATH: '/bin', HOME: '/home/app', JWT_ACCESS_SECRET: 'secret' };
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('forks the compiled worker with a minimal environment (no secrets)', () => {
    expect(forkWorker({ model: 'm' }, '/app/dist/local-embedding.provider.js')).toBe('child');

    const [path, args, options] = forkMock.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string>; execArgv: string[] },
    ];
    expect(path).toMatch(/local-embedding\.worker\.js$/);
    expect(args).toEqual([]);
    expect(options.execArgv).toEqual([]);
    expect(options.env).toEqual({
      PATH: '/bin',
      HOME: '/home/app',
      LOCAL_EMBEDDING_CONFIG: JSON.stringify({ model: 'm' }),
    });
  });

  it('runs the .ts worker through ts-node when the app runs from sources', () => {
    forkWorker({ model: 'm' });

    const [path, , options] = forkMock.mock.calls[0] as [string, string[], { execArgv: string[] }];
    expect(path).toMatch(/local-embedding\.worker\.ts$/);
    expect(options.execArgv).toEqual(['-r', 'ts-node/register/transpile-only']);
  });
});

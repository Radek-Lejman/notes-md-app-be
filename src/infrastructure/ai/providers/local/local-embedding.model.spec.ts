import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import {
  embedWith,
  LoadExtractor,
  loadExtractor,
  prefixFor,
  startWorker,
  WorkerProcess,
  WorkerRequest,
  WorkerResponse,
} from './local-embedding.model';

const pipeline = jest.fn();
const env: { cacheDir?: string } = {};
jest.mock('@huggingface/transformers', () => ({ pipeline, env }));

/** The pipeline returns a tensor; only `tolist()` is used. */
const tensor = (vectors: number[][]) => ({ tolist: () => vectors });

describe('loadExtractor', () => {
  beforeEach(() => {
    pipeline.mockReset().mockResolvedValue('extractor');
    delete env.cacheDir;
  });

  it('creates a quantized feature-extraction pipeline for the model', async () => {
    await expect(loadExtractor({ model: 'Xenova/multilingual-e5-small' })).resolves.toBe(
      'extractor',
    );
    expect(pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/multilingual-e5-small', {
      dtype: 'q8',
    });
    expect(env.cacheDir).toBeUndefined();
  });

  it('uses the configured model directory', async () => {
    await loadExtractor({ model: 'm', cacheDir: '/models' });
    expect(env.cacheDir).toBe('/models');
  });
});

describe('prefixFor', () => {
  it.each([
    ['Xenova/multilingual-e5-small', 'query', 'query: '],
    ['Xenova/multilingual-e5-small', 'document', 'passage: '],
    ['intfloat/e5-base', 'query', 'query: '],
    ['Xenova/all-MiniLM-L6-v2', 'query', ''],
    ['someone/de5-model', 'document', ''],
  ] as const)('%s / %s -> %j', (model, kind, expected) => {
    expect(prefixFor(model, kind)).toBe(expected);
  });
});

describe('embedWith', () => {
  it('uses mean pooling and normalization and returns plain arrays', async () => {
    const extractor = jest.fn().mockResolvedValue(tensor([[1, 0]]));
    await expect(
      embedWith(extractor as unknown as FeatureExtractionPipeline, ['a']),
    ).resolves.toEqual([[1, 0]]);
    expect(extractor).toHaveBeenCalledWith(['a'], { pooling: 'mean', normalize: true });
  });
});

describe('startWorker', () => {
  const extractor = jest.fn();
  const load = jest.fn<ReturnType<LoadExtractor>, Parameters<LoadExtractor>>();
  let onMessage: (message: WorkerRequest) => void;
  let onDisconnect: () => void;
  const sent: WorkerResponse[] = [];
  const exit = jest.fn();
  const proc: WorkerProcess = {
    on: (event: string, listener: never) => {
      if (event === 'message') onMessage = listener;
      else onDisconnect = listener;
    },
    send: (message: WorkerResponse) => sent.push(message),
    exit,
  };
  const config = { model: 'Xenova/multilingual-e5-small' };

  /** Sends a request and waits until the worker answered it. */
  const ask = async (id: number, texts: string[]) => {
    onMessage({ id, texts });
    await new Promise((resolve) => setImmediate(resolve));
    return sent.find((response) => response.id === id);
  };

  beforeEach(() => {
    sent.length = 0;
    extractor.mockReset().mockResolvedValue(tensor([[0.5, 0.5]]));
    load.mockReset().mockResolvedValue(extractor as unknown as FeatureExtractionPipeline);
    startWorker(proc, config, load);
  });

  it('answers each request with its vectors, loading the model once', async () => {
    await expect(ask(1, ['a'])).resolves.toEqual({ id: 1, vectors: [[0.5, 0.5]] });
    await expect(ask(2, ['b'])).resolves.toEqual({ id: 2, vectors: [[0.5, 0.5]] });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(config);
  });

  it('reports a failed load as unavailable and retries it next time', async () => {
    load.mockRejectedValueOnce(new Error('no network'));

    await expect(ask(1, ['a'])).resolves.toEqual({
      id: 1,
      error: 'model load failed: no network',
      unavailable: true,
    });
    await expect(ask(2, ['a'])).resolves.toMatchObject({ id: 2, vectors: [[0.5, 0.5]] });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reports an inference error for that request only', async () => {
    extractor.mockRejectedValueOnce(new Error('bad input'));
    await expect(ask(1, ['a'])).resolves.toEqual({
      id: 1,
      error: 'embed failed: bad input',
      unavailable: false,
    });
  });

  it('loads the real model by default', async () => {
    pipeline.mockReset().mockResolvedValue(extractor);
    startWorker(proc, config);
    await ask(9, ['a']);
    expect(pipeline).toHaveBeenCalledWith('feature-extraction', config.model, { dtype: 'q8' });
  });

  it('exits when the parent disconnects', () => {
    onDisconnect();
    expect(exit).toHaveBeenCalledWith(0);
  });
});

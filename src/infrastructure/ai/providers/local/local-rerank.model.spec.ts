import type { PreTrainedModel, PreTrainedTokenizer } from '@huggingface/transformers';
import {
  CrossEncoder,
  LoadCrossEncoder,
  loadCrossEncoder,
  RerankWorkerProcess,
  RerankWorkerRequest,
  RerankWorkerResponse,
  scoreWith,
  startRerankWorker,
} from './local-rerank.model';

const tokenizerFromPretrained = jest.fn();
const modelFromPretrained = jest.fn();
const env: { cacheDir?: string } = {};
jest.mock('@huggingface/transformers', () => ({
  AutoTokenizer: { from_pretrained: tokenizerFromPretrained },
  AutoModelForSequenceClassification: { from_pretrained: modelFromPretrained },
  env,
}));

/** A fake cross-encoder: the score of a text is its length / 10. */
function fakeEncoder() {
  const tokenizer = jest.fn((queries: string[], { text_pair }: { text_pair: string[] }) => ({
    queries,
    texts: text_pair,
  }));
  const model = jest.fn(({ texts }: { texts: string[] }) =>
    Promise.resolve({
      logits: { sigmoid: () => ({ tolist: () => texts.map((text) => [text.length / 10]) }) },
    }),
  );
  const encoder = {
    tokenizer: tokenizer as unknown as PreTrainedTokenizer,
    model: model as unknown as PreTrainedModel,
  };
  return { encoder, tokenizer, model };
}

describe('loadCrossEncoder', () => {
  beforeEach(() => {
    tokenizerFromPretrained.mockReset().mockResolvedValue('tokenizer');
    modelFromPretrained.mockReset().mockResolvedValue('model');
    delete env.cacheDir;
  });

  it('loads the tokenizer and the quantized classification model', async () => {
    await expect(loadCrossEncoder({ model: 'bge-reranker' })).resolves.toEqual({
      tokenizer: 'tokenizer',
      model: 'model',
    });
    expect(tokenizerFromPretrained).toHaveBeenCalledWith('bge-reranker');
    expect(modelFromPretrained).toHaveBeenCalledWith('bge-reranker', { dtype: 'q8' });
    expect(env.cacheDir).toBeUndefined();
  });

  it('uses the configured model directory', async () => {
    await loadCrossEncoder({ model: 'm', cacheDir: '/models' });
    expect(env.cacheDir).toBe('/models');
  });
});

describe('scoreWith', () => {
  it('scores (query, text) pairs in batches, keeping the order of the texts', async () => {
    const { encoder, tokenizer, model } = fakeEncoder();
    const texts = Array.from({ length: 10 }, (_, i) => 'x'.repeat(i));

    const scores = await scoreWith(encoder, { query: 'q', texts });

    expect(scores).toEqual(texts.map((text) => text.length / 10));
    expect(model).toHaveBeenCalledTimes(2);
    expect(tokenizer).toHaveBeenCalledWith(Array(8).fill('q'), {
      text_pair: texts.slice(0, 8),
      padding: true,
      truncation: true,
      max_length: 512,
    });
  });
});

describe('startRerankWorker', () => {
  const load = jest.fn<ReturnType<LoadCrossEncoder>, Parameters<LoadCrossEncoder>>();
  let onMessage: (message: RerankWorkerRequest) => void;
  let onDisconnect: () => void;
  const sent: RerankWorkerResponse[] = [];
  const exit = jest.fn();
  const proc: RerankWorkerProcess = {
    on: (event: string, listener: never) => {
      if (event === 'message') onMessage = listener;
      else onDisconnect = listener;
    },
    send: (message: RerankWorkerResponse) => sent.push(message),
    exit,
  };
  const config = { model: 'bge-reranker' };
  let encoder: CrossEncoder;

  const ask = async (id: number, texts: string[]) => {
    onMessage({ id, query: 'q', texts });
    await new Promise((resolve) => setImmediate(resolve));
    return sent.find((response) => response.id === id);
  };

  beforeEach(() => {
    sent.length = 0;
    encoder = fakeEncoder().encoder;
    load.mockReset().mockResolvedValue(encoder);
    startRerankWorker(proc, config, load);
  });

  it('answers each request with its scores, loading the model once', async () => {
    await expect(ask(1, ['ab'])).resolves.toEqual({ id: 1, scores: [0.2] });
    await expect(ask(2, ['abc'])).resolves.toEqual({ id: 2, scores: [0.3] });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(config);
  });

  it('reports an inference error as a rerank failure', async () => {
    (encoder.model as unknown as jest.Mock).mockRejectedValueOnce(new Error('bad input'));
    await expect(ask(1, ['a'])).resolves.toEqual({
      id: 1,
      error: 'rerank failed: bad input',
      unavailable: false,
    });
  });

  it('loads the real model by default', async () => {
    tokenizerFromPretrained.mockReset().mockResolvedValue(encoder.tokenizer);
    modelFromPretrained.mockReset().mockResolvedValue(encoder.model);
    startRerankWorker(proc, config);
    await expect(ask(9, ['a'])).resolves.toEqual({ id: 9, scores: [0.1] });
  });

  it('exits when the parent disconnects', () => {
    onDisconnect();
    expect(exit).toHaveBeenCalledWith(0);
  });
});

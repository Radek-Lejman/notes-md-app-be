import type { PreTrainedModel, PreTrainedTokenizer, Tensor } from '@huggingface/transformers';
import { LocalModelConfig } from '../../config/ai.config';
import {
  WorkerProcess as LocalWorkerProcess,
  WorkerRequest as LocalWorkerRequest,
  WorkerResponse as LocalWorkerResponse,
} from './local-model.ipc';
import { serveModel } from './local-model.serve';

/**
 * Model side of the local rerank provider: a cross-encoder that reads the query and a text
 * together and scores their relevance. Runs only in the worker process (local-rerank.worker.ts).
 */

/** Settings the worker needs (sent through its environment, no secrets). */
export type RerankWorkerConfig = Pick<LocalModelConfig, 'model' | 'cacheDir'>;

export interface RerankPayload {
  query: string;
  texts: string[];
}

export interface RerankResult {
  scores: number[];
}

export type RerankWorkerRequest = LocalWorkerRequest<RerankPayload>;
export type RerankWorkerResponse = LocalWorkerResponse<RerankResult>;
export type RerankWorkerProcess = LocalWorkerProcess<RerankPayload, RerankResult>;

export interface CrossEncoder {
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}

export type LoadCrossEncoder = (config: RerankWorkerConfig) => Promise<CrossEncoder>;

/** Pairs per forward pass: bounds the memory of one pass (40 pairs at once would spike it). */
const BATCH_SIZE = 8;
/** BAAI's recommended input length for bge-reranker; a 1500-char chunk plus a question fits. */
const MAX_PAIR_TOKENS = 512;

/** Loads the quantized model with @huggingface/transformers (ONNX runtime, CPU). */
export const loadCrossEncoder: LoadCrossEncoder = async (config) => {
  const { AutoModelForSequenceClassification, AutoTokenizer, env } = await import(
    '@huggingface/transformers'
  );
  if (config.cacheDir) env.cacheDir = config.cacheDir;
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(config.model),
    AutoModelForSequenceClassification.from_pretrained(config.model, { dtype: 'q8' }),
  ]);
  return { tokenizer, model };
};

/** Relevance of each text to the query, 0..1 (sigmoid of the model's logit). */
export async function scoreWith(
  { tokenizer, model }: CrossEncoder,
  { query, texts }: RerankPayload,
): Promise<number[]> {
  const scores: number[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const inputs = tokenizer(
      batch.map(() => query),
      { text_pair: batch, padding: true, truncation: true, max_length: MAX_PAIR_TOKENS },
    );
    const { logits } = (await model(inputs)) as { logits: Tensor };
    scores.push(...(logits.sigmoid().tolist() as number[][]).map(([score]) => score));
  }
  return scores;
}

/** Serves rerank requests from the parent; exits when the parent goes away. */
export function startRerankWorker(
  proc: RerankWorkerProcess,
  config: RerankWorkerConfig,
  load: LoadCrossEncoder = loadCrossEncoder,
): void {
  serveModel(proc, {
    load: () => load(config),
    handle: async (encoder, request) => ({ scores: await scoreWith(encoder, request) }),
    operation: 'rerank',
  });
}

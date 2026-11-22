import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { EmbeddingKind } from '../../types/embedding.types';
import { LocalEmbeddingConfig } from '../../config/ai.config';
import {
  WorkerProcess as LocalWorkerProcess,
  WorkerRequest as LocalWorkerRequest,
  WorkerResponse as LocalWorkerResponse,
} from './local-model.ipc';
import { serveModel } from './local-model.serve';

/**
 * Model side of the local embedding provider. Runs only in the worker process
 * (local-embedding.worker.ts): the model keeps ~1 GB of native memory that the OS gets back
 * only when that process exits.
 */

/** Settings the worker needs (sent through its environment, no secrets). */
export type WorkerConfig = Pick<LocalEmbeddingConfig, 'model' | 'cacheDir'>;

export interface EmbedPayload {
  texts: string[];
}

export interface EmbedResult {
  vectors: number[][];
}

export type WorkerRequest = LocalWorkerRequest<EmbedPayload>;
export type WorkerResponse = LocalWorkerResponse<EmbedResult>;
export type WorkerProcess = LocalWorkerProcess<EmbedPayload, EmbedResult>;

export type LoadExtractor = (config: WorkerConfig) => Promise<FeatureExtractionPipeline>;

/**
 * Loads the model with @huggingface/transformers (ONNX runtime, CPU), downloading it on first
 * use unless it is already in `cacheDir`.
 */
export const loadExtractor: LoadExtractor = async (config) => {
  const { pipeline, env } = await import('@huggingface/transformers');
  if (config.cacheDir) env.cacheDir = config.cacheDir;
  return pipeline('feature-extraction', config.model, { dtype: 'q8' });
};

/** e5 models were trained with these prefixes; other models take the text as is. */
export function prefixFor(model: string, kind: EmbeddingKind): string {
  if (!/(^|[/-])e5-/i.test(model)) return '';
  return kind === 'query' ? 'query: ' : 'passage: ';
}

/** Mean pooling + L2 normalization, so cosine similarity in pgvector works as with Ollama. */
export async function embedWith(
  extractor: FeatureExtractionPipeline,
  texts: string[],
): Promise<number[][]> {
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  return output.tolist() as number[][];
}

/** Serves embedding requests from the parent; exits when the parent goes away. */
export function startWorker(
  proc: WorkerProcess,
  config: WorkerConfig,
  load: LoadExtractor = loadExtractor,
): void {
  serveModel(proc, {
    load: () => load(config),
    handle: async (extractor, { texts }) => ({ vectors: await embedWith(extractor, texts) }),
    operation: 'embed',
  });
}

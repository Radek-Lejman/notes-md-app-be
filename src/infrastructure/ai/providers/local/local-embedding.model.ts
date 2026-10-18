import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { EmbeddingKind } from '../../types/embedding.types';
import { LocalEmbeddingConfig } from '../../config/ai.config';

/**
 * Model side of the local embedding provider. Runs only in the worker process
 * (local-embedding.worker.ts): the model keeps ~1 GB of native memory that the OS gets back
 * only when that process exits.
 */

/** Settings the worker needs (sent through its environment, no secrets). */
export type WorkerConfig = Pick<LocalEmbeddingConfig, 'model' | 'cacheDir'>;

export interface WorkerRequest {
  id: number;
  texts: string[];
}

export type WorkerResponse =
  | { id: number; vectors: number[][] }
  | {
      id: number;
      error: string;
      /** The model could not be loaded at all. */ unavailable: boolean;
    };

/** The parts of `process` the worker uses (an IPC child). */
export interface WorkerProcess {
  on(event: 'message', listener: (message: WorkerRequest) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
  send(message: WorkerResponse): unknown;
  exit(code?: number): unknown;
}

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
  let extractor: Promise<FeatureExtractionPipeline> | undefined;

  proc.on('message', ({ id, texts }) => {
    void (async () => {
      let model: FeatureExtractionPipeline;
      try {
        model = await (extractor ??= load(config));
      } catch (e) {
        extractor = undefined; // retried on the next request
        proc.send({ id, error: `model load failed: ${(e as Error).message}`, unavailable: true });
        return;
      }
      try {
        proc.send({ id, vectors: await embedWith(model, texts) });
      } catch (e) {
        proc.send({ id, error: `embed failed: ${(e as Error).message}`, unavailable: false });
      }
    })();
  });

  proc.on('disconnect', () => proc.exit(0));
}

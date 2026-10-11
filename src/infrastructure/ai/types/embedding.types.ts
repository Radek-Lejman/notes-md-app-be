/** Provider-agnostic text embeddings (used for RAG). */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export type EmbeddingProviderName = 'ollama';

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  /** Stored with every vector; vectors of different models are never compared. */
  readonly model: string;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

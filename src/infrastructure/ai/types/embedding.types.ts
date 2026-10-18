/** Provider-agnostic text embeddings (used for RAG). */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export type EmbeddingProviderName = 'ollama' | 'local';

/** Some models (e5) embed questions and stored text differently. */
export type EmbeddingKind = 'query' | 'document';

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  /** Stored with every vector; vectors of different models are never compared. */
  readonly model: string;
  /** `kind` defaults to 'document' (text to store); use 'query' for a search question. */
  embed(texts: string[], signal?: AbortSignal, kind?: EmbeddingKind): Promise<number[][]>;
}

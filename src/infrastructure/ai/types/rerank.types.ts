/** Provider-agnostic reranking (RAG): scores how well each text answers a query. */
export const RERANK_PROVIDER = Symbol('RERANK_PROVIDER');

export type RerankProviderName = 'local';

/** RAG_RERANK_PROVIDER value that turns reranking off (RERANK_PROVIDER is then null). */
export const RERANK_OFF = 'none';

export interface RerankProvider {
  readonly name: RerankProviderName;
  readonly model: string;
  /** One relevance score per text, in the order of `texts`; higher = more relevant. */
  rerank(query: string, texts: string[], signal?: AbortSignal): Promise<number[]>;
}

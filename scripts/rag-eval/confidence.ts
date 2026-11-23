import { RerankProvider } from '@ai';
import { embeddingText } from '../../src/modules/ai/rag/chunkMarkdown';
import { RagHit } from '../../src/modules/ai/rag/rag.types';

/** How sure the search is that it found something: the best score of each signal. */
export interface Confidence {
  /** Best cosine similarity among the hits; 0 when none passed RAG_MIN_SCORE. */
  semantic: number;
  /** The reranker's score of the top hit; null when reranking is off. */
  rerank: number | null;
}

/**
 * The search keeps only the reranker's order, not its scores, so the top hit is scored again:
 * one pair, a fraction of the search's own rerank.
 */
export async function measureConfidence(
  reranker: RerankProvider | null,
  question: string,
  hits: RagHit[],
): Promise<Confidence> {
  const semantic = Math.max(0, ...hits.map((hit) => hit.score));
  if (!reranker) return { semantic, rerank: null };
  if (!hits.length) return { semantic, rerank: 0 };
  const [rerank] = await reranker.rerank(question, [embeddingText(hits[0])]);
  return { semantic, rerank };
}

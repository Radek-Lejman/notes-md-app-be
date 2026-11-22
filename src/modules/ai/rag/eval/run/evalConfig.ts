import { z } from 'zod';

/** What a retrieval score depends on besides the dataset; recorded with every run. */
export const EvalConfig = z.object({
  embeddingModel: z.string(),
  chunkSize: z.number(),
  chunkOverlap: z.number(),
  /** Semantic hits below it are cut before ranking, so it lowers recall@10 and MRR. */
  minScore: z.number(),
  /** Chunks requested per question (the eval depth, not the chat's RAG_TOP_K). */
  topK: z.number(),
  hybrid: z.boolean(),
  /** Reranker model (RAG_RERANK_PROVIDER); null = none. Runs saved before it read as null. */
  rerankModel: z.string().nullable().default(null),
  /** Chunks the reranker scores (RAG_RERANK_CANDIDATES); null without a reranker. */
  rerankCandidates: z.number().nullable().default(null),
});
export type EvalConfig = z.infer<typeof EvalConfig>;

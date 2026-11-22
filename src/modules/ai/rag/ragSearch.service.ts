import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_PROVIDER, EmbeddingProvider, RERANK_PROVIDER, RerankProvider } from '@ai';
import { AI_MODULE_CONFIG, AiModuleConfig } from '../config/aiModule.config';
import { RagRepository } from './rag.repository';
import { RagHit } from './rag.types';
import { fuseRrf } from './hybridSearch';
import { toTsQuery } from '@database/prisma';
import { embeddingText } from './chunkMarkdown';

/** Semantic search over one user's notes. */
@Injectable()
export class RagSearchService {
  private readonly logger = new Logger(RagSearchService.name);

  constructor(
    @Inject(AI_MODULE_CONFIG) private readonly config: AiModuleConfig,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly repository: RagRepository,
    @Inject(RERANK_PROVIDER) private readonly reranker: RerankProvider | null,
  ) {}

  get enabled(): boolean {
    return this.config.rag.enabled;
  }

  get model(): string {
    return this.embeddings.model;
  }

  /** The reranker's model, or null when results are not reranked (RAG_RERANK_PROVIDER). */
  get rerankModel(): string | null {
    return this.reranker?.model ?? null;
  }

  /**
   * Chunks scoring at least RAG_MIN_SCORE, best first. With RAG_HYBRID, fused with keyword
   * matches of the same question (rag/hybridSearch.ts). With a reranker, the best `limit` of
   * RAG_RERANK_CANDIDATES such chunks by its score. Empty when RAG is disabled.
   */
  async search(userId: string, query: string, limit = this.config.rag.topK): Promise<RagHit[]> {
    if (!this.enabled || !query.trim()) return [];

    const candidates = this.reranker ? Math.max(limit, this.config.rag.rerankCandidates) : limit;
    const hits = await this.retrieve(userId, query, candidates);
    return this.rerank(query, hits, limit);
  }

  private async retrieve(userId: string, query: string, limit: number): Promise<RagHit[]> {
    const model = this.embeddings.model;
    const [vector] = await this.embeddings.embed([query], undefined, 'query');
    const semantic = (await this.repository.search(userId, model, vector, limit)).filter(
      (hit) => hit.score >= this.config.rag.minScore,
    );

    const tsQuery = this.config.rag.hybrid ? toTsQuery(query, 'any') : undefined;
    if (!tsQuery) return semantic;

    const keyword = await this.repository.keywordSearch(userId, model, tsQuery, limit);
    return fuseRrf([semantic, keyword], limit);
  }

  /** Reorders by the reranker's score; keeps the retrieval order if it fails. */
  private async rerank(query: string, hits: RagHit[], limit: number): Promise<RagHit[]> {
    if (!this.reranker || hits.length < 2) return hits.slice(0, limit);
    try {
      const scores = await this.reranker.rerank(query, hits.map(embeddingText));
      return hits
        .map((hit, i) => ({ hit, score: scores[i] }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ hit }) => hit);
    } catch (e) {
      this.logger.warn(`RAG rerank skipped: ${(e as Error).message}`);
      return hits.slice(0, limit);
    }
  }

  /** Like search, but never fails (for optional prompt context). */
  async searchSafe(userId: string, query: string, limit?: number): Promise<RagHit[]> {
    try {
      return await this.search(userId, query, limit);
    } catch (e) {
      this.logger.warn(`RAG search skipped: ${(e as Error).message}`);
      return [];
    }
  }

  stats(userId: string) {
    return this.repository.stats(userId, this.embeddings.model);
  }
}

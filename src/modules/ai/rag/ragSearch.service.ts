import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '@ai';
import { AI_MODULE_CONFIG, AiModuleConfig } from '../config/aiModule.config';
import { RagRepository } from './rag.repository';
import { RagHit } from './rag.types';

/** Semantic search over one user's notes. */
@Injectable()
export class RagSearchService {
  private readonly logger = new Logger(RagSearchService.name);

  constructor(
    @Inject(AI_MODULE_CONFIG) private readonly config: AiModuleConfig,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly repository: RagRepository,
  ) {}

  get enabled(): boolean {
    return this.config.rag.enabled;
  }

  get model(): string {
    return this.embeddings.model;
  }

  /** Chunks scoring at least RAG_MIN_SCORE, best first. Empty when RAG is disabled. */
  async search(userId: string, query: string, limit = this.config.rag.topK): Promise<RagHit[]> {
    if (!this.enabled || !query.trim()) return [];

    const [vector] = await this.embeddings.embed([query]);
    const hits = await this.repository.search(userId, this.embeddings.model, vector, limit);
    return hits.filter((hit) => hit.score >= this.config.rag.minScore);
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

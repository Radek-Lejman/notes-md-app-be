import { AiConfig } from '../config/ai.config';
import { RERANK_OFF, RerankProvider } from '../types/rerank.types';
import { LocalRerankProvider } from './local/local-rerank.provider';

/** Single place that maps RAG_RERANK_PROVIDER -> adapter; null = reranking off. */
export function createRerankProvider(config: AiConfig): RerankProvider | null {
  switch (config.rerankProvider) {
    case RERANK_OFF:
      return null;
    case 'local':
      return new LocalRerankProvider(config.providers['local-rerank']);
    default:
      throw new Error(
        `[config] Unsupported RAG_RERANK_PROVIDER: "${config.rerankProvider as string}"`,
      );
  }
}

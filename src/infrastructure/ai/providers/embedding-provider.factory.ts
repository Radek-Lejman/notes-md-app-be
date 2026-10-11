import { AiConfig } from '../config/ai.config';
import { EmbeddingProvider } from '../types/embedding.types';
import { OllamaEmbeddingProvider } from './ollama/ollama-embedding.provider';

/** Single place that maps RAG_EMBEDDING_PROVIDER -> adapter. */
export function createEmbeddingProvider(config: AiConfig): EmbeddingProvider {
  switch (config.embeddingProvider) {
    case 'ollama':
      return new OllamaEmbeddingProvider(config.providers['ollama-embedding']);
    default:
      throw new Error(
        `[config] Unsupported RAG_EMBEDDING_PROVIDER: "${config.embeddingProvider as string}"`,
      );
  }
}

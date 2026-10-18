import { createEmbeddingProvider } from './embedding-provider.factory';
import { OllamaEmbeddingProvider } from './ollama/ollama-embedding.provider';
import { LocalEmbeddingProvider } from './local/local-embedding.provider';
import { makeAiConfig } from '../testing/ai-test.utils';
import { AiConfig } from '../config/ai.config';

describe('createEmbeddingProvider', () => {
  it('creates the Ollama embedding provider with its own config', () => {
    const provider = createEmbeddingProvider(makeAiConfig());
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    expect(provider.model).toBe('bge-m3');
  });

  it('creates the in-process provider for RAG_EMBEDDING_PROVIDER=local', () => {
    const provider = createEmbeddingProvider(makeAiConfig({ embeddingProvider: 'local' }));
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
    expect(provider.model).toBe('Xenova/multilingual-e5-small');
  });

  it('throws on an unsupported provider', () => {
    const config = { ...makeAiConfig(), embeddingProvider: 'xyz' } as unknown as AiConfig;
    expect(() => createEmbeddingProvider(config)).toThrow(
      'Unsupported RAG_EMBEDDING_PROVIDER: "xyz"',
    );
  });
});

import { createRerankProvider } from './rerank-provider.factory';
import { LocalRerankProvider } from './local/local-rerank.provider';
import { makeAiConfig } from '../testing/ai-test.utils';
import { AiConfig } from '../config/ai.config';

describe('createRerankProvider', () => {
  it('returns no reranker by default (RAG_RERANK_PROVIDER=none)', () => {
    expect(createRerankProvider(makeAiConfig())).toBeNull();
  });

  it('creates the local cross-encoder for RAG_RERANK_PROVIDER=local', () => {
    const provider = createRerankProvider(makeAiConfig({ rerankProvider: 'local' }));
    expect(provider).toBeInstanceOf(LocalRerankProvider);
    expect(provider?.model).toBe('onnx-community/bge-reranker-v2-m3-ONNX');
  });

  it('throws on an unsupported provider', () => {
    const config = { ...makeAiConfig(), rerankProvider: 'xyz' } as unknown as AiConfig;
    expect(() => createRerankProvider(config)).toThrow('Unsupported RAG_RERANK_PROVIDER: "xyz"');
  });
});

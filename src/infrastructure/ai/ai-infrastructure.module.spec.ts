import { Test } from '@nestjs/testing';
import { AiInfrastructureModule } from './ai-infrastructure.module';
import { LLM_PROVIDER } from './types/llm.types';
import { AGENT_PROVIDER } from './types/agent.types';
import { OllamaLlmProvider } from './providers/ollama/ollama-llm.provider';
import { OllamaAgentProvider } from './providers/ollama/ollama-agent.provider';
import { RERANK_PROVIDER } from './types/rerank.types';
import { LocalRerankProvider } from './providers/local/local-rerank.provider';

describe('AiInfrastructureModule', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('provides LLM and agent providers selected by env', async () => {
    process.env.AI_PROVIDER = 'ollama';
    process.env.AI_AGENT_PROVIDER = 'ollama';

    const moduleRef = await Test.createTestingModule({
      imports: [AiInfrastructureModule],
    }).compile();

    expect(moduleRef.get(LLM_PROVIDER)).toBeInstanceOf(OllamaLlmProvider);
    expect(moduleRef.get(AGENT_PROVIDER)).toBeInstanceOf(OllamaAgentProvider);
  });

  it('provides the local reranker by default and none when switched off', async () => {
    delete process.env.RAG_RERANK_PROVIDER;
    const on = await Test.createTestingModule({ imports: [AiInfrastructureModule] }).compile();
    expect(on.get(RERANK_PROVIDER)).toBeInstanceOf(LocalRerankProvider);

    process.env.RAG_RERANK_PROVIDER = 'none';
    const off = await Test.createTestingModule({ imports: [AiInfrastructureModule] }).compile();
    expect(off.get(RERANK_PROVIDER)).toBeNull();
  });

  it('fails to compile with an unsupported provider', async () => {
    process.env.AI_PROVIDER = 'xyz';

    await expect(
      Test.createTestingModule({ imports: [AiInfrastructureModule] }).compile(),
    ).rejects.toThrow('Unsupported AI_PROVIDER');
  });
});

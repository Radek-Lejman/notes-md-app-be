import { Module } from '@nestjs/common';
import { LLM_PROVIDER } from './types/llm.types';
import { AGENT_PROVIDER } from './types/agent.types';
import { AI_CONFIG, AiConfig, loadAiConfig } from './config/ai.config';
import { createLlmProvider } from './providers/llm-provider.factory';
import { createAgentProvider } from './providers/agent-provider.factory';
import { EMBEDDING_PROVIDER } from './types/embedding.types';
import { createEmbeddingProvider } from './providers/embedding-provider.factory';
import { RERANK_PROVIDER } from './types/rerank.types';
import { createRerankProvider } from './providers/rerank-provider.factory';

@Module({
  providers: [
    { provide: AI_CONFIG, useFactory: loadAiConfig },
    {
      provide: LLM_PROVIDER,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig) => createLlmProvider(config),
    },
    {
      provide: AGENT_PROVIDER,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig) => createAgentProvider(config),
    },
    {
      provide: EMBEDDING_PROVIDER,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig) => createEmbeddingProvider(config),
    },
    {
      provide: RERANK_PROVIDER,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig) => createRerankProvider(config),
    },
  ],
  exports: [AI_CONFIG, LLM_PROVIDER, AGENT_PROVIDER, EMBEDDING_PROVIDER, RERANK_PROVIDER],
})
export class AiInfrastructureModule {}

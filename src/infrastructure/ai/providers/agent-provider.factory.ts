import { AiConfig } from '../config/ai.config';
import { AgentProvider } from '../types/agent.types';
import { ClaudeAgentSdkProvider } from './claude-agent-sdk/claude-agent-sdk.provider';
import { OllamaClient } from './ollama/ollama.client';
import { OllamaAgentProvider } from './ollama/ollama-agent.provider';

/**
 * Single place that maps AI_AGENT_PROVIDER -> adapter.
 * To add a provider: implement AgentProvider, add its name to AgentProviderName, add a case here.
 */
export function createAgentProvider(config: AiConfig): AgentProvider {
  switch (config.agentProvider) {
    case 'claude-agent-sdk':
      return new ClaudeAgentSdkProvider(config.providers['claude-agent-sdk']);
    case 'ollama':
      return new OllamaAgentProvider(
        new OllamaClient(config.providers.ollama),
        config.providers.ollama.maxTurns,
      );
    default:
      throw new Error(
        `[config] Unsupported AI_AGENT_PROVIDER: "${config.agentProvider as string}"`,
      );
  }
}

import { AiConfig } from '../config/ai.config';
import { LlmProvider } from '../types/llm.types';
import { ClaudeCliProvider } from './claude-cli/claude-cli.provider';
import { OllamaClient } from './ollama/ollama.client';
import { OllamaLlmProvider } from './ollama/ollama-llm.provider';

/**
 * Single place that maps AI_PROVIDER -> adapter.
 * To add a provider: implement LlmProvider, add its name to LlmProviderName, add a case here.
 */
export function createLlmProvider(config: AiConfig): LlmProvider {
  switch (config.llmProvider) {
    case 'claude-cli':
      return new ClaudeCliProvider(config.providers['claude-cli']);
    case 'ollama':
      return new OllamaLlmProvider(new OllamaClient(config.providers.ollama));
    default:
      throw new Error(`[config] Unsupported AI_PROVIDER: "${config.llmProvider as string}"`);
  }
}

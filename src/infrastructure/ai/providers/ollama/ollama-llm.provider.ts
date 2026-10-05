import { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '../../types/llm.types';
import { OllamaClient } from './ollama.client';
import { OllamaMessage } from './ollama.types';

/** Simple completion against a local Ollama model. No subscription/API costs. */
export class OllamaLlmProvider implements LlmProvider {
  readonly name = 'ollama' as const;

  constructor(private readonly client: OllamaClient) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const startedAt = Date.now();
    const messages: OllamaMessage[] = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push({ role: 'user', content: request.prompt });

    const response = await this.client.chat({ messages, model: request.model });

    return {
      text: response.message.content,
      provider: this.name,
      model: response.model,
      durationMs: Date.now() - startedAt,
    };
  }
}

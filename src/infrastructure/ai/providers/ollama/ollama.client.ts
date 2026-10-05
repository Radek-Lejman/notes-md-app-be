import { OllamaConfig } from '../../config/ai.config';
import { LlmProviderError } from '../../errors/llm-provider.error';
import { OllamaChatResponse, OllamaMessage, OllamaTool } from './ollama.types';

export interface OllamaChatRequest {
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  model?: string;
  signal?: AbortSignal;
}

/** Thin HTTP client for a local Ollama server, shared by the Ollama LLM and agent adapters. */
export class OllamaClient {
  constructor(private readonly config: OllamaConfig) {}

  get defaultModel(): string {
    return this.config.model;
  }

  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const signals = [AbortSignal.timeout(this.config.timeoutMs)];
    if (request.signal) signals.push(request.signal);

    let data: OllamaChatResponse;
    try {
      const res = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model ?? this.config.model,
          messages: request.messages,
          tools: request.tools?.length ? request.tools : undefined,
          think: this.config.think,
          stream: false,
        }),
        signal: AbortSignal.any(signals),
      });
      // Body reads stay inside the try: the timeout signal can also abort them.
      if (!res.ok) {
        throw new LlmProviderError('ollama', `HTTP ${res.status}: ${await res.text()}`);
      }
      data = (await res.json()) as OllamaChatResponse;
    } catch (e) {
      if (e instanceof LlmProviderError) throw e;
      throw new LlmProviderError('ollama', (e as Error).message);
    }

    if (!data?.message) {
      throw new LlmProviderError('ollama', 'response without message');
    }
    data.message.content = stripLeakedReasoning(data.message.content ?? '');
    return data;
  }
}

/**
 * Some model templates (e.g. qwen3 with think=false) emit reasoning into `content`
 * ending with `</think>`. Keep only the answer after the last closing tag.
 */
function stripLeakedReasoning(content: string): string {
  const end = content.lastIndexOf('</think>');
  return (end === -1 ? content : content.slice(end + '</think>'.length)).trim();
}

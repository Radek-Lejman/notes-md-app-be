import { EmbeddingProvider } from '../../types/embedding.types';
import { LlmProviderError, LlmProviderUnavailableError } from '../../errors/llm-provider.error';
import { OllamaEmbeddingConfig } from '../../config/ai.config';

// 404: model not pulled; 502-504: Ollama (or a proxy in front of it) not serving.
const UNAVAILABLE_STATUSES = new Set([404, 502, 503, 504]);

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

/** Embeddings from a local Ollama model (POST /api/embed, batched). */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama' as const;

  constructor(private readonly config: OllamaEmbeddingConfig) {}

  get model(): string {
    return this.config.model;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!texts.length) return [];

    const signals = [AbortSignal.timeout(this.config.timeoutMs), ...(signal ? [signal] : [])];
    let data: OllamaEmbedResponse;
    try {
      const res = await fetch(`${this.config.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, input: texts }),
        signal: AbortSignal.any(signals),
      });
      if (!res.ok) {
        const reason = `embed HTTP ${res.status}: ${await res.text()}`;
        if (UNAVAILABLE_STATUSES.has(res.status)) {
          throw new LlmProviderUnavailableError('ollama', reason);
        }
        throw new LlmProviderError('ollama', reason);
      }
      data = (await res.json()) as OllamaEmbedResponse;
    } catch (e) {
      if (e instanceof LlmProviderError) throw e;
      // Our own timeout: most likely this input is too slow to embed — fail it, not the provider.
      if ((e as Error).name === 'TimeoutError') {
        throw new LlmProviderError('ollama', `embed timed out after ${this.config.timeoutMs}ms`);
      }
      throw new LlmProviderUnavailableError('ollama', `embed failed: ${(e as Error).message}`);
    }

    const embeddings = data.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new LlmProviderError('ollama', 'embed returned an unexpected number of vectors');
    }
    return embeddings;
  }
}

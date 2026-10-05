/**
 * Provider-agnostic LLM contract. Feature modules depend ONLY on this file
 * (via the LLM_PROVIDER token) — never on a concrete adapter.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export type LlmProviderName = 'claude-cli' | 'ollama';
// Next candidates: 'anthropic-api' | 'openai'

export interface LlmCompletionRequest {
  prompt: string;
  systemPrompt?: string;
  /** Overrides the provider's default model. */
  model?: string;
}

export interface LlmCompletionResult {
  text: string;
  provider: LlmProviderName;
  model?: string;
  durationMs: number;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

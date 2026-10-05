// Subset of the Ollama REST API (/api/chat) we rely on.
export type OllamaRole = 'system' | 'user' | 'assistant' | 'tool';

export interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface OllamaMessage {
  role: OllamaRole;
  content: string;
  tool_calls?: OllamaToolCall[];
  /** For role "tool": which tool produced this result. */
  tool_name?: string;
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
}

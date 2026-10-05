import { createLlmProvider } from './llm-provider.factory';
import { ClaudeCliProvider } from './claude-cli/claude-cli.provider';
import { OllamaLlmProvider } from './ollama/ollama-llm.provider';
import { makeAiConfig } from '../testing/ai-test.utils';
import { LlmProviderName } from '../types/llm.types';

describe('createLlmProvider', () => {
  it('creates the Claude CLI provider', () => {
    expect(createLlmProvider(makeAiConfig({ llmProvider: 'claude-cli' }))).toBeInstanceOf(
      ClaudeCliProvider,
    );
  });

  it('creates the Ollama provider', () => {
    expect(createLlmProvider(makeAiConfig({ llmProvider: 'ollama' }))).toBeInstanceOf(
      OllamaLlmProvider,
    );
  });

  it('throws on an unsupported provider', () => {
    const config = makeAiConfig({ llmProvider: 'xyz' as LlmProviderName });
    expect(() => createLlmProvider(config)).toThrow('Unsupported AI_PROVIDER: "xyz"');
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
import { LlmProviderError } from './llm-provider.error';

describe('LlmProviderError', () => {
  it('is a 503 with provider name and reason in the message', () => {
    const error = new LlmProviderError('ollama', 'fetch failed');

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getStatus()).toBe(503);
    expect(error.message).toBe('AI provider "ollama" failed: fetch failed');
  });
});

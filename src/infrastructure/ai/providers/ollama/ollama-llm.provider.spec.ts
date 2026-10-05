import { OllamaLlmProvider } from './ollama-llm.provider';
import { OllamaClient } from './ollama.client';

describe('OllamaLlmProvider', () => {
  const chat = jest.fn();
  const provider = new OllamaLlmProvider({ chat } as unknown as OllamaClient);

  beforeEach(() => {
    chat.mockReset().mockResolvedValue({
      model: 'qwen:resolved',
      done: true,
      message: { role: 'assistant', content: 'answer' },
    });
  });

  it('sends system + user messages and maps the response', async () => {
    const result = await provider.complete({ prompt: 'hi', systemPrompt: 'sys', model: 'qwen' });

    expect(chat).toHaveBeenCalledWith({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      model: 'qwen',
    });
    expect(result).toEqual({
      text: 'answer',
      provider: 'ollama',
      model: 'qwen:resolved',
      durationMs: expect.any(Number) as number,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sends only the user message without a system prompt', async () => {
    await provider.complete({ prompt: 'hi' });
    expect(chat).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'hi' }],
      model: undefined,
    });
  });

  it('propagates client errors', async () => {
    chat.mockRejectedValue(new Error('down'));
    await expect(provider.complete({ prompt: 'hi' })).rejects.toThrow('down');
  });
});

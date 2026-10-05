import { Logger } from '@nestjs/common';
import { LlmProvider } from '@ai';
import { AiService } from './ai.service';
import { DEFAULT_SYSTEM_PROMPT } from '../consts/ai.consts';

describe('AiService', () => {
  const complete = jest.fn();
  const service = new AiService({ name: 'ollama', complete } as unknown as LlmProvider);
  const result = { text: 'answer', provider: 'ollama', model: 'qwen', durationMs: 5 };

  beforeEach(() => {
    complete.mockReset().mockResolvedValue(result);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('calls the provider with the default system prompt and returns its result', async () => {
    await expect(service.complete('hi', 'user-1')).resolves.toBe(result);
    expect(complete).toHaveBeenCalledWith({ prompt: 'hi', systemPrompt: DEFAULT_SYSTEM_PROMPT });
  });

  it('propagates provider errors', async () => {
    complete.mockRejectedValue(new Error('down'));
    await expect(service.complete('hi', 'user-1')).rejects.toThrow('down');
  });
});

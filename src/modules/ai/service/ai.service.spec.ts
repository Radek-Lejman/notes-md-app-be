import { Logger } from '@nestjs/common';
import { LlmProvider } from '@ai';
import { AiService } from './ai.service';
import { ASSIST_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT } from '../consts/ai.consts';

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

  describe('assist', () => {
    it('sends the action and the text as data with the assist system prompt', async () => {
      await service.assist({ action: 'summarize', text: 'Notatka' }, 'user-1');

      const [[request]] = complete.mock.calls as [[{ prompt: string; systemPrompt: string }]];
      expect(request.systemPrompt).toBe(ASSIST_SYSTEM_PROMPT);
      expect(request.prompt).toContain('<selected_text>\nNotatka\n</selected_text>');
    });

    it('writes new content when there is no selected text', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const auth = { kind: 'server' } as const;

      await expect(
        service.assist({ action: 'custom', instruction: 'Write an intro' }, 'user-1', auth),
      ).resolves.toMatchObject({ text: 'answer' });

      expect(complete).toHaveBeenCalledWith(expect.objectContaining({ auth }));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('assist=custom chars=0'));
    });

    it('unwraps an answer the model put in a code fence', async () => {
      complete.mockResolvedValue({ ...result, text: '```markdown\n- a\n- b\n```' });
      await expect(
        service.assist({ action: 'summarize', text: 'x' }, 'user-1'),
      ).resolves.toMatchObject({ text: '- a\n- b' });
    });
  });
});

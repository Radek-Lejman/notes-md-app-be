import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssistDto } from './assist.dto';
import { MAX_ASSIST_INSTRUCTION_LENGTH, MAX_ASSIST_TEXT_LENGTH } from '../consts/ai.consts';

const errorsFor = async (body: object) =>
  (await validate(plainToInstance(AssistDto, body))).map((e) => e.property);

describe('AssistDto', () => {
  it.each([
    ['an action on a text', { action: 'summarize', text: 'Notatka' }],
    ['a custom instruction on a text', { action: 'custom', text: 'x', instruction: 'Shorter' }],
    ['a custom instruction without text', { action: 'custom', instruction: 'Write an intro' }],
  ])('accepts %s', async (_case, body) => {
    await expect(errorsFor(body)).resolves.toEqual([]);
  });

  it.each([
    ['an unknown action', { action: 'delete', text: 'x' }, ['action']],
    ['an action without text', { action: 'explain' }, ['text']],
    ['an empty text', { action: 'fix', text: '' }, ['text']],
    ['a custom action without instruction', { action: 'custom', text: 'x' }, ['instruction']],
    ['an empty instruction', { action: 'custom', instruction: '' }, ['instruction']],
  ])('rejects %s', async (_case, body, properties) => {
    await expect(errorsFor(body)).resolves.toEqual(properties);
  });

  it('limits the text and the instruction length', async () => {
    await expect(
      errorsFor({ action: 'fix', text: 'x'.repeat(MAX_ASSIST_TEXT_LENGTH) }),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({ action: 'fix', text: 'x'.repeat(MAX_ASSIST_TEXT_LENGTH + 1) }),
    ).resolves.toEqual(['text']);
    await expect(
      errorsFor({ action: 'custom', instruction: 'x'.repeat(MAX_ASSIST_INSTRUCTION_LENGTH + 1) }),
    ).resolves.toEqual(['instruction']);
  });
});

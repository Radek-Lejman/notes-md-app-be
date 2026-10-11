import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChatDto } from './chat.dto';
import { MAX_CHAT_MESSAGE_LENGTH, MAX_CHAT_MESSAGES } from '../consts/ai.consts';

const NOTE_ID = '3f0e7d6a-1b2c-4d5e-8f90-123456789abc';

describe('ChatDto', () => {
  const errorsFor = async (body: object) => {
    const errors = await validate(plainToInstance(ChatDto, body));
    return errors.map((e) => e.property);
  };
  const user = (content = 'Hi') => ({ role: 'user', content });

  it('accepts messages with an optional note id', async () => {
    await expect(errorsFor({ messages: [user()] })).resolves.toEqual([]);
    await expect(
      errorsFor({
        messages: [user(), { role: 'assistant', content: 'A' }, user()],
        noteId: NOTE_ID,
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['missing messages', {}],
    ['empty messages', { messages: [] }],
    [
      'too many messages',
      { messages: Array.from({ length: MAX_CHAT_MESSAGES + 1 }, () => user()) },
    ],
    ['unknown role', { messages: [{ role: 'system', content: 'x' }] }],
    ['empty content', { messages: [user('')] }],
    [
      'history ending with an assistant message',
      { messages: [user(), { role: 'assistant', content: 'A' }] },
    ],
    ['too long content', { messages: [user('x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1))] }],
  ])('rejects %s', async (_case, body) => {
    await expect(errorsFor(body)).resolves.toEqual(['messages']);
  });

  it('rejects a note id that is not a uuid', async () => {
    await expect(errorsFor({ messages: [user()], noteId: 'abc' })).resolves.toEqual(['noteId']);
  });
});

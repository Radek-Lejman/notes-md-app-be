import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteDto } from './complete.dto';
import { AgentRunDto } from './agentRun.dto';
import { MAX_PROMPT_LENGTH } from '../consts/ai.consts';

const cases: [string, ClassConstructor<object>, string][] = [
  ['CompleteDto', CompleteDto, 'prompt'],
  ['AgentRunDto', AgentRunDto, 'task'],
];

describe.each(cases)('%s', (_name, Dto, field) => {
  const errorsFor = async (body: object) =>
    (await validate(plainToInstance(Dto, body))).map((e) => e.property);

  it('accepts a valid value', async () => {
    await expect(errorsFor({ [field]: 'Hello' })).resolves.toEqual([]);
  });

  it.each([
    ['missing', {}],
    ['empty', { [field]: '' }],
    ['not a string', { [field]: 123 }],
  ])('rejects %s', async (_case, body) => {
    await expect(errorsFor(body)).resolves.toEqual([field]);
  });

  it(`accepts exactly ${MAX_PROMPT_LENGTH} chars and rejects one more`, async () => {
    await expect(errorsFor({ [field]: 'x'.repeat(MAX_PROMPT_LENGTH) })).resolves.toEqual([]);
    await expect(errorsFor({ [field]: 'x'.repeat(MAX_PROMPT_LENGTH + 1) })).resolves.toEqual([
      field,
    ]);
  });
});

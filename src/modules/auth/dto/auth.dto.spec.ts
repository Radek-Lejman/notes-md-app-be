import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';
import { PASSWORD_MIN_LENGTH } from '../consts/validator.consts';

const errorsFor = async (Dto: ClassConstructor<object>, body: object) =>
  (await validate(plainToInstance(Dto, body))).map((e) => e.property);

describe.each([
  ['RegisterDto', RegisterDto],
  ['LoginDto', LoginDto],
] as const)('%s', (_name, Dto) => {
  const valid = { email: 'alice@example.com', password: 'x'.repeat(PASSWORD_MIN_LENGTH) };

  it(`accepts an email and a password of ${PASSWORD_MIN_LENGTH} characters`, async () => {
    await expect(errorsFor(Dto, valid)).resolves.toEqual([]);
  });

  it.each([
    ['not an email', 'alice'],
    ['missing', undefined],
    ['not a string', 42],
  ])('rejects an email that is %s', async (_case, email) => {
    await expect(errorsFor(Dto, { ...valid, email })).resolves.toEqual(['email']);
  });

  it.each([
    ['too short', 'x'.repeat(PASSWORD_MIN_LENGTH - 1)],
    ['missing', undefined],
    ['not a string', 123456],
  ])('rejects a password that is %s', async (_case, password) => {
    await expect(errorsFor(Dto, { ...valid, password })).resolves.toEqual(['password']);
  });
});

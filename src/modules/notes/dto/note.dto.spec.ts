import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateNoteDto, UpdateNoteDto } from './note.dto';
import { MAX_CONTENT_LENGTH } from '../consts/validator.consts';

const errorsFor = async (Dto: ClassConstructor<object>, body: object) =>
  (await validate(plainToInstance(Dto, body))).map((e) => e.property);

const valid = { title: 'Docker', content: '# Docker\n\nNotatki o **kontenerach**.' };

const invalidContent: [string, unknown][] = [
  ['a Tiptap JSON object (the old format)', { type: 'doc', content: [] }],
  ['a number', 42],
  ['null', null],
];

describe('CreateNoteDto', () => {
  it('accepts a markdown note', async () => {
    await expect(errorsFor(CreateNoteDto, valid)).resolves.toEqual([]);
  });

  it.each(invalidContent)('rejects content given as %s', async (_case, content) => {
    await expect(errorsFor(CreateNoteDto, { ...valid, content })).resolves.toEqual(['content']);
  });

  it('rejects a missing content', async () => {
    await expect(errorsFor(CreateNoteDto, { title: 'Docker' })).resolves.toEqual(['content']);
  });

  it('accepts empty content (a freshly created note)', async () => {
    await expect(errorsFor(CreateNoteDto, { ...valid, content: '' })).resolves.toEqual([]);
  });

  it(`accepts exactly ${MAX_CONTENT_LENGTH} chars and rejects one more`, async () => {
    const at = 'x'.repeat(MAX_CONTENT_LENGTH);
    await expect(errorsFor(CreateNoteDto, { ...valid, content: at })).resolves.toEqual([]);
    await expect(errorsFor(CreateNoteDto, { ...valid, content: `${at}x` })).resolves.toEqual([
      'content',
    ]);
  });

  it.each([
    ['Windows line endings', '# A\r\n\r\nb\r\n', '# A\n\nb\n'],
    ['old Mac line endings', 'a\rb', 'a\nb'],
    ['a byte order mark', '\uFEFF# A', '# A'],
  ])('normalizes %s', (_case, content, expected) => {
    expect(plainToInstance(CreateNoteDto, { ...valid, content }).content).toBe(expected);
    expect(plainToInstance(UpdateNoteDto, { content }).content).toBe(expected);
  });

  it('keeps markdown with HTML, emoji and Polish characters untouched', async () => {
    const content = '## Zażółć <u>gęślą</u> jaźń 🚀\n\n```ts\nconst a = `b`;\n```';
    const dto = plainToInstance(CreateNoteDto, { ...valid, content });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.content).toBe(content);
  });
});

describe('UpdateNoteDto', () => {
  it('accepts a partial update without content', async () => {
    await expect(errorsFor(UpdateNoteDto, { title: 'Nowy tytuł' })).resolves.toEqual([]);
  });

  it('accepts a content-only update', async () => {
    await expect(errorsFor(UpdateNoteDto, { content: '# Nowa treść' })).resolves.toEqual([]);
  });

  // `null` must not slip through as "optional": the column is NOT NULL, so it would end as a 500.
  it.each(invalidContent)('rejects content given as %s', async (_case, content) => {
    await expect(errorsFor(UpdateNoteDto, { content })).resolves.toEqual(['content']);
  });

  it(`rejects content longer than ${MAX_CONTENT_LENGTH} chars`, async () => {
    const content = 'x'.repeat(MAX_CONTENT_LENGTH + 1);
    await expect(errorsFor(UpdateNoteDto, { content })).resolves.toEqual(['content']);
  });
});

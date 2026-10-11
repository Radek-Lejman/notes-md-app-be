import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetNoteQueryDto } from './getNoteQuery.dto';
import { SearchNotesQueryDto } from './searchNotesQueryDto';

/** Like the global ValidationPipe: transform the raw query, then validate it. */
async function parse<T extends object>(Dto: ClassConstructor<T>, query: Record<string, unknown>) {
  const dto = plainToInstance(Dto, query);
  const errors = (await validate(dto)).map((e) => e.property);
  return { dto, errors };
}

describe('GetNoteQueryDto', () => {
  it('defaults to depth 0 and 50 children per parent', async () => {
    const { dto, errors } = await parse(GetNoteQueryDto, {});
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ depth: 0, 'children.limit': 50 });
  });

  it('turns numeric query strings into integers', async () => {
    const { dto, errors } = await parse(GetNoteQueryDto, { depth: '3', 'children.limit': '10' });
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ depth: 3, 'children.limit': 10 });
  });

  it('falls back to the defaults for non-numeric values', async () => {
    const { dto } = await parse(GetNoteQueryDto, { depth: 'deep', 'children.limit': '1.5' });
    expect(dto).toMatchObject({ depth: 0, 'children.limit': 50 });
  });

  it.each([
    ['depth', '11'],
    ['depth', '-1'],
    ['children.limit', '0'],
    ['children.limit', '201'],
    ['expand', 'siblings'],
    ['children.sort', 'title'],
    ['fields', 42],
  ])('rejects %s=%j', async (key, value) => {
    const { errors } = await parse(GetNoteQueryDto, { [key]: value });
    expect(errors).toEqual([key]);
  });

  it('accepts the documented options', async () => {
    const { errors } = await parse(GetNoteQueryDto, {
      depth: '10',
      expand: 'parent',
      fields: 'title',
      'children.fields': 'title,updatedAt',
      'children.limit': '200',
      'children.sort': '-updatedAt',
    });
    expect(errors).toEqual([]);
  });
});

describe('SearchNotesQueryDto', () => {
  it('requires a query of at least 2 characters', async () => {
    expect((await parse(SearchNotesQueryDto, {})).errors).toEqual(['q']);
    expect((await parse(SearchNotesQueryDto, { q: 'a' })).errors).toEqual(['q']);
    expect((await parse(SearchNotesQueryDto, { q: 'ab' })).errors).toEqual([]);
  });

  it('defaults to 50 results and parses the limit', async () => {
    expect((await parse(SearchNotesQueryDto, { q: 'ab' })).dto.limit).toBe(50);
    expect((await parse(SearchNotesQueryDto, { q: 'ab', limit: '5' })).dto.limit).toBe(5);
  });

  it.each([
    ['limit', '0'],
    ['limit', '201'],
    ['order', 'random'],
    ['cursor', 7],
  ])('rejects %s=%j', async (key, value) => {
    expect((await parse(SearchNotesQueryDto, { q: 'ab', [key]: value })).errors).toEqual([key]);
  });

  it.each(['rank', '-rank', 'createdAt', '-title', 'updatedAt'])(
    'accepts order=%s',
    async (order) => {
      expect((await parse(SearchNotesQueryDto, { q: 'ab', order })).errors).toEqual([]);
    },
  );
});

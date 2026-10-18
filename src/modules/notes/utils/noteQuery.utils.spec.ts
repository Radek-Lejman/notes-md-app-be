import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './searchCursorPayload';
import { validateAndNormalizeFields } from './validateNoteFields';
import { buildNoteSearchOrderBy } from './orderByForSearch';
import { clampDepth } from './note.utils';
import { AdapterTreeNotes } from './notesToTree';
import { Note } from '../interfaces/notes.interface';
import { ALLOWED_NOTE_FIELDS } from '../consts/allowedNoteFields';

describe('search cursor', () => {
  it('round-trips through an opaque base64 string', () => {
    const cursor = encodeCursor({ id: 'n1', order: '-updatedAt' });

    expect(cursor).not.toContain('n1');
    expect(decodeCursor(cursor)).toEqual({ id: 'n1', order: '-updatedAt' });
  });

  it.each([
    ['nothing', undefined],
    ['an empty string', ''],
    ['not base64 JSON', '%%%'],
    ['JSON null', Buffer.from('null').toString('base64')],
    ['a cursor without an id', Buffer.from('{"order":"updatedAt"}').toString('base64')],
    ['a numeric id', Buffer.from('{"id":1,"order":"updatedAt"}').toString('base64')],
    ['an unsupported order', Buffer.from('{"id":"n1","order":"title"}').toString('base64')],
  ])('ignores %s', (_case, raw) => {
    expect(decodeCursor(raw)).toBeUndefined();
  });
});

describe('validateAndNormalizeFields', () => {
  it('accepts every allowed field and removes duplicates', () => {
    expect(validateAndNormalizeFields('title,content,title')).toEqual(['title', 'content']);
    expect(validateAndNormalizeFields(ALLOWED_NOTE_FIELDS.join(','))).toEqual([
      ...ALLOWED_NOTE_FIELDS,
    ]);
  });

  it('accepts a missing field list', () => {
    expect(validateAndNormalizeFields(undefined)).toEqual([]);
    expect(validateAndNormalizeFields('')).toEqual([]);
  });

  it.each(['id', 'password', 'contentLegacy', 'ragIndexedAt', '__proto__'])(
    'rejects %s with 400 naming the parameter',
    (field) => {
      expect(() => validateAndNormalizeFields(`title,${field}`, 'children.fields')).toThrow(
        new BadRequestException(
          `Forbidden field "${field}" requested in 'children.fields' query param`,
        ),
      );
    },
  );
});

describe('buildNoteSearchOrderBy', () => {
  // rank/-rank are ranked in the database (NotesPgRepository.searchNotesDb), never by Prisma.
  it('rejects rank ordering', () => {
    expect(() => buildNoteSearchOrderBy('rank')).toThrow('Invalid sort field: "rank"');
  });

  it.each([
    [undefined, { updatedAt: 'asc' }],
    ['title', { title: 'asc' }],
    ['-createdAt', { createdAt: 'desc' }],
  ] as const)('maps %s to a plain sort', (order, expected) => {
    expect(buildNoteSearchOrderBy(order)).toEqual(expected);
  });
});

describe('clampDepth', () => {
  it.each([
    [undefined, 0],
    [-1, 0],
    [NaN, 0],
    ['abc', 0],
    [0, 0],
    [3, 3],
    ['4', 4],
    [10, 10],
    [11, 10],
    [1000, 10],
  ])('%j -> %j', (input, expected) => {
    expect(clampDepth(input)).toBe(expected);
  });
});

describe('AdapterTreeNotes', () => {
  const note = {
    id: 'n1',
    parentId: undefined,
    title: 'Docker',
    content: '# Docker',
  } as unknown as Note;

  it('moves id and parent into the node and keeps the rest as data', () => {
    expect(AdapterTreeNotes.toTree(note)).toEqual({
      id: 'n1',
      parentId: null,
      children: [],
      data: { title: 'Docker', content: '# Docker' },
    });
  });

  it('flattens a tree back into nested notes', () => {
    const child = { id: 'c1', parentId: 'n1', title: 'Child' } as unknown as Note;
    const tree = {
      ...AdapterTreeNotes.toTree(note),
      children: [AdapterTreeNotes.toTree(child)],
    };

    expect(AdapterTreeNotes.fromTree(tree)).toEqual({
      id: 'n1',
      parentId: null,
      title: 'Docker',
      content: '# Docker',
      children: [{ id: 'c1', parentId: 'n1', title: 'Child', children: [] }],
    });
  });
});

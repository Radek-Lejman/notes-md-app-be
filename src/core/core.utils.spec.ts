import { buildOrderBy, SortDir } from './sort';
import { createPerKeyLimiter, fromStringToArray } from './utils';
import { buildFieldSelector } from './selector/utils';

describe('buildOrderBy', () => {
  const allowed = ['createdAt', 'title'] as const;

  it('sorts by the default field ascending when no sort is given', () => {
    expect(buildOrderBy(undefined, 'createdAt')).toEqual({ createdAt: SortDir.ASC });
  });

  it.each([
    ['title', { title: 'asc' }],
    ['-title', { title: 'desc' }],
    ['-createdAt', { createdAt: 'desc' }],
  ] as const)('maps %s to %j', (sort, expected) => {
    expect(buildOrderBy(sort, 'createdAt', allowed)).toEqual(expected);
  });

  it('rejects a field outside the allow-list', () => {
    expect(() => buildOrderBy('-password' as 'title', 'createdAt', allowed)).toThrow(
      'Invalid sort field: "password". Allowed: createdAt, title',
    );
  });

  it('accepts any field without an allow-list', () => {
    expect(buildOrderBy('-anything', 'createdAt')).toEqual({ anything: 'desc' });
  });
});

describe('createPerKeyLimiter', () => {
  it('allows up to the limit per key, independently for each key', () => {
    const { allow } = createPerKeyLimiter(2);

    expect([allow('a'), allow('a'), allow('a')]).toEqual([true, true, false]);
    expect(allow('b')).toBe(true);
  });

  it.each([null, undefined, ''])('never allows an empty key %j', (key) => {
    expect(createPerKeyLimiter(5).allow(key)).toBe(false);
  });

  it('allows nothing with a limit of 0', () => {
    expect(createPerKeyLimiter(0).allow('a')).toBe(false);
  });
});

describe('fromStringToArray', () => {
  it('splits a comma-separated list without trimming', () => {
    expect(fromStringToArray('title,content')).toEqual(['title', 'content']);
    expect(fromStringToArray('title, content')).toEqual(['title', ' content']);
  });

  it.each([undefined, ''])('returns null for %j', (value) => {
    expect(fromStringToArray(value)).toBeNull();
  });
});

describe('buildFieldSelector', () => {
  it('selects every listed field', () => {
    expect(buildFieldSelector(['title', 'content'])).toEqual({ title: true, content: true });
  });

  it('selects nothing for an empty list', () => {
    expect(buildFieldSelector([])).toEqual({});
  });
});

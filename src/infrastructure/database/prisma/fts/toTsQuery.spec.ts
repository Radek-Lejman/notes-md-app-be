import { toTsQuery } from './toTsQuery';

describe('toTsQuery', () => {
  it.each([
    ['tes', 'tes:*'],
    ['foo bar', 'foo:* & bar:*'],
    ['  foo \t\n bar  ', 'foo:* & bar:*'],
    ['Zażółć gęślą', 'Zażółć:* & gęślą:*'],
    ['docker-compose v2_1', 'docker-compose:* & v2_1:*'],
  ])('%j -> %j', (input, expected) => {
    expect(toTsQuery(input)).toBe(expected);
  });

  it('normalizes compatibility characters (NFKC)', () => {
    expect(toTsQuery('ﬁle ２０２６')).toBe('file:* & 2026:*');
  });

  it.each([
    // Leftovers without a letter or digit ("-" from "<->", "--") are dropped.
    ["a & b | !c <-> (d) :* 'e'", 'a:* & b:* & c:* & d:* & e:*'],
    ['x\'); DROP TABLE "Note"; --', 'x:* & DROP:* & TABLE:* & Note:*'],
  ])('strips tsquery operators and quotes from %j', (input, expected) => {
    expect(toTsQuery(input)).toBe(expected);
  });

  it.each(['', '   ', '!!! ??? &&&', '()', '- -- _'])(
    'returns undefined without words: %j',
    (input) => {
      expect(toTsQuery(input)).toBeUndefined();
    },
  );
});

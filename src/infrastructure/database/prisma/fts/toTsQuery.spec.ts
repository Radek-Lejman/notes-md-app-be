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
    // A lone "-" (from "<->") survives as a word: harmless for plainto_tsquery (FTS filter);
    // its effect on to_tsquery in order=rank is covered by DB integration tests (audit §4).
    ["a & b | !c <-> (d) :* 'e'", 'a:* & b:* & c:* & -:* & d:* & e:*'],
    ['x\'); DROP TABLE "Note"; --', 'x:* & DROP:* & TABLE:* & Note:* & --:*'],
  ])('strips tsquery operators and quotes from %j', (input, expected) => {
    expect(toTsQuery(input)).toBe(expected);
  });

  it.each(['', '   ', '!!! ??? &&&', '()'])('returns undefined without words: %j', (input) => {
    expect(toTsQuery(input)).toBeUndefined();
  });
});

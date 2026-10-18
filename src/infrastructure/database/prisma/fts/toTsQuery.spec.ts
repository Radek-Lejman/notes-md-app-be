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

  describe("'any' mode (natural questions)", () => {
    it('joins words with OR and drops words shorter than 3 characters', () => {
      expect(toTsQuery('gdzie jedziemy na wakacje w 2026?', 'any')).toBe(
        'gdzie:* | jedziemy:* | wakacje:* | 2026:*',
      );
    });

    it('counts characters, not UTF-16 units', () => {
      expect(toTsQuery('żó ąęś', 'any')).toBe('ąęś:*');
    });

    it('keeps upper-case two-letter acronyms', () => {
      expect(toTsQuery('AI w JS i Go na m2', 'any')).toBe('AI:* | JS:*');
    });

    it('returns undefined when only short words remain', () => {
      expect(toTsQuery('a w na', 'any')).toBeUndefined();
    });
  });
});

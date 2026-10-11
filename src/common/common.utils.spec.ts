import { plainToInstance } from 'class-transformer';
import { daysToSeconds, minutesToSeconds, toSeconds } from './utils/time';
import { toInt, ToInt } from './transformers/number.transformers';

describe('toSeconds', () => {
  it.each([
    ['1m', 60],
    ['15m', 900],
    ['7d', 604_800],
    ['1500ms', 1],
  ])('%s -> %i', (expr, seconds) => {
    expect(toSeconds(expr)).toBe(seconds);
  });

  it('rejects an invalid expression', () => {
    expect(() => toSeconds('soon')).toThrow('Invalid time expression: soon');
  });
});

describe('minutesToSeconds / daysToSeconds', () => {
  it('convert to whole seconds', () => {
    expect(minutesToSeconds(15)).toBe(900);
    expect(daysToSeconds(7)).toBe(604_800);
  });

  it.each([
    [undefined, 'must be defined'],
    [-1, 'must be a non-negative finite number'],
    [Infinity, 'must be a non-negative finite number'],
    [NaN, 'must be defined'],
  ])('reject %j', (value, message) => {
    expect(() => minutesToSeconds(value)).toThrow(`minutes ${message}`);
    expect(() => daysToSeconds(value)).toThrow(`days ${message}`);
  });

  // D7: 0 is falsy, so it is reported as missing even though the message allows non-negative values.
  it('D7 (current behaviour): treat 0 as missing', () => {
    expect(() => minutesToSeconds(0)).toThrow('minutes must be defined');
    expect(() => daysToSeconds(0)).toThrow('days must be defined');
  });
});

describe('toInt', () => {
  it.each([
    [5, 5],
    [-3, -3],
    ['42', 42],
    [' 7 ', 7],
    ['-12', -12],
  ])('parses %j as %i', (value, expected) => {
    expect(toInt(value, 0)).toBe(expected);
  });

  it.each([1.5, '1.5', '1e3', '0x10', 'abc', '', null, undefined, {}, [1]])(
    'falls back to the default for %j',
    (value) => {
      expect(toInt(value, 99)).toBe(99);
    },
  );
});

describe('@ToInt', () => {
  class Query {
    @ToInt(10)
    limit = 10;

    @ToInt()
    offset = 0;
  }

  it('transforms query strings into integers with the given default', () => {
    expect(plainToInstance(Query, { limit: '25', offset: 'x' })).toMatchObject({
      limit: 25,
      offset: 0,
    });
    expect(plainToInstance(Query, { limit: 'many' }).limit).toBe(10);
  });
});

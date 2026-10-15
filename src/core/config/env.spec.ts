import { envBoolean, envNumber, envSecret, envString } from './env';

type EnvModule = typeof import('./env');

/** env.ts reads NODE_ENV at import time; production cases need a fresh copy. */
function loadInProduction(): EnvModule {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    let mod!: EnvModule;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module cache
      mod = require('./env') as EnvModule;
    });
    return mod;
  } finally {
    process.env.NODE_ENV = original;
  }
}

describe('env helpers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TEST_VAR;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('envString', () => {
    it('returns the trimmed value', () => {
      process.env.TEST_VAR = '  value  ';
      expect(envString('TEST_VAR')).toBe('value');
    });

    it.each([undefined, '', '   '])('treats %j as missing: default or error', (value) => {
      if (value !== undefined) process.env.TEST_VAR = value;

      expect(envString('TEST_VAR', { default: 'fallback' })).toBe('fallback');
      expect(() => envString('TEST_VAR')).toThrow('[config] TEST_VAR is required');
    });

    it('enforces a minimum length', () => {
      process.env.TEST_VAR = 'abc';
      expect(() => envString('TEST_VAR', { minLength: 4 })).toThrow('at least 4 characters');
      expect(envString('TEST_VAR', { minLength: 3 })).toBe('abc');
    });

    it('accepts an empty-string default', () => {
      expect(envString('TEST_VAR', { default: '' })).toBe('');
    });
  });

  describe('envNumber', () => {
    it('parses numbers within bounds', () => {
      process.env.TEST_VAR = '42.5';
      expect(envNumber('TEST_VAR', { min: 0, max: 100 })).toBe(42.5);
    });

    it.each([
      ['abc', 'must be a finite number'],
      ['Infinity', 'must be a finite number'],
      ['-1', 'must be >= 0'],
      ['101', 'must be <= 100'],
    ])('rejects %s', (value, message) => {
      process.env.TEST_VAR = value;
      expect(() => envNumber('TEST_VAR', { min: 0, max: 100 })).toThrow(message);
    });

    it('accepts the bounds themselves and uses the default when unset', () => {
      process.env.TEST_VAR = '0';
      expect(envNumber('TEST_VAR', { min: 0 })).toBe(0);
      delete process.env.TEST_VAR;
      expect(envNumber('TEST_VAR', { default: 7, min: 1 })).toBe(7);
    });
  });

  describe('envBoolean', () => {
    it.each(['1', 'true', 'YES', 'on'])('reads %s as true', (value) => {
      process.env.TEST_VAR = value;
      expect(envBoolean('TEST_VAR')).toBe(true);
    });

    it.each(['0', 'False', 'no', 'OFF'])('reads %s as false', (value) => {
      process.env.TEST_VAR = value;
      expect(envBoolean('TEST_VAR')).toBe(false);
    });

    it('rejects anything else and keeps a false default', () => {
      process.env.TEST_VAR = 'maybe';
      expect(() => envBoolean('TEST_VAR')).toThrow('must be boolean');
      delete process.env.TEST_VAR;
      expect(envBoolean('TEST_VAR', { default: false })).toBe(false);
    });
  });

  describe('envSecret', () => {
    it('returns a secret of at least 32 bytes', () => {
      process.env.TEST_VAR = 's'.repeat(32);
      expect(envSecret('TEST_VAR')).toBe('s'.repeat(32));
    });

    it('measures the length in bytes, not characters', () => {
      process.env.TEST_VAR = 'ą'.repeat(16); // 32 bytes in UTF-8
      expect(envSecret('TEST_VAR')).toBe('ą'.repeat(16));
    });

    it('rejects a short secret, also from the fallback', () => {
      process.env.TEST_VAR = 'short';
      expect(() => envSecret('TEST_VAR')).toThrow('must be at least 32 bytes');
      delete process.env.TEST_VAR;
      expect(() => envSecret('TEST_VAR', 'short-fallback')).toThrow('must be at least 32 bytes');
    });

    it('uses the dev fallback outside production', () => {
      expect(envSecret('TEST_VAR', 'f'.repeat(32))).toBe('f'.repeat(32));
      expect(() => envSecret('TEST_VAR')).toThrow(
        '[config] TEST_VAR is required (copy .env.example to .env)',
      );
    });

    it('honours a custom minimum', () => {
      process.env.TEST_VAR = 'abcd';
      expect(envSecret('TEST_VAR', undefined, 4)).toBe('abcd');
    });
  });

  describe('in production', () => {
    it('envSecret rejects the .env.example placeholders', () => {
      const env = loadInProduction();
      process.env.TEST_VAR = 'change-me-at-least-32-bytes-long-secret';
      expect(() => env.envSecret('TEST_VAR')).toThrow(
        '[config] TEST_VAR still holds the .env.example placeholder',
      );
    });

    it('envSecret ignores the dev fallback', () => {
      const env = loadInProduction();
      expect(env.isProd).toBe(true);
      expect(() => env.envSecret('TEST_VAR', 'f'.repeat(32))).toThrow(
        '[config] TEST_VAR is required in production',
      );
    });

    it('requiredInProd wins over the default', () => {
      const env = loadInProduction();
      expect(() => env.envString('TEST_VAR', { default: 'x', requiredInProd: true })).toThrow(
        'TEST_VAR is required in production',
      );
      expect(env.envString('TEST_VAR', { default: 'x' })).toBe('x');
    });
  });
});

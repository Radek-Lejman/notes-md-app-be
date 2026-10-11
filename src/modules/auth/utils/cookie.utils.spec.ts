import { Response } from 'express';
import { calculateExpiresAt } from './expiresIn';

type CookieUtils = typeof import('./cookie.utils');

/** cookie.utils reads NODE_ENV and token lifetimes at import time. */
function load(env: Record<string, string> = {}): CookieUtils {
  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'r'.repeat(32),
    JWT_ACCESS_EXPIRE_IN: '15',
    JWT_REFRESH_EXPIRE_IN: '7',
    ...env,
  };
  try {
    let utils!: CookieUtils;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module cache per case
      utils = require('./cookie.utils') as CookieUtils;
    });
    return utils;
  } finally {
    process.env = originalEnv;
  }
}

const setCookies = (fn: (res: Response) => void) => {
  const setHeader = jest.fn<void, [string, string[]]>();
  fn({ setHeader } as unknown as Response);
  expect(setHeader).toHaveBeenCalledWith('Set-Cookie', expect.any(Array));
  return setHeader.mock.calls[0][1];
};

describe('setAuthCookies', () => {
  it('sets an httpOnly access cookie on / and a refresh cookie scoped to the refresh route', () => {
    const { setAuthCookies } = load();

    const [access, refresh] = setCookies((res) => setAuthCookies(res, 'acc.jwt', 'ref.jwt'));

    expect(access).toBe('access_token=acc.jwt; Max-Age=900; Path=/; HttpOnly; SameSite=Lax');
    expect(refresh).toBe(
      'refresh_token=ref.jwt; Max-Age=604800; Path=/api/auth/refresh; HttpOnly; SameSite=Lax',
    );
  });

  it('expires a cookie whose token is missing', () => {
    const { setAuthCookies } = load();

    const [access, refresh] = setCookies((res) => setAuthCookies(res, 'acc.jwt'));

    expect(access).toContain('Max-Age=900');
    expect(refresh).toBe(
      'refresh_token=; Max-Age=0; Path=/api/auth/refresh; HttpOnly; SameSite=Lax',
    );
  });

  it('marks cookies Secure and SameSite=Strict in production', () => {
    const { setAuthCookies } = load({ NODE_ENV: 'production' });

    setCookies((res) => setAuthCookies(res, 'acc.jwt', 'ref.jwt')).forEach((cookie) => {
      expect(cookie).toContain('; Secure');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('HttpOnly');
    });
  });
});

describe('clearAuthCookies', () => {
  it('expires both cookies, plus a refresh cookie left on / by older versions', () => {
    const { clearAuthCookies } = load();

    expect(setCookies((res) => clearAuthCookies(res))).toEqual([
      'access_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
      'refresh_token=; Max-Age=0; Path=/api/auth/refresh; HttpOnly; SameSite=Lax',
      'refresh_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
    ]);
  });

  it('keeps the production flags so browsers match and delete the cookies', () => {
    const { clearAuthCookies } = load({ NODE_ENV: 'production' });

    setCookies((res) => clearAuthCookies(res)).forEach((cookie) => {
      expect(cookie).toContain('; Secure');
      expect(cookie).toContain('SameSite=Strict');
    });
  });
});

describe('calculateExpiresAt', () => {
  it('adds the lifetime in days to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(calculateExpiresAt('7d', now)).toEqual(new Date('2026-01-08T00:00:00Z'));
  });

  it('defaults to the current time', () => {
    const before = Date.now();
    const expiresAt = calculateExpiresAt('1d').getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(86_400_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(86_400_000);
  });
});

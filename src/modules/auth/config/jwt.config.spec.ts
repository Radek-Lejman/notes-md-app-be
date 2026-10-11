type JwtConfigModule = typeof import('./jwt.config');
type RefreshConfigModule = typeof import('./refreshJwt.config');

/** Both configs read env at import time, so each case loads them fresh. */
function load(env: Record<string, string>) {
  const originalEnv = process.env;
  process.env = { ...originalEnv, ...env };
  try {
    let modules!: { access: JwtConfigModule; refresh: RefreshConfigModule };
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports -- fresh module cache per case */
      modules = {
        access: require('./jwt.config') as JwtConfigModule,
        refresh: require('./refreshJwt.config') as RefreshConfigModule,
      };
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
    return modules;
  } finally {
    process.env = originalEnv;
  }
}

const SECRETS = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'r'.repeat(32),
};

describe('JWT configs', () => {
  it('default to a 15 min access token and a 7 day refresh token', () => {
    const { access, refresh } = load({ ...SECRETS });

    expect(access.default()).toEqual({ secret: 'a'.repeat(32), expiresIn: '15m' });
    expect(refresh.default()).toEqual({ secret: 'r'.repeat(32), expiresIn: '7d' });
    expect(access.accessTokenExpireIn).toBe(15);
    expect(refresh.refreshTokenExpireIn).toBe(7);
  });

  it('read lifetimes from env', () => {
    const { access, refresh } = load({
      ...SECRETS,
      JWT_ACCESS_EXPIRE_IN: '30',
      JWT_REFRESH_EXPIRE_IN: '14',
    });

    expect(access.default().expiresIn).toBe('30m');
    expect(refresh.default().expiresIn).toBe('14d');
  });

  it('use separate secrets for access and refresh tokens', () => {
    const { access, refresh } = load({ ...SECRETS });
    expect(access.default().secret).not.toBe(refresh.default().secret);
  });

  it.each([
    ['JWT_ACCESS_EXPIRE_IN', '0', 'must be >= 1'],
    ['JWT_ACCESS_EXPIRE_IN', '61', 'must be <= 60'],
    ['JWT_REFRESH_EXPIRE_IN', '61', 'must be <= 60'],
    ['JWT_REFRESH_EXPIRE_IN', 'week', 'must be a finite number'],
    ['JWT_ACCESS_SECRET', 'short', 'must be at least 32 bytes'],
  ])('reject %s=%s', (key, value, message) => {
    expect(() => load({ ...SECRETS, [key]: value })).toThrow(message);
  });

  // D12: the dev fallbacks ('default-access-secret', 'default-refresh-secret') are shorter than
  // the 32 bytes envSecret() requires, so without JWT_*_SECRET the app does not start even in dev.
  it.failing('D12: fall back to dev secrets outside production', () => {
    const { access, refresh } = load({ JWT_ACCESS_SECRET: '', JWT_REFRESH_SECRET: '' });
    expect(access.default().secret).toBeTruthy();
    expect(refresh.default().secret).toBeTruthy();
  });

  it('require real secrets in production (no dev fallback)', () => {
    expect(() =>
      load({ NODE_ENV: 'production', JWT_ACCESS_SECRET: '', JWT_REFRESH_SECRET: '' }),
    ).toThrow('JWT_ACCESS_SECRET is required in production');
  });
});

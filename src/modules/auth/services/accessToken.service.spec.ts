import { JwtService } from '@nestjs/jwt';
import { AccessTokenService } from './accessToken.service';

describe('AccessTokenService', () => {
  const jwt = new JwtService();
  const config = { secret: 'access-secret-'.padEnd(32, 'x'), expiresIn: '15m' as const };
  const service = new AccessTokenService(jwt, config);
  const user = { id: 'user-1', email: 'alice@example.com' };

  afterEach(() => jest.useRealTimers());

  it('signs a token carrying only the user id and email', async () => {
    const token = await service.createToken({ ...user, password: 'hash' } as typeof user);

    const payload = service.verifyAccessToken(token) as unknown as Record<string, unknown>;
    expect(payload).toMatchObject({ sub: 'user-1', email: 'alice@example.com' });
    expect(Object.keys(payload).sort()).toEqual(['email', 'exp', 'iat', 'sub']);
  });

  it('issues tokens valid for the configured lifetime', async () => {
    const payload = service.verifyAccessToken(await service.createToken(user));
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
  });

  it('rejects a token signed with another secret (e.g. a refresh token)', async () => {
    const foreign = await jwt.signAsync({ sub: 'user-1' }, { secret: 'r'.repeat(32) });
    expect(() => service.verifyAccessToken(foreign)).toThrow('invalid signature');
  });

  it('rejects an expired token', async () => {
    jest.useFakeTimers({
      now: new Date('2026-01-01T00:00:00Z'),
      doNotFake: ['nextTick', 'setImmediate'],
    });
    const token = await service.createToken(user);

    jest.setSystemTime(new Date('2026-01-01T00:15:01Z'));
    expect(() => service.verifyAccessToken(token)).toThrow('jwt expired');
  });

  it('rejects a tampered token', async () => {
    const [header, , signature] = (await service.createToken(user)).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', email: 'x' })).toString('base64url');
    expect(() => service.verifyAccessToken(`${header}.${forged}.${signature}`)).toThrow();
  });
});

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/modules/users/users.service';
import { User } from 'src/modules/users/interfaces/user.interface';
import { AccessTokenService } from './accessToken.service';

describe('AccessTokenService', () => {
  const jwt = new JwtService();
  const config = { secret: 'access-secret-'.padEnd(32, 'x'), expiresIn: '15m' as const };
  const findById = jest.fn<Promise<User | null>, [string]>();
  const service = new AccessTokenService(jwt, config, { findById } as unknown as UsersService);
  const user = { id: 'user-1', email: 'alice@example.com', tokenVersion: 2 };

  beforeEach(() => {
    findById.mockReset();
    findById.mockResolvedValue({ ...user, tokenVersion: 2 } as User);
  });

  afterEach(() => jest.useRealTimers());

  it('signs a token carrying only the user id, email and token version', async () => {
    const token = await service.createToken({ ...user, password: 'hash' } as typeof user);

    const payload = service.verifyAccessToken(token) as unknown as Record<string, unknown>;
    expect(payload).toMatchObject({ sub: 'user-1', email: 'alice@example.com', tokenVersion: 2 });
    expect(Object.keys(payload).sort()).toEqual(['email', 'exp', 'iat', 'sub', 'tokenVersion']);
  });

  it('adds the session id (the refresh token jti) when given', async () => {
    const payload = service.verifyAccessToken(await service.createToken(user, 'jti-1'));
    expect(payload.sid).toBe('jti-1');
  });

  it('accepts only HS256, even with the right secret', () => {
    const payload = { sub: 'user-1', email: 'a@x.io', tokenVersion: 2 };
    const hs512 = jwt.sign(payload, { secret: config.secret, algorithm: 'HS512' });

    expect(() => service.verifyAccessToken(hs512)).toThrow('invalid algorithm');
  });

  describe('authenticate', () => {
    it('accepts a token of the current token version', async () => {
      const token = await service.createToken(user);
      await expect(service.authenticate(token)).resolves.toMatchObject({ sub: 'user-1' });
      expect(findById).toHaveBeenCalledWith('user-1');
    });

    it('rejects a token issued before "log out everywhere"', async () => {
      const token = await service.createToken(user);
      findById.mockResolvedValue({ ...user, tokenVersion: 3 } as User);
      await expect(service.authenticate(token)).rejects.toThrow(
        new UnauthorizedException('Session revoked'),
      );
    });

    it('rejects a token of a deleted user', async () => {
      const token = await service.createToken(user);
      findById.mockResolvedValue(null);
      await expect(service.authenticate(token)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token without a token version (issued before it was added)', async () => {
      const legacy = await jwt.signAsync({ sub: 'user-1', email: 'a@x.io' }, config);
      await expect(service.authenticate(legacy)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('does not hit the database for an invalid token', async () => {
      await expect(service.authenticate('abc')).rejects.toThrow();
      expect(findById).not.toHaveBeenCalled();
    });
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

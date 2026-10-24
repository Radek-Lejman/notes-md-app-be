import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { PrismaService } from '@database/prisma';
import { UsersService } from 'src/modules/users/users.service';
import { RefreshTokenService } from './refreshToken.serivce';

describe('RefreshTokenService', () => {
  const jwt = new JwtService();
  const config = { secret: 'refresh-secret-'.padEnd(32, 'x'), expiresIn: '7d' as const };
  const refreshToken = {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  };
  const findById = jest.fn<Promise<User | null>, [string]>();
  const service = new RefreshTokenService(
    { refreshToken } as unknown as PrismaService,
    { findById } as unknown as UsersService,
    jwt,
    config,
  );

  const user: User = {
    id: 'user-1',
    email: 'alice@example.com',
    password: 'hash',
    tokenVersion: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  /** The DB row created for the last issued token. */
  const lastRecord = () => {
    const calls = refreshToken.create.mock.calls as [{ data: { jti: string; expiresAt: Date } }][];
    return calls[calls.length - 1][0].data;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    findById.mockResolvedValue(user);
    refreshToken.updateMany.mockResolvedValue({ count: 1 });
    refreshToken.findUnique.mockImplementation(({ where }: { where: { jti: string } }) =>
      Promise.resolve({
        jti: where.jti,
        revoked: false,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('createToken', () => {
    it('stores the token id with its expiry and signs it with the user token version', async () => {
      jest.useFakeTimers({
        now: new Date('2026-01-01T00:00:00Z'),
        doNotFake: ['nextTick', 'setImmediate'],
      });

      const { token, jti } = await service.createToken(user);

      const record = lastRecord();
      expect(jti).toBe(record.jti);
      expect(refreshToken.create).toHaveBeenCalledWith({
        data: { jti: record.jti, userId: 'user-1', expiresAt: new Date('2026-01-08T00:00:00Z') },
      });
      expect(service.verifyToken(token)).toMatchObject({
        sub: 'user-1',
        email: 'alice@example.com',
        jti: record.jti,
        tokenVersion: 3,
      });
    });

    it('gives every token a unique id', async () => {
      await service.createToken(user);
      const first = lastRecord().jti;
      await service.createToken(user);
      expect(lastRecord().jti).not.toBe(first);
    });

    it('never puts the password into the token', async () => {
      const payload = service.verifyToken((await service.createToken(user)).token);
      expect(JSON.stringify(payload)).not.toContain('hash');
    });
  });

  describe('rotate', () => {
    it('revokes the old token and issues a new one', async () => {
      const { token: old } = await service.createToken(user);
      const oldJti = lastRecord().jti;

      const rotated = await service.rotate(old);

      expect(refreshToken.findUnique).toHaveBeenCalledWith({ where: { jti: oldJti } });
      expect(refreshToken.updateMany).toHaveBeenCalledWith({
        where: { jti: oldJti, revoked: false },
        data: { revoked: true },
      });
      expect(rotated.jti).toBe(lastRecord().jti);
      expect(service.verifyToken(rotated.token).jti).toBe(rotated.jti);
      expect(lastRecord().jti).not.toBe(oldJti);
    });

    it('picks up the current token version of the user', async () => {
      const { token: old } = await service.createToken(user);
      findById.mockResolvedValue({ ...user, tokenVersion: 4 });

      expect(service.verifyToken((await service.rotate(old)).token).tokenVersion).toBe(4);
    });

    it.each([
      ['an unknown', null],
      ['a revoked', { revoked: true, expiresAt: new Date(Date.now() + 1000) }],
    ])('detects reuse of %s token and issues nothing', async (_case, record) => {
      const { token: old } = await service.createToken(user);
      refreshToken.create.mockClear();
      refreshToken.findUnique.mockResolvedValue(record);

      await expect(service.rotate(old)).rejects.toThrow(
        new UnauthorizedException('Refresh token reuse detected'),
      );
      expect(refreshToken.updateMany).not.toHaveBeenCalled();
      expect(refreshToken.create).not.toHaveBeenCalled();
    });

    it('lets only one of two parallel refreshes with the same token win', async () => {
      const { token: old } = await service.createToken(user);
      refreshToken.create.mockClear();
      // The other request revoked the token between the read and our update.
      refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.rotate(old)).rejects.toThrow(
        new UnauthorizedException('Refresh token reuse detected'),
      );
      expect(refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects a token whose record has expired', async () => {
      const { token: old } = await service.createToken(user);
      refreshToken.findUnique.mockResolvedValue({ revoked: false, expiresAt: new Date(0) });

      await expect(service.rotate(old)).rejects.toThrow('Refresh token expired');
      expect(refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['garbage', 'not-a-jwt'],
      ['an access token', jwt.sign({ sub: 'user-1' }, { secret: 'a'.repeat(32) })],
    ])('rejects %s with 401 without touching the database', async (_case, token) => {
      await expect(service.rotate(token)).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );
      expect(refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a token of a deleted user after revoking it', async () => {
      const { token: old } = await service.createToken(user);
      refreshToken.create.mockClear();
      findById.mockResolvedValue(null);

      await expect(service.rotate(old)).rejects.toThrow('User not found');
      expect(refreshToken.updateMany).toHaveBeenCalled();
      expect(refreshToken.create).not.toHaveBeenCalled();
    });
  });

  it('verifyToken accepts only HS256, even with the right secret', () => {
    const payload = { sub: 'user-1', email: 'a@x.io', jti: 'j1', tokenVersion: 3 };
    const hs512 = jwt.sign(payload, { secret: config.secret, algorithm: 'HS512' });

    expect(() => service.verifyToken(hs512)).toThrow('invalid algorithm');
    expect(service.verifyToken(jwt.sign(payload, { secret: config.secret }))).toMatchObject(
      payload,
    );
  });

  it('revoke revokes one active token, scoped to its owner', async () => {
    await service.revoke('j1', 'user-1');

    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { jti: 'j1', userId: 'user-1', revoked: false },
      data: { revoked: true },
    });
  });

  it('revokeAll revokes only active tokens of the given user', async () => {
    await service.revokeAll('user-1');
    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revoked: false },
      data: { revoked: true },
    });
  });
});

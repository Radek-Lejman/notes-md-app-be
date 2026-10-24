import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JsonWebTokenError, TokenExpiredError } from '@nestjs/jwt';
import { Request } from 'express';
import * as bcrypt from 'bcryptjs';
import { UsersService } from 'src/modules/users/users.service';
import { BruteForceService } from 'src/infrastructure/security/services/bruteForceService';
import { User } from 'src/modules/users/interfaces/user.interface';
import { AuthService } from './auth.service';
import { AccessTokenService } from './accessToken.service';
import { RefreshTokenService } from './refreshToken.serivce';
import { IssuedRefreshToken, RefreshTokenPayload } from '../interfaces/jwt.interface';

describe('AuthService', () => {
  const users = {
    findByEmail: jest.fn<Promise<User | null>, [string]>(),
    findById: jest.fn<Promise<User | null>, [string]>(),
    createUser: jest.fn<Promise<User>, [{ email: string; password: string }]>(),
    bumpTokenVersion: jest.fn<Promise<number>, [string]>(),
  };
  const accessTokens = { createToken: jest.fn<Promise<string>, [unknown, string?]>() };
  const refreshTokens = {
    createToken: jest.fn<Promise<IssuedRefreshToken>, [unknown]>(),
    verifyToken: jest.fn<RefreshTokenPayload, [string]>(),
    rotate: jest.fn<Promise<IssuedRefreshToken>, [string]>(),
    revoke: jest.fn<Promise<void>, [string, string]>(),
  };
  const bruteForce = { resetMany: jest.fn(), recordFailureMany: jest.fn() };
  const service = new AuthService(
    users as unknown as UsersService,
    accessTokens as unknown as AccessTokenService,
    refreshTokens as unknown as RefreshTokenService,
    bruteForce as unknown as BruteForceService,
  );

  const PASSWORD = 'correct horse';
  let user: User;
  const bfKeys = ['ip:10.0.0.1'];

  beforeAll(async () => {
    user = {
      id: 'user-1',
      email: 'alice@example.com',
      password: await bcrypt.hash(PASSWORD, 4),
      tokenVersion: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    users.findByEmail.mockResolvedValue(user);
    users.findById.mockResolvedValue(user);
    users.createUser.mockImplementation((data) => Promise.resolve({ ...user, ...data }));
    accessTokens.createToken.mockResolvedValue('access.jwt');
    refreshTokens.createToken.mockResolvedValue({ token: 'refresh.jwt', jti: 'jti-new' });
    refreshTokens.rotate.mockResolvedValue({ token: 'rotated.jwt', jti: 'jti-rotated' });
    refreshTokens.verifyToken.mockReturnValue({
      sub: 'user-1',
      email: 'alice@example.com',
      jti: 'j1',
      tokenVersion: 2,
    });
  });

  describe('login', () => {
    it('issues both tokens for a correct password, keeping the brute-force counter (S5)', async () => {
      await expect(
        service.login({ email: 'alice@example.com', password: PASSWORD }, bfKeys),
      ).resolves.toEqual({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' });

      expect(refreshTokens.createToken).toHaveBeenCalledWith(user);
      // The access token carries the refresh token's id, so logout can revoke this session.
      expect(accessTokens.createToken).toHaveBeenCalledWith(user, 'jti-new');
      // S5: success must not clear the client's counter (see AuthService.login).
      expect(bruteForce.resetMany).not.toHaveBeenCalled();
      expect(bruteForce.recordFailureMany).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown email', null, PASSWORD],
      ['a wrong password', undefined, 'wrong password'],
    ])('rejects %s with the same 401 and records a failure', async (_case, found, password) => {
      if (found !== undefined) users.findByEmail.mockResolvedValue(found);

      await expect(service.login({ email: 'alice@example.com', password }, bfKeys)).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );

      expect(bruteForce.recordFailureMany).toHaveBeenCalledWith(bfKeys);
      expect(bruteForce.resetMany).not.toHaveBeenCalled();
      expect(accessTokens.createToken).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('stores a bcrypt hash, never the plain password, and issues tokens', async () => {
      users.findByEmail.mockResolvedValue(null);
      const result = await service.register({ email: 'new@example.com', password: PASSWORD });

      const [[saved]] = users.createUser.mock.calls;
      expect(saved.email).toBe('new@example.com');
      expect(saved.password).not.toBe(PASSWORD);
      expect(saved.password).toMatch(/^\$2[aby]\$12\$/);
      await expect(bcrypt.compare(PASSWORD, saved.password)).resolves.toBe(true);
      expect(result).toEqual({
        message: 'User registered successfully',
        accessToken: 'access.jwt',
        refreshToken: 'refresh.jwt',
      });
    });

    it('rejects an email that is already taken', async () => {
      await expect(
        service.register({ email: 'alice@example.com', password: PASSWORD }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.createUser).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const withCookie = (refresh_token?: string) =>
      ({ cookies: refresh_token ? { refresh_token } : {} }) as Request;

    it('issues a new access token for the user and rotates the refresh token', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(service.refresh(withCookie('old.jwt'))).resolves.toEqual({
        message: 'Access token refreshed successfully',
        accessToken: 'access.jwt',
        refreshToken: 'rotated.jwt',
      });
      expect(users.findById).toHaveBeenCalledWith('user-1');
      expect(accessTokens.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', email: 'alice@example.com', tokenVersion: 2 }),
        'jti-rotated',
      );
      expect(refreshTokens.rotate).toHaveBeenCalledWith('old.jwt');
    });

    it('rejects a request without the refresh cookie', async () => {
      await expect(service.refresh(withCookie())).rejects.toThrow('Missing refresh token');
      expect(refreshTokens.verifyToken).not.toHaveBeenCalled();
    });

    it('rejects a token of a user that no longer exists', async () => {
      users.findById.mockResolvedValue(null);
      await expect(service.refresh(withCookie('old.jwt'))).rejects.toThrow('Invalid refresh token');
      expect(refreshTokens.rotate).not.toHaveBeenCalled();
    });

    it('rejects a token issued before "log out everywhere" (older token version)', async () => {
      users.findById.mockResolvedValue({ ...user, tokenVersion: 3 });

      await expect(service.refresh(withCookie('old.jwt'))).rejects.toThrow('Refresh token revoked');
      expect(accessTokens.createToken).not.toHaveBeenCalled();
      expect(refreshTokens.rotate).not.toHaveBeenCalled();
    });

    it('D1: rejects an expired or forged refresh token with 401', async () => {
      refreshTokens.verifyToken.mockImplementation(() => {
        throw new JsonWebTokenError('invalid signature');
      });

      await expect(service.refresh(withCookie('forged.jwt'))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(users.findById).not.toHaveBeenCalled();
      expect(refreshTokens.rotate).not.toHaveBeenCalled();
    });

    it('rejects an expired refresh token with the same message as a forged one', async () => {
      refreshTokens.verifyToken.mockImplementation(() => {
        throw new TokenExpiredError('jwt expired', new Date());
      });

      await expect(service.refresh(withCookie('expired.jwt'))).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );
    });

    it('does not turn an unexpected verification error into a 401', async () => {
      const failure = new Error('secretOrPrivateKey must have a value');
      refreshTokens.verifyToken.mockImplementation(() => {
        throw failure;
      });

      await expect(service.refresh(withCookie('old.jwt'))).rejects.toBe(failure);
      expect(accessTokens.createToken).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it("revokes the session's refresh token for the token's owner", async () => {
      await service.logout({
        sub: 'user-1',
        email: 'alice@example.com',
        tokenVersion: 2,
        sid: 'j1',
      });
      expect(refreshTokens.revoke).toHaveBeenCalledWith('j1', 'user-1');
    });

    it('revokes nothing for an access token issued before session ids', async () => {
      await service.logout({ sub: 'user-1', email: 'alice@example.com', tokenVersion: 2 });
      expect(refreshTokens.revoke).not.toHaveBeenCalled();
    });
  });

  it('revokeAll bumps the token version of the user', async () => {
    users.bumpTokenVersion.mockResolvedValue(3);
    await service.revokeAll('user-1');
    expect(users.bumpTokenVersion).toHaveBeenCalledWith('user-1');
  });
});

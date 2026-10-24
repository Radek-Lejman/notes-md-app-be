import { Logger, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { CsrfController } from './csrf.controller';
import { AuthService } from '../services/auth.service';

describe('AuthController', () => {
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    revokeAll: jest.fn(),
    logout: jest.fn(),
  };
  const controller = new AuthController(authService as unknown as AuthService);
  const tokens = { accessToken: 'access.jwt', refreshToken: 'refresh.jwt' };

  let setHeader: jest.Mock<void, [string, string[]]>;
  let res: Response;
  const cookiesSet = () => setHeader.mock.calls[0][1];

  beforeEach(() => {
    jest.clearAllMocks();
    setHeader = jest.fn<void, [string, string[]]>();
    res = { setHeader } as unknown as Response;
    authService.register.mockResolvedValue({ message: 'x', ...tokens });
    authService.login.mockResolvedValue(tokens);
    authService.refresh.mockResolvedValue({ message: 'x', ...tokens });
    authService.revokeAll.mockResolvedValue(undefined);
    authService.logout.mockResolvedValue(undefined);
  });

  it('register sets both auth cookies and does not return the tokens in the body', async () => {
    const dto = { email: 'a@example.com', password: 'secret1' };

    await expect(controller.register(dto, res)).resolves.toEqual({
      message: 'Registration successful ',
    });
    expect(authService.register).toHaveBeenCalledWith(dto);
    expect(cookiesSet()).toEqual([
      expect.stringMatching(/^access_token=access\.jwt;.*HttpOnly/),
      expect.stringMatching(/^refresh_token=refresh\.jwt;.*Path=\/api\/auth\/refresh/),
    ]);
  });

  it('login passes the brute-force keys from the guard and sets the cookies', async () => {
    const dto = { email: 'a@example.com', password: 'secret1' };
    const req = { __bfKeys: ['ip:1', 'ip:1'] } as Request;

    await expect(controller.login(dto, req, res)).resolves.toEqual({
      message: 'Login successful',
    });
    expect(authService.login).toHaveBeenCalledWith(dto, ['ip:1', 'ip:1']);
    expect(cookiesSet()).toHaveLength(2);
  });

  it('login works without brute-force keys', async () => {
    await controller.login({ email: 'a@example.com', password: 'secret1' }, {} as Request, res);
    expect(authService.login).toHaveBeenCalledWith(expect.anything(), []);
  });

  it('login sets no cookies when the credentials are rejected', async () => {
    authService.login.mockRejectedValue(new UnauthorizedException());

    await expect(
      controller.login({ email: 'a@example.com', password: 'x' }, {} as Request, res),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('me returns the JWT payload of the request without the session id', () => {
    const user = { sub: 'user-1', email: 'a@example.com', tokenVersion: 0, iat: 1, exp: 2 };
    expect(controller.me({ user: { ...user, sid: 'jti-1' } } as unknown as Request)).toEqual(user);
  });

  it('refresh rotates tokens from the request and sets the new cookies', async () => {
    const req = { cookies: { refresh_token: 'old' } } as unknown as Request;

    await expect(controller.refresh(req, res)).resolves.toEqual({ message: 'Token refreshed' });
    expect(authService.refresh).toHaveBeenCalledWith(req);
    expect(cookiesSet()[1]).toMatch(/^refresh_token=refresh\.jwt;/);
  });

  describe('logout', () => {
    it("revokes the current session's refresh token and expires the auth cookies", async () => {
      const user = { sub: 'user-1', sid: 'jti-1' };

      await expect(controller.logout({ user } as unknown as Request, res)).resolves.toEqual({
        message: 'Loged out',
      });
      expect(authService.logout).toHaveBeenCalledWith(user);
      expect(cookiesSet()).toHaveLength(3);
      cookiesSet().forEach((cookie) => expect(cookie).toContain('Max-Age=0'));
    });

    it('still logs out locally when revoking fails, and logs the failure', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      authService.logout.mockRejectedValue(new Error('db down'));

      await expect(
        controller.logout({ user: { sub: 'user-1' } } as unknown as Request, res),
      ).resolves.toEqual({ message: 'Loged out' });
      cookiesSet().forEach((cookie) => expect(cookie).toContain('Max-Age=0'));
      expect(error).toHaveBeenCalledWith(expect.stringContaining('db down'));
      error.mockRestore();
    });

    it('rejects a request without an authenticated user', async () => {
      await expect(controller.logout({} as Request, res)).rejects.toThrow(UnauthorizedException);
      expect(authService.logout).not.toHaveBeenCalled();
    });
  });

  describe('revokeAll', () => {
    it("revokes the current user's sessions and clears the cookies", async () => {
      const req = { user: { sub: 'user-1' } } as unknown as Request;

      await expect(controller.revokeAll(req, res)).resolves.toEqual({
        message: 'All refresh tokens revoked, logged out',
      });
      expect(authService.revokeAll).toHaveBeenCalledWith('user-1');
      cookiesSet().forEach((cookie) => expect(cookie).toContain('Max-Age=0'));
    });

    it('rejects a request without an authenticated user', async () => {
      await expect(controller.revokeAll({} as Request, res)).rejects.toThrow(UnauthorizedException);
      expect(authService.revokeAll).not.toHaveBeenCalled();
    });

    it('D2: fails the request and keeps the cookies when revoking fails', async () => {
      authService.revokeAll.mockRejectedValue(new Error('db down'));

      await expect(
        controller.revokeAll({ user: { sub: 'user-1' } } as unknown as Request, res),
      ).rejects.toThrow('db down');
      expect(setHeader).not.toHaveBeenCalled();
    });
  });
});

describe('CsrfController', () => {
  it('returns a CSRF token from the csurf middleware', () => {
    const csrfToken = jest.fn().mockReturnValue('csrf-123');

    expect(new CsrfController().getToken({ csrfToken } as unknown as Request)).toEqual({
      csrfToken: 'csrf-123',
    });
  });
});

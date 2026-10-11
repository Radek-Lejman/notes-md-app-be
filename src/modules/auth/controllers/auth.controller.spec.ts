import { UnauthorizedException } from '@nestjs/common';
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
    const req = { __bfKeys: ['ip:1', 'acct:a@example.com'] } as Request;

    await expect(controller.login(dto, req, res)).resolves.toEqual({
      message: 'Login successful',
    });
    expect(authService.login).toHaveBeenCalledWith(dto, ['ip:1', 'acct:a@example.com']);
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

  it('me returns the JWT payload of the request', () => {
    const user = { sub: 'user-1', email: 'a@example.com' };
    expect(controller.me({ user } as unknown as Request)).toBe(user);
  });

  it('refresh rotates tokens from the request and sets the new cookies', async () => {
    const req = { cookies: { refresh_token: 'old' } } as unknown as Request;

    await expect(controller.refresh(req, res)).resolves.toEqual({ message: 'Token refreshed' });
    expect(authService.refresh).toHaveBeenCalledWith(req);
    expect(cookiesSet()[1]).toMatch(/^refresh_token=refresh\.jwt;/);
  });

  it('logout expires the auth cookies', () => {
    expect(controller.logout(res)).toEqual({ message: 'Loged out' });
    expect(cookiesSet()).toHaveLength(3);
    cookiesSet().forEach((cookie) => expect(cookie).toContain('Max-Age=0'));
  });

  describe('revokeAll', () => {
    it("revokes the current user's sessions and clears the cookies", async () => {
      const req = { user: { sub: 'user-1' } } as unknown as Request;

      // Promise.resolve: the handler is synchronous today (see D2) and async once fixed.
      await expect(Promise.resolve(controller.revokeAll(req, res))).resolves.toEqual({
        message: 'All refresh tokens revoked, logged out',
      });
      expect(authService.revokeAll).toHaveBeenCalledWith('user-1');
      cookiesSet().forEach((cookie) => expect(cookie).toContain('Max-Age=0'));
    });

    it('rejects a request without an authenticated user', () => {
      expect(() => controller.revokeAll({} as Request, res)).toThrow(UnauthorizedException);
      expect(authService.revokeAll).not.toHaveBeenCalled();
    });

    // D2: authService.revokeAll() is not awaited — when it fails, the client is told that the
    // sessions were revoked, they stay valid, and the rejection is unhandled.
    it.failing('D2: fails the request when revoking fails', async () => {
      const failure = Promise.reject(new Error('db down'));
      failure.catch(() => undefined); // keep the unawaited rejection from crashing the test run
      authService.revokeAll.mockReturnValue(failure);

      await expect(
        controller.revokeAll({ user: { sub: 'user-1' } } as unknown as Request, res),
      ).rejects.toThrow('db down');
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

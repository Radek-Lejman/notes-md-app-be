import { Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PublicEndpoint } from '@common/decorators';
import { makeHttpContext } from '@common/testing/http-test.utils';
import { JwtAuthGuard } from './jwtAuthGuard.guard';
import { AccessTokenService } from '../services/accessToken.service';
import { UsersService } from 'src/modules/users/users.service';
import { User } from 'src/modules/users/interfaces/user.interface';

class NotesLikeController {
  list(this: void) {}

  @PublicEndpoint()
  open(this: void) {}
}

@PublicEndpoint()
class PublicController {
  anything(this: void) {}
}

describe('JwtAuthGuard', () => {
  const config = { secret: 'guard-test-secret-'.padEnd(32, 'x'), expiresIn: '15m' as const };
  const findById = jest.fn<Promise<User | null>, [string]>();
  const tokens = new AccessTokenService(new JwtService(), config, {
    findById,
  } as unknown as UsersService);
  const alice = { id: 'user-1', email: 'alice@example.com', tokenVersion: 0 };
  const guard = new JwtAuthGuard(new Reflector(), tokens);

  const context = (
    req: Partial<Request>,
    handler: () => void = NotesLikeController.prototype.list,
    cls: object = NotesLikeController,
  ) => makeHttpContext(req, undefined, handler, cls);

  beforeEach(() => {
    findById.mockReset();
    findById.mockResolvedValue(alice as User);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('accepts a valid access token cookie and exposes its payload as req.user', async () => {
    const token = await tokens.createToken(alice);
    const req: Partial<Request> = { cookies: { access_token: token } };

    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.user).toMatchObject({ sub: 'user-1', email: 'alice@example.com' });
  });

  it('rejects a token of a revoked session (log out everywhere) with 401', async () => {
    const token = await tokens.createToken(alice);
    findById.mockResolvedValue({ ...alice, tokenVersion: 1 } as User);
    const req: Partial<Request> = { cookies: { access_token: token } };

    await expect(guard.canActivate(context(req))).rejects.toThrow(
      new UnauthorizedException('Invalid token'),
    );
    expect(req.user).toBeUndefined();
  });

  it('lets a database failure through as a server error instead of a 401', async () => {
    const token = await tokens.createToken(alice);
    const failure = new Error('db down');
    findById.mockRejectedValue(failure);

    await expect(guard.canActivate(context({ cookies: { access_token: token } }))).rejects.toBe(
      failure,
    );
  });

  it.each([
    ['no cookies at all', {}],
    ['no access_token cookie', { cookies: {} }],
  ])('rejects a request with %s', async (_case, req: Partial<Request>) => {
    await expect(guard.canActivate(context(req))).rejects.toThrow(
      new UnauthorizedException('Token does not exist'),
    );
  });

  it.each([
    ['a malformed token', 'abc'],
    [
      'a token signed with another secret',
      new JwtService().sign({ sub: 'x' }, { secret: 'y'.repeat(32) }),
    ],
  ])('rejects %s without setting req.user', async (_case, token) => {
    const req: Partial<Request> = { cookies: { access_token: token } };

    await expect(guard.canActivate(context(req))).rejects.toThrow(
      new UnauthorizedException('Invalid token'),
    );
    expect(req.user).toBeUndefined();
  });

  it('lets a @PublicEndpoint handler through without a token', async () => {
    await expect(guard.canActivate(context({}, NotesLikeController.prototype.open))).resolves.toBe(
      true,
    );
  });

  it('lets every handler of a @PublicEndpoint controller through', async () => {
    await expect(
      guard.canActivate(context({}, PublicController.prototype.anything, PublicController)),
    ).resolves.toBe(true);
  });
});

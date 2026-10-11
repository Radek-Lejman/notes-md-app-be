import { Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PublicEndpoint } from '@common/decorators';
import { makeHttpContext } from '@common/testing/http-test.utils';
import { JwtAuthGuard } from './jwtAuthGuard.guard';
import { AccessTokenService } from '../services/accessToken.service';

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
  const tokens = new AccessTokenService(new JwtService(), config);
  const guard = new JwtAuthGuard(new Reflector(), tokens);

  const context = (
    req: Partial<Request>,
    handler: () => void = NotesLikeController.prototype.list,
    cls: object = NotesLikeController,
  ) => makeHttpContext(req, undefined, handler, cls);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('accepts a valid access token cookie and exposes its payload as req.user', async () => {
    const token = await tokens.createToken({ id: 'user-1', email: 'alice@example.com' });
    const req: Partial<Request> = { cookies: { access_token: token } };

    expect(guard.canActivate(context(req))).toBe(true);
    expect(req.user).toMatchObject({ sub: 'user-1', email: 'alice@example.com' });
  });

  it.each([
    ['no cookies at all', {}],
    ['no access_token cookie', { cookies: {} }],
  ])('rejects a request with %s', (_case, req: Partial<Request>) => {
    expect(() => guard.canActivate(context(req))).toThrow(
      new UnauthorizedException('Token does not exist'),
    );
  });

  it.each([
    ['a malformed token', 'abc'],
    [
      'a token signed with another secret',
      new JwtService().sign({ sub: 'x' }, { secret: 'y'.repeat(32) }),
    ],
  ])('rejects %s without setting req.user', (_case, token) => {
    const req: Partial<Request> = { cookies: { access_token: token } };

    expect(() => guard.canActivate(context(req))).toThrow(
      new UnauthorizedException('Invalid token'),
    );
    expect(req.user).toBeUndefined();
  });

  it('lets a @PublicEndpoint handler through without a token', () => {
    expect(guard.canActivate(context({}, NotesLikeController.prototype.open))).toBe(true);
  });

  it('lets every handler of a @PublicEndpoint controller through', () => {
    expect(
      guard.canActivate(context({}, PublicController.prototype.anything, PublicController)),
    ).toBe(true);
  });
});

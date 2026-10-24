import { HttpStatus, Logger } from '@nestjs/common';
import { Request } from 'express';
import { makeHttpContext, makeResponse } from '@common/testing/http-test.utils';
import { BruteForceGuard } from './bruteForce.guard';
import { BruteForceService } from '../services/bruteForceService';
import { TooManyRequestsException } from '../exceptions/too-many-requests.exception';
import { bruteForceConfig } from '../config/bruteForce.config';

describe('BruteForceGuard', () => {
  let service: BruteForceService;
  let guard: BruteForceGuard;

  const request = (body?: unknown, ip = '10.0.0.1') => ({ ip, body }) as Partial<Request>;

  const lock = (key: string) => {
    for (let i = 0; i < bruteForceConfig.maxAttempts; i++) service.recordFailure(key);
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    service = new BruteForceService();
    guard = new BruteForceGuard(service);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lets a request through and stores the client key for the login handler', () => {
    const req = request({ email: 'alice@example.com' });

    expect(guard.canActivate(makeHttpContext(req))).toBe(true);
    expect(req.__bfKeys).toEqual(['ip:10.0.0.1']);
  });

  it('counts a whole IPv6 /64 as one client', () => {
    const req = request({}, '2001:db8:1:2::77');

    guard.canActivate(makeHttpContext(req));
    expect(req.__bfKeys).toEqual(['ip:2001:db8:1:2::/64']);
  });

  it('rejects with 429 and Retry-After when the client is locked', () => {
    lock('ip:10.0.0.1');
    const res = makeResponse();

    let error: unknown;
    try {
      guard.canActivate(makeHttpContext(request({ email: 'ALICE@example.com' }), res));
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(TooManyRequestsException);
    expect((error as TooManyRequestsException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((error as TooManyRequestsException).getResponse()).toMatchObject({ retryAfter: 120 });
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '120');
  });

  it('does not lock a different client', () => {
    lock('ip:10.0.0.1');
    expect(guard.canActivate(makeHttpContext(request({}, '10.0.0.2')))).toBe(true);
  });

  it("S4: failures from a stranger's IP do not lock the owner out of their account", () => {
    lock('ip:6.6.6.6');

    expect(guard.canActivate(makeHttpContext(request({ email: 'alice@example.com' })))).toBe(true);
  });

  it('a locked IPv6 client cannot dodge the lock with another address of its /64', () => {
    lock('ip:2001:db8:1:2::/64');

    expect(() => guard.canActivate(makeHttpContext(request({}, '2001:db8:1:2::beef')))).toThrow(
      TooManyRequestsException,
    );
  });
});

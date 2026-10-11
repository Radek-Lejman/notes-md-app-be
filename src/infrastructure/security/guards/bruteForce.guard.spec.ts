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

  it('lets a request through and stores the IP and account keys for the login handler', () => {
    const req = request({ email: '  Alice@Example.COM ' });

    expect(guard.canActivate(makeHttpContext(req))).toBe(true);
    expect(req.__bfKeys).toEqual(['ip:10.0.0.1', 'acct:alice@example.com']);
  });

  it.each([
    ['no body', undefined],
    ['no email', { password: 'x' }],
    ['a blank email', { email: '   ' }],
  ])('uses only the IP key for %s', (_case, body) => {
    const req = request(body);

    guard.canActivate(makeHttpContext(req));
    expect(req.__bfKeys).toEqual(['ip:10.0.0.1']);
  });

  it.each([
    ['the IP', 'ip:10.0.0.1'],
    ['the account (any IP, any letter case)', 'acct:alice@example.com'],
  ])('rejects with 429 and Retry-After when %s is locked', (_case, lockedKey) => {
    lock(lockedKey);
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

  it('does not lock other accounts from a different IP', () => {
    lock('acct:alice@example.com');
    expect(
      guard.canActivate(makeHttpContext(request({ email: 'bob@example.com' }, '10.0.0.2'))),
    ).toBe(true);
  });
});

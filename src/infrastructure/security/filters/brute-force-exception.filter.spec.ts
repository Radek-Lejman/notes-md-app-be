import { HttpStatus } from '@nestjs/common';
import { makeHttpContext, makeResponse } from '@common/testing/http-test.utils';
import { BruteForceExceptionFilter } from './brute-force-exception.filter';
import { TooManyRequestsException } from '../exceptions/too-many-requests.exception';

describe('TooManyRequestsException', () => {
  it('is a 429 carrying the retry time', () => {
    const exception = new TooManyRequestsException(42);

    expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(exception.getResponse()).toEqual({
      statusCode: 429,
      message: 'Too many failed attempts. Try again later.',
      retryAfter: 42,
    });
  });
});

describe('BruteForceExceptionFilter', () => {
  it('responds 429 with Retry-After header and body', () => {
    const res = makeResponse();

    new BruteForceExceptionFilter().catch(
      new TooManyRequestsException(90),
      makeHttpContext({}, res),
    );

    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '90');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Too many failed attempts. Try again later.',
      retryAfter: 90,
    });
  });
});

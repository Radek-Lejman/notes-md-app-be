import { Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request } from 'express';
import { makeHttpContext, makeResponse } from '@common/testing/http-test.utils';
import { ThrottlerExceptionFilter } from './throttler-exception.filter';
import { throttleAuthConfig, throttleGlobalConfig } from '../config/throttle.config';

describe('throttle config', () => {
  it('allows 40 requests per minute globally and 25 on auth routes', () => {
    expect(throttleGlobalConfig).toEqual({ ttl: 60_000, limit: 40 });
    expect(throttleAuthConfig).toEqual({ ttl: 60_000, limit: 25 });
  });
});

describe('ThrottlerExceptionFilter', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(['/api/notes', '/api/auth/refresh'])(
    'responds 429 with Retry-After in seconds for %s',
    (originalUrl) => {
      const res = makeResponse();
      const req = { originalUrl, method: 'POST', ip: '10.0.0.1' } as Partial<Request>;

      new ThrottlerExceptionFilter().catch(new ThrottlerException(), makeHttpContext(req, res));

      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again in 60 seconds.',
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`10.0.0.1 on POST ${originalUrl}`));
    },
  );
});

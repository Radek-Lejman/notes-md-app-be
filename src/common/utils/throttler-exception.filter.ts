import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response, Request } from 'express';
import { throttleAuthConfig, throttleGLobalConfig } from '../utils/throttle.config';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ThrottlerExceptionFilter.name);

  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const ttlMs = request.originalUrl.startsWith('/auth')
      ? throttleAuthConfig.ttl
      : throttleGLobalConfig.ttl;

    const retryAfterSeconds = Math.ceil(ttlMs / 1000);
    this.logger.warn(
      `Rate limit exceeded for ${request.ip} on ${request.method} ${request.originalUrl} (Retry-After: ${ttlMs}s)`,
    );

    response.setHeader('Retry-After', retryAfterSeconds.toString());
    response.status(429).json({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds.`,
    });
  }
}

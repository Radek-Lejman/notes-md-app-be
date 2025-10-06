import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { TooManyRequestsException } from 'src/infrastructure/security/exceptions/too-many-requests.exception';

@Catch(TooManyRequestsException)
export class BruteForceExceptionFilter implements ExceptionFilter {
  catch(exception: TooManyRequestsException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const responseBody = exception.getResponse() as {
      statusCode: number;
      message: string;
      retryAfter: number;
    };
    const retryAfter = responseBody.retryAfter;

    res.setHeader('Retry-After', retryAfter.toString());
    res.status(exception.getStatus()).json({
      statusCode: exception.getStatus(),
      message: exception.message,
      retryAfter,
    });
  }
}

import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManyRequestsException extends HttpException {
  constructor(retryAfter: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many failed attempts. Try again later.',
        retryAfter: retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

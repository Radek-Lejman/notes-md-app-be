import { CanActivate, ExecutionContext, Injectable, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { TooManyRequestsException } from 'src/infrastructure/security/exceptions/too-many-requests.exception';
import {
  BruteForceService,
  bruteForceKeys,
} from 'src/infrastructure/security/services/bruteForceService';

@Injectable()
export class BruteForceGuard implements CanActivate {
  logger = new Logger(BruteForceGuard.name);
  constructor(private readonly bf: BruteForceService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const keys = bruteForceKeys(req.ip);
    req.__bfKeys = keys;

    const locked = this.bf.firstLocked(keys);
    if (locked) {
      const retry = this.bf.getRetryAfterSeconds(locked);
      this.logger.warn(`Brute force lock for keys: ${keys.join(', ')}, retry after ${retry}s`);

      res.setHeader('Retry-After', retry.toString());

      throw new TooManyRequestsException(retry);
    }
    return true;
  }
}

import { CanActivate, ExecutionContext, Injectable, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { BruteForceService } from 'src/services/bruteForceService';

@Injectable()
export class BruteForceGuard implements CanActivate {
  constructor(private readonly bf: BruteForceService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ip = req.ip;
    const email = (req.body?.email ?? '').toString().trim().toLowerCase();

    const keys = [`ip:${ip}`, email ? `acct:${email}` : null].filter(Boolean) as string[];
    req.__bfKeys = keys;

    const locked = this.bf.firstLocked(keys);
    if (locked) {
      const retry = this.bf.getRetryAfterSeconds(locked);
      res.setHeader('Retry-After', retry.toString());

      throw new HttpException('Too many failed attempts. Try again later.', 429);
    }
    return true;
  }
}

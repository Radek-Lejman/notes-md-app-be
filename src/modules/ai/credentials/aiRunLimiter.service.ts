import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AI_MODULE_CONFIG, AiModuleConfig } from '../config/aiModule.config';
import { AI_ERROR_CODES } from './credential.types';

/**
 * Caps concurrent AI runs (each one is a Claude process or a heavy local model call),
 * per user and in total. In-memory: fine for a single backend instance.
 */
@Injectable()
export class AiRunLimiter {
  private readonly perUser = new Map<string, number>();
  private total = 0;

  constructor(@Inject(AI_MODULE_CONFIG) private readonly config: AiModuleConfig) {}

  /** Reserves a slot or throws 429. Call the returned function exactly once to release it. */
  acquire(userId: string): () => void {
    const { maxConcurrentRuns, maxConcurrentRunsPerUser } = this.config.limits;
    const mine = this.perUser.get(userId) ?? 0;

    if (mine >= maxConcurrentRunsPerUser) {
      throw this.busy('Another AI answer is still running. Wait for it or stop it.');
    }
    if (this.total >= maxConcurrentRuns) {
      throw this.busy('The AI assistant is busy. Try again in a moment.');
    }

    this.perUser.set(userId, mine + 1);
    this.total++;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const left = (this.perUser.get(userId) ?? 1) - 1;
      if (left > 0) this.perUser.set(userId, left);
      else this.perUser.delete(userId);
    };
  }

  /** Runs `fn` holding a slot. */
  async run<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const release = this.acquire(userId);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private busy(message: string): HttpException {
    return new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, code: AI_ERROR_CODES.busy, message },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

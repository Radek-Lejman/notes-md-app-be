import { HttpStatus } from '@nestjs/common';
import { AiRunLimiter } from './aiRunLimiter.service';
import { AiModuleConfig } from '../config/aiModule.config';

describe('AiRunLimiter', () => {
  const makeLimiter = (maxConcurrentRuns = 2, maxConcurrentRunsPerUser = 1) =>
    new AiRunLimiter({ limits: { maxConcurrentRuns, maxConcurrentRunsPerUser } } as AiModuleConfig);

  it('allows one run per user at a time', () => {
    const limiter = makeLimiter();
    const release = limiter.acquire('alice');

    let error: unknown;
    try {
      limiter.acquire('alice');
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    release();
    expect(() => limiter.acquire('alice')).not.toThrow();
  });

  it('caps the total number of runs', () => {
    const limiter = makeLimiter(2, 5);
    limiter.acquire('alice');
    limiter.acquire('bob');
    expect(() => limiter.acquire('carol')).toThrow('busy');
  });

  it('frees one slot at a time when a user holds several', () => {
    const limiter = makeLimiter(5, 2);
    const first = limiter.acquire('alice');
    limiter.acquire('alice');
    expect(() => limiter.acquire('alice')).toThrow('still running');

    first();
    expect(() => limiter.acquire('alice')).not.toThrow();
    expect(() => limiter.acquire('alice')).toThrow('still running');
  });

  it('never leaves a negative per-user count, even if the entry is already gone', () => {
    const limiter = makeLimiter(5, 1);
    const release = limiter.acquire('alice');
    limiter['perUser'].clear();

    release();
    expect(limiter['perUser'].has('alice')).toBe(false);
    expect(() => limiter.acquire('alice')).not.toThrow();
  });

  it('ignores a double release', () => {
    const limiter = makeLimiter(1, 1);
    const release = limiter.acquire('alice');
    release();
    release();
    limiter.acquire('bob');
    expect(() => limiter.acquire('carol')).toThrow();
  });

  it('run() releases the slot also when the function fails', async () => {
    const limiter = makeLimiter();
    await expect(limiter.run('alice', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(limiter.run('alice', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});

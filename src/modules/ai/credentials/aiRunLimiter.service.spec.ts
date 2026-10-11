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

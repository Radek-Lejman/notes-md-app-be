import { Logger } from '@nestjs/common';
import { BruteForceService } from './bruteForceService';
import { bruteForceConfig } from '../config/bruteForce.config';

// Literal values: the first test pins them to the config, the rest relies on them.
const maxAttempts = 20;
const windowMs = 30_000;
const lockMs = 120_000;

describe('BruteForceService', () => {
  let service: BruteForceService;
  let warn: jest.SpyInstance;

  const fail = (key: string, times: number) => {
    for (let i = 0; i < times; i++) service.recordFailure(key);
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    service = new BruteForceService();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uses 20 attempts per 30 s window and a 2 min lock', () => {
    expect(bruteForceConfig).toEqual({ maxAttempts, windowMs, lockMs });
  });

  it('does not lock below the attempt limit', () => {
    fail('ip:1', maxAttempts - 1);

    expect(service.isLocked('ip:1')).toBe(false);
    expect(service.getRetryAfterSeconds('ip:1')).toBe(0);
  });

  it('locks a key on the limit-th failure within the window and logs it', () => {
    fail('ip:1', maxAttempts);

    expect(service.isLocked('ip:1')).toBe(true);
    expect(service.getRetryAfterSeconds('ip:1')).toBe(lockMs / 1000);
    expect(warn).toHaveBeenCalledWith('Key "ip:1" locked for 120s');
  });

  it('locks only the failing key', () => {
    fail('ip:1', maxAttempts);
    expect(service.isLocked('ip:2')).toBe(false);
  });

  it('reports the remaining lock time rounded up to whole seconds', () => {
    fail('ip:1', maxAttempts);

    jest.advanceTimersByTime(lockMs - 1_500);
    expect(service.getRetryAfterSeconds('ip:1')).toBe(2);
  });

  it('unlocks when the lock time has passed', () => {
    fail('ip:1', maxAttempts);

    jest.advanceTimersByTime(lockMs);
    expect(service.isLocked('ip:1')).toBe(false);
    expect(service.getRetryAfterSeconds('ip:1')).toBe(0);
  });

  it('starts counting from zero when the window has passed', () => {
    fail('ip:1', maxAttempts - 1);

    jest.advanceTimersByTime(windowMs + 1);
    fail('ip:1', maxAttempts - 1);
    expect(service.isLocked('ip:1')).toBe(false);

    service.recordFailure('ip:1');
    expect(service.isLocked('ip:1')).toBe(true);
  });

  it('does not extend the lock with failures recorded while locked', () => {
    fail('ip:1', maxAttempts);
    jest.advanceTimersByTime(10_000);

    fail('ip:1', 5);
    expect(service.getRetryAfterSeconds('ip:1')).toBe((lockMs - 10_000) / 1000);
  });

  // D11: getOrCreateEntry() clears lockedUntil once the 30 s window is over, so a failure
  // recorded during the 2 min lock lifts it. Unreachable through BruteForceGuard today
  // (it rejects locked keys before login), but the service API itself is wrong.
  it.failing('D11: keeps the lock when a failure is recorded after the window', () => {
    fail('ip:1', maxAttempts);
    jest.advanceTimersByTime(windowMs + 1);

    service.recordFailure('ip:1');
    expect(service.isLocked('ip:1')).toBe(true);
  });

  it('reset clears attempts and an active lock', () => {
    fail('ip:1', maxAttempts);

    service.reset('ip:1');
    expect(service.isLocked('ip:1')).toBe(false);

    fail('ip:1', maxAttempts - 1);
    expect(service.isLocked('ip:1')).toBe(false);
  });

  it('recordFailureMany / resetMany apply to every key', () => {
    fail('acct:a@x.io', maxAttempts - 1);
    service.recordFailureMany(['ip:1', 'acct:a@x.io']);
    expect(service.isLocked('acct:a@x.io')).toBe(true);
    expect(service.isLocked('ip:1')).toBe(false);

    service.resetMany(['ip:1', 'acct:a@x.io']);
    expect(service.isLocked('acct:a@x.io')).toBe(false);
  });

  it('firstLocked returns the first locked key, or undefined', () => {
    fail('acct:a@x.io', maxAttempts);

    expect(service.firstLocked(['ip:1', 'acct:a@x.io'])).toBe('acct:a@x.io');
    expect(service.firstLocked(['ip:1'])).toBeUndefined();
    expect(service.firstLocked([])).toBeUndefined();
  });

  it('an unknown key is neither locked nor waiting', () => {
    expect(service.isLocked('nope')).toBe(false);
    expect(service.getRetryAfterSeconds('nope')).toBe(0);
  });
});

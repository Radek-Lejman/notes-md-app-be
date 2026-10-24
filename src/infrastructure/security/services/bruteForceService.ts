import { Injectable, Logger } from '@nestjs/common';
import { BruteForceEntry } from 'src/infrastructure/security/types/bruteForce.types';
import { bruteForceConfig } from 'src/infrastructure/security/config/bruteForce.config';
import { clientKey } from 'src/infrastructure/security/utils/clientKey';

/**
 * Keys counted for one login attempt: only the client (IPv4 address or IPv6 /64, see clientKey).
 * There is deliberately no account key: it would let anyone lock the owner out of their account
 * just by knowing the email (S4). Accepted residual risk: guessing one account from many
 * networks is capped per network only — add a CAPTCHA or delay when that becomes a real threat.
 */
export function bruteForceKeys(ip: string | undefined): string[] {
  return [`ip:${clientKey(ip)}`];
}

@Injectable()
export class BruteForceService {
  private readonly logger = new Logger(BruteForceService.name);
  private readonly attemptsStore = new Map<string, BruteForceEntry>();
  private lastSweep = Date.now();

  private now(): number {
    return Date.now();
  }

  private getOrCreateEntry(key: string): BruteForceEntry {
    const currentTime = this.now();
    const entry = this.attemptsStore.get(key);

    if (!entry) {
      const newEntry: BruteForceEntry = {
        attempts: 0,
        firstAttemptTime: currentTime,
      };
      this.attemptsStore.set(key, newEntry);
      return newEntry;
    }

    // Reset attempts if the time window has passed, but never while the key is locked:
    // the lock (2 min) outlives the window (30 s) and must not be lifted by a late failure.
    const locked = entry.lockedUntil !== undefined && entry.lockedUntil > currentTime;
    if (!locked && currentTime - entry.firstAttemptTime > bruteForceConfig.windowMs) {
      entry.attempts = 0;
      entry.firstAttemptTime = currentTime;
      entry.lockedUntil = undefined;
    }

    return entry;
  }

  /** Check if a given key (e.g., IP/user) is currently locked */
  isLocked(key: string): boolean {
    const entry = this.attemptsStore.get(key);
    return !!(entry?.lockedUntil && entry.lockedUntil > this.now());
  }

  /** Returns remaining lock time in seconds */
  getRetryAfterSeconds(key: string): number {
    const entry = this.attemptsStore.get(key);
    if (!entry?.lockedUntil) return 0;

    const msRemaining = entry.lockedUntil - this.now();
    return msRemaining > 0 ? Math.ceil(msRemaining / 1000) : 0;
  }

  /** Drops entries whose window and lock are over, at most once per window. */
  private sweepExpired(): void {
    const currentTime = this.now();
    if (currentTime - this.lastSweep < bruteForceConfig.windowMs) return;
    this.lastSweep = currentTime;

    for (const [key, entry] of this.attemptsStore) {
      const locked = entry.lockedUntil !== undefined && entry.lockedUntil > currentTime;
      if (!locked && currentTime - entry.firstAttemptTime > bruteForceConfig.windowMs) {
        this.attemptsStore.delete(key);
      }
    }
  }

  /** Register a failed attempt */
  recordFailure(key: string): void {
    this.sweepExpired();
    const entry = this.getOrCreateEntry(key);

    // Do nothing if the key is already locked
    if (entry.lockedUntil && entry.lockedUntil > this.now()) return;

    entry.attempts += 1;

    if (entry.attempts >= bruteForceConfig.maxAttempts) {
      entry.lockedUntil = this.now() + bruteForceConfig.lockMs;
      this.logger.warn(`Key "${key}" locked for ${bruteForceConfig.lockMs / 1000}s`);
    }
  }

  /** Reset attempts for a given key */
  reset(key: string): void {
    this.attemptsStore.delete(key);
  }

  /** Register a failed attempt for multiple keys */
  recordFailureMany(keys: string[]): void {
    for (const key of keys) this.recordFailure(key);
  }

  /** Reset attempts for multiple keys */
  resetMany(keys: string[]): void {
    for (const key of keys) this.reset(key);
  }

  /** Number of keys currently tracked (for monitoring and tests). */
  get size(): number {
    return this.attemptsStore.size;
  }

  /** Find the first locked key from a list */
  firstLocked(keys: string[]): string | undefined {
    return keys.find((key) => this.isLocked(key));
  }
}

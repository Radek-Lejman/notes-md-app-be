import { Injectable, Logger } from '@nestjs/common';
import { BruteForceEntry } from 'src/common/types/bruteForce.types';
import { bruteForceConfig } from 'src/config/bruteForce.config';

@Injectable()
export class BruteForceService {
  private readonly logger = new Logger(BruteForceService.name);
  private readonly attemptsStore = new Map<string, BruteForceEntry>();

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

    // Reset attempts if the time window has passed
    if (currentTime - entry.firstAttemptTime > bruteForceConfig.windowMs) {
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

  /** Register a failed attempt */
  recordFailure(key: string): void {
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

  /** Find the first locked key from a list */
  firstLocked(keys: string[]): string | undefined {
    return keys.find((key) => this.isLocked(key));
  }
}

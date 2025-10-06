import { registerAs } from '@nestjs/config';
import ms from 'ms';

export const bruteForceConfig = {
  windowMs: ms('30s'),
  maxAttempts: 20,
  lockMs: ms('2m'),
};
export const bruteForceConfigRegitered = registerAs('bruteForce', () => bruteForceConfig);

export type BruteForceConfig = ReturnType<typeof bruteForceConfigRegitered>;

import ms from 'ms';
import { DaysJwtConfigString } from '../interfaces/jwt.interface';

export function calculateExpiresAt(expiresIn: DaysJwtConfigString, now: number = Date.now()): Date {
  return new Date(now + ms(expiresIn));
}

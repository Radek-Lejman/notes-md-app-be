import ms from 'ms';

export function toSeconds(expr: string): number {
  const v = ms(expr);
  if (typeof v !== 'number') {
    throw new Error(`Invalid time expression: ${expr}`);
  }
  return Math.floor(v / 1000);
}

export function minutesToSeconds(minutes: number | undefined): number {
  if (!minutes) throw new Error('minutes must be defined');
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('minutes must be a non-negative finite number');
  }
  return toSeconds(`${minutes}m`);
}

export function daysToSeconds(days?: number | undefined): number {
  if (!days) throw new Error('days must be defined');
  if (!Number.isFinite(days) || days < 0) {
    throw new Error('days must be a non-negative finite number');
  }
  return toSeconds(`${days}d`);
}

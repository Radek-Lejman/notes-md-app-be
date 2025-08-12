export function minutesToSeconds(minutes: number | undefined): number {
  if (!minutes) throw new Error('minutes must be defined');
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('minutes must be a non-negative finite number');
  }
  return Math.floor(minutes * 60);
}

export function daysToSeconds(days?: number | undefined): number {
  if (!days) throw new Error('days must be defined');
  if (!Number.isFinite(days) || days < 0) {
    throw new Error('days must be a non-negative finite number');
  }
  return Math.floor(days * 24 * 60 * 60);
}

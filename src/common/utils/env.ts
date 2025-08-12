export function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  const value = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function envString(key: string, fallback?: string): string {
  const raw = process.env[key];
  if (raw && raw.trim()) return raw;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${key}`);
}

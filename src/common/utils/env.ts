import { Opts } from '../types/env.types';

export const isProd = process.env.NODE_ENV === 'production';

function rawEnv(name: string): string | undefined {
  const v = process.env[name];

  if (v == null) return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function getEnv<T>(name: string, parse: (raw: string) => T, opts: Opts<T> = {}): T {
  const raw = rawEnv(name);
  if (raw === undefined) {
    if (isProd && opts.requiredInProd) {
      throw new Error(`[config] ${name} is required in production`);
    }
    if (opts.default !== undefined) return opts.default;
    throw new Error(`[config] ${name} is required`);
  }
  return parse(raw);
}

export function envString(name: string, opts?: Opts<string> & { minLength?: number }): string {
  return getEnv(
    name,
    (v) => {
      if (opts?.minLength && v.length < opts.minLength) {
        throw new Error(`[config] ${name} must be at least ${opts.minLength} characters`);
      }
      return v;
    },
    opts,
  );
}

export function envNumber(
  name: string,
  opts?: Opts<number> & { min?: number; max?: number },
): number {
  return getEnv(
    name,
    (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        throw new Error(`[config] ${name} must be a finite number`);
      }
      if (opts?.min !== undefined && n < opts.min) {
        throw new Error(`[config] ${name} must be >= ${opts.min}`);
      }
      if (opts?.max !== undefined && n > opts.max) {
        throw new Error(`[config] ${name} must be <= ${opts.max}`);
      }
      return n;
    },
    opts,
  );
}

export function envBoolean(name: string, opts?: Opts<boolean>): boolean {
  return getEnv(
    name,
    (v) => {
      if (/^(1|true|yes|on)$/i.test(v)) return true;
      if (/^(0|false|no|off)$/i.test(v)) return false;
      throw new Error(`[config] ${name} must be boolean (1/0,true/false,yes/no,on/off)`);
    },
    opts,
  );
}

export function envSecret(name: string, devFallback?: string, minBytes = 32): string {
  const raw = rawEnv(name) ?? (isProd ? undefined : devFallback);
  if (!raw) {
    throw new Error(`[config] ${name} is required${isProd ? ' in production' : ''}`);
  }
  if (Buffer.byteLength(raw, 'utf8') < minBytes) {
    throw new Error(`[config] ${name} must be at least ${minBytes} bytes`);
  }
  return raw;
}

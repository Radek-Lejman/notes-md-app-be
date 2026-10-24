import { envNumber } from 'src/core/config/env';

/**
 * Number of reverse proxies in front of the app (e.g. 1 on Railway). Express then takes the
 * client IP from X-Forwarded-For, and brute force and throttling key on that IP.
 * 0 (default) trusts no proxy: otherwise any client could spoof X-Forwarded-For. Behind a proxy
 * without it, every request has the proxy's IP, so one attacker locks everybody out.
 */
export function trustProxyHops(): number {
  const hops = envNumber('TRUST_PROXY', { default: 0, min: 0, max: 10 });
  if (!Number.isInteger(hops)) throw new Error('[config] TRUST_PROXY must be an integer');
  return hops;
}

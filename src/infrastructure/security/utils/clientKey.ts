import { isIPv4, isIPv6 } from 'net';

/** Expands an IPv6 address (also `::` shorthand and a trailing dotted IPv4 part) to 8 hextets. */
function ipv6Hextets(address: string): string[] {
  let addr = address;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(addr);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    addr = `${addr.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = addr.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((h) => parseInt(h, 16).toString(16));
}

/**
 * The client identity that brute force and rate limits count against. An IPv4 address as is
 * (also when IPv4-mapped, `::ffff:1.2.3.4`); an IPv6 address by its /64 network, because one
 * host or customer usually owns a whole /64 and could otherwise pick a fresh address per request.
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const address = ip.split('%')[0]; // drop an IPv6 zone id
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  if (!isIPv6(address)) return address;
  return `${ipv6Hextets(address).slice(0, 4).join(':')}::/64`;
}

import { clientKey } from './clientKey';

describe('clientKey', () => {
  it('keeps an IPv4 address as is', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('unwraps an IPv4-mapped IPv6 address', () => {
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('groups IPv6 addresses by their /64 network', () => {
    const a = clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8:1:2::1')).toBe(a);
    expect(clientKey('2001:0db8:0001:0002:0:0:0:ffff')).toBe(a);
    expect(clientKey('2001:db8:1:3::1')).not.toBe(a);
  });

  it('expands :: shorthand in any position', () => {
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(clientKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');
  });

  it('handles a trailing dotted IPv4 part in IPv6', () => {
    expect(clientKey('64:ff9b::192.0.2.33')).toBe('64:ff9b:0:0::/64');
  });

  it.each([undefined, ''])('falls back to "unknown" for %j', (ip) => {
    expect(clientKey(ip)).toBe('unknown');
  });
});

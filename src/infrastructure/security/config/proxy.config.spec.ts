import { trustProxyHops } from './proxy.config';

describe('trustProxyHops', () => {
  const original = process.env.TRUST_PROXY;

  afterEach(() => {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  });

  it.each([undefined, '', '0'])('trusts no proxy for %j', (value) => {
    if (value === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = value;

    expect(trustProxyHops()).toBe(0);
  });

  it('returns the configured number of proxies', () => {
    process.env.TRUST_PROXY = '1';
    expect(trustProxyHops()).toBe(1);
  });

  it.each(['-1', '11', '1.5', 'true'])('rejects %j at startup', (value) => {
    process.env.TRUST_PROXY = value;
    expect(() => trustProxyHops()).toThrow('TRUST_PROXY');
  });
});

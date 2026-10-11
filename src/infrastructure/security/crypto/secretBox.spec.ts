import { SecretBox } from './secretBox';

describe('SecretBox', () => {
  const box = new SecretBox('a-long-enough-test-secret-for-the-box');

  it('round-trips a secret for the same context', () => {
    const payload = box.encrypt('sk-ant-oat01-secret', 'user-1');
    expect(box.decrypt(payload, 'user-1')).toBe('sk-ant-oat01-secret');
  });

  it('does not contain the plaintext and differs on every call (random IV)', () => {
    const a = box.encrypt('sk-ant-oat01-secret', 'user-1');
    const b = box.encrypt('sk-ant-oat01-secret', 'user-1');
    expect(a).not.toContain('secret');
    expect(a).not.toBe(b);
  });

  it('fails for another context (ciphertext moved to another user)', () => {
    const payload = box.encrypt('secret', 'user-1');
    expect(() => box.decrypt(payload, 'user-2')).toThrow();
  });

  it('fails with another key', () => {
    const payload = box.encrypt('secret', 'user-1');
    expect(() =>
      new SecretBox('another-secret-another-secret-xx').decrypt(payload, 'user-1'),
    ).toThrow();
  });

  it('fails when the ciphertext was tampered with', () => {
    const [v, iv, tag, ct] = box.encrypt('secret', 'user-1').split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 1;
    expect(() =>
      box.decrypt([v, iv, tag, flipped.toString('base64')].join(':'), 'user-1'),
    ).toThrow();
  });

  it('rejects unknown formats', () => {
    expect(() => box.decrypt('plain-text', 'user-1')).toThrow('Unsupported secret format');
  });
});

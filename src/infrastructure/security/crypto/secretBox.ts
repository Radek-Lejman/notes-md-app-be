import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Authenticated encryption (AES-256-GCM) for secrets stored in the DB.
 * `context` (e.g. the owner's user id) is bound as AAD: a ciphertext copied to
 * another row/user fails to decrypt.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    // Any-length secret -> 32-byte key.
    this.key = createHash('sha256').update(secret, 'utf8').digest();
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, ciphertext]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
      .join(':');
  }

  /** Throws when the data was tampered with, encrypted with another key or for another context. */
  decrypt(payload: string, context: string): string {
    const [version, iv, tag, ciphertext] = payload.split(':');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Unsupported secret format');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

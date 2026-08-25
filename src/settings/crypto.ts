import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

interface Envelope { algorithm: 'aes-256-gcm'; iv: string; tag: string; ciphertext: string; }

function decodeKey(encoded: string): Buffer {
  const key = /^[a-f\d]{64}$/i.test(encoded) ? Buffer.from(encoded, 'hex') : Buffer.from(encoded, 'base64url');
  if (key.length !== 32) throw new Error('CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return key;
}

export class ConfigCipher {
  private readonly key: Buffer;
  constructor(encodedKey: string) { this.key = decodeKey(encodedKey); }

  encrypt(value: unknown): Envelope {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { algorithm: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
  }

  decrypt<T>(envelope: Envelope): T {
    if (envelope.algorithm !== 'aes-256-gcm') throw new Error('Unsupported encrypted configuration format.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  }
}
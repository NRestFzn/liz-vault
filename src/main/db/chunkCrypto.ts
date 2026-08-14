import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { CipherGCM, DecipherGCM } from 'node:crypto';

const ALGO = 'aes-256-gcm';

export function createChunkCipher(keyBase64: string): { cipher: CipherGCM; iv: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, Buffer.from(keyBase64, 'base64'), iv) as CipherGCM;
  return { cipher, iv };
}

export function createChunkDecipher(keyBase64: string, ivBase64: string, tagBase64: string): DecipherGCM {
  const decipher = createDecipheriv(ALGO, Buffer.from(keyBase64, 'base64'), Buffer.from(ivBase64, 'base64')) as DecipherGCM;
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return decipher;
}

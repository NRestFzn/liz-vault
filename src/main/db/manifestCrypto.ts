import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const PREFIX = 'lv1m:';

export function generateManifestKey(): string {
  return randomBytes(32).toString('base64');
}

export function isEncryptedManifest(text: string): boolean {
  return text.startsWith(PREFIX);
}

export function encryptManifest(plain: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptManifest(stored: string, keyBase64: string): string | null {
  if (!isEncryptedManifest(stored)) return stored;
  try {
    const body = stored.slice(PREFIX.length);
    const [ivB64, tagB64, dataB64] = body.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv(ALGO, Buffer.from(keyBase64, 'base64'), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf-8');
  } catch {
    return null;
  }
}

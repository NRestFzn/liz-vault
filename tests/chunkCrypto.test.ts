import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createChunkCipher, createChunkDecipher } from '../src/main/db/chunkCrypto';
import { generateManifestKey } from '../src/main/db/manifestCrypto';

function bufferize(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    stream.on('data', (c: Buffer) => parts.push(c));
    stream.on('end', () => resolve(Buffer.concat(parts)));
    stream.on('error', reject);
  });
}

async function encryptBytes(key: string, plain: Buffer): Promise<{ iv: string; tag: string; ciphertext: Buffer }> {
  const { cipher, iv } = createChunkCipher(key);
  Readable.from([plain]).pipe(cipher);
  const ciphertext = await bufferize(cipher);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext };
}

test('chunk crypto roundtrips bytes', async () => {
  const key = generateManifestKey();
  const plain = Buffer.from('lizvault chunk payload with some length 0123456789');

  const { iv, tag, ciphertext } = await encryptBytes(key, plain);
  assert.notDeepEqual(ciphertext, plain);

  const decipher = createChunkDecipher(key, iv, tag);
  Readable.from([ciphertext]).pipe(decipher);
  const decrypted = await bufferize(decipher);
  assert.deepEqual(decrypted, plain);
});

test('chunk crypto rejects tampered ciphertext', async () => {
  const key = generateManifestKey();
  const plain = Buffer.from('tamper me');

  const { iv, tag, ciphertext } = await encryptBytes(key, plain);
  ciphertext[0] = ciphertext[0] ^ 0xff;

  const decipher = createChunkDecipher(key, iv, tag);
  Readable.from([ciphertext]).pipe(decipher);
  await assert.rejects(bufferize(decipher));
});

test('chunk crypto rejects wrong tag', async () => {
  const key = generateManifestKey();
  const otherKey = generateManifestKey();
  const plain = Buffer.from('wrong tag');

  const { iv, tag, ciphertext } = await encryptBytes(key, plain);

  const decipher = createChunkDecipher(otherKey, iv, tag);
  Readable.from([ciphertext]).pipe(decipher);
  await assert.rejects(bufferize(decipher));
});

test('chunk crypto handles empty chunk', async () => {
  const key = generateManifestKey();
  const { iv, tag, ciphertext } = await encryptBytes(key, Buffer.alloc(0));

  const decipher = createChunkDecipher(key, iv, tag);
  Readable.from([ciphertext]).pipe(decipher);
  const decrypted = await bufferize(decipher);
  assert.deepEqual(decrypted, Buffer.alloc(0));
});

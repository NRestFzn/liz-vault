import { test } from 'node:test';
import assert from 'node:assert';
import { formatBytes } from '../src/shared/format';

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const TB = 1024 * GB;

test('formatBytes handles zero and small values', () => {
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(1), '1 B');
  assert.strictEqual(formatBytes(512), '512 B');
  assert.strictEqual(formatBytes(1023), '1023 B');
});

test('formatBytes converts to KB/MB/GB/TB', () => {
  assert.strictEqual(formatBytes(1 * KB), '1 KB');
  assert.strictEqual(formatBytes(1.5 * KB), '1.5 KB');
  assert.strictEqual(formatBytes(5 * MB), '5 MB');
  assert.strictEqual(formatBytes(3.25 * GB), '3.25 GB');
  assert.strictEqual(formatBytes(2 * TB), '2 TB');
});

test('formatBytes rounds to two decimals', () => {
  assert.strictEqual(formatBytes(1536), '1.5 KB'); // 1.5
  assert.strictEqual(formatBytes(1024 + 256), '1.25 KB');
  assert.strictEqual(formatBytes(Math.floor(1.777 * GB)), '1.78 GB');
});

test('formatBytes stays defined beyond TB (size cap)', () => {
  const huge = 2 * TB * 1024; // 2 PB — beyond the TB table
  assert.ok(formatBytes(huge).endsWith('TB'), formatBytes(huge));
  assert.ok(!formatBytes(huge).includes('undefined'));
});

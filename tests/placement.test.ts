import { test } from 'node:test';
import assert from 'node:assert';
import { planChunks } from '../src/main/vault/placement';
import type { AccountRow } from '../src/shared/types';

const MB = 1024 * 1024;
const GB = 1024 * MB;

function acct(email: string, total: number | null, used: number | null): AccountRow {
  return { id: 1, user_id: 1, email, provider: 'google', refresh_token: 'x', total_bytes: total, used_bytes: used, root_folder_id: null, added_at: '', token_ok: 1, last_checked_at: null };
}

function emails(plan: ReturnType<typeof planChunks>): string {
  return plan.map(c => `${c.account.email}:${c.size}`).join(' + ');
}

test('whole file fits in first account → one chunk, no splitting', () => {
  const plan = planChunks([acct('a@gmail.com', 15 * GB, 0), acct('b@gmail.com', 15 * GB, 0)], 2 * GB);
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].account.email, 'a@gmail.com');
  assert.strictEqual(plan[0].size, 2 * GB);
  assert.strictEqual(plan[0].startByte, 0);
  assert.strictEqual(plan[0].endByte, 2 * GB - 1);
});

test('first account has 1GB free, 2GB file → fill it, rest to next', () => {
  const plan = planChunks([acct('a@gmail.com', 15 * GB, 14 * GB), acct('b@gmail.com', 15 * GB, 0)], 2 * GB);
  assert.strictEqual(plan.length, 2, emails(plan));
  assert.deepStrictEqual(
    plan.map(c => [c.account.email, c.size]),
    [['a@gmail.com', 1 * GB], ['b@gmail.com', 1 * GB]]
  );
});

test('100% full first account is skipped, whole file goes to next', () => {
  const plan = planChunks([acct('a@gmail.com', 15 * GB, 15 * GB), acct('b@gmail.com', 15 * GB, 0)], 2 * GB);
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].account.email, 'b@gmail.com');
  assert.strictEqual(plan[0].size, 2 * GB);
});

test('near-miss: 15GB file, 100MB sliver free → zero waste, 2 chunks', () => {
  const plan = planChunks([acct('a@gmail.com', 15 * GB, 100 * MB), acct('b@gmail.com', 15 * GB, 0)], 15 * GB);
  assert.strictEqual(plan.length, 2, emails(plan));
  assert.strictEqual(plan[0].size, 15 * GB - 100 * MB);
  assert.strictEqual(plan[1].size, 100 * MB);
});

test('file bigger than any single account → fill accounts in order', () => {
  const plan = planChunks([acct('a@gmail.com', 15 * GB, 0), acct('b@gmail.com', 15 * GB, 0)], 20 * GB);
  assert.deepStrictEqual(
    plan.map(c => c.size),
    [15 * GB, 5 * GB]
  );
});

test('small sliver (512MB) is fully used before moving on', () => {
  const plan = planChunks([acct('a@gmail.com', 15 * GB, 14 * GB + 512 * MB), acct('b@gmail.com', 15 * GB, 0)], 2 * GB);
  assert.deepStrictEqual(
    plan.map(c => c.size),
    [512 * MB, 2 * GB - 512 * MB]
  );
});

test('throws when no account has space', () => {
  assert.throws(
    () => planChunks([acct('a@gmail.com', 15 * GB, 15 * GB), acct('b@gmail.com', 15 * GB, 15 * GB)], 1),
    /No account has enough free space/
  );
});

test('throws when no accounts linked', () => {
  assert.throws(() => planChunks([], 1), /No storage accounts linked/);
});

test('whole file goes to dropbox when google is full', () => {
  const google = acct('g@gmail.com', 15 * GB, 15 * GB);
  const dropbox = { ...acct('me@dropbox.com', 2 * GB, 0), provider: 'dropbox' as const };
  const plan = planChunks([google, dropbox], 2 * GB);
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].account.provider, 'dropbox');
  assert.strictEqual(plan[0].size, 2 * GB);
});

test('dropbox absorbs spill after google fills (connection order)', () => {
  const google = acct('g@gmail.com', 15 * GB, 14 * GB);
  const dropbox = { ...acct('me@dropbox.com', 2 * GB, 0), provider: 'dropbox' as const };
  const plan = planChunks([google, dropbox], 2 * GB);
  assert.deepStrictEqual(
    plan.map(c => [c.account.email, c.account.provider, c.size]),
    [['g@gmail.com', 'google', 1 * GB], ['me@dropbox.com', 'dropbox', 1 * GB]]
  );
});

test('koofr only fills when earlier accounts run out (connection order)', () => {
  const google = acct('g@gmail.com', 15 * GB, 14 * GB);
  const dropbox = { ...acct('me@dropbox.com', 2 * GB, 0), provider: 'dropbox' as const };
  const koofr = { ...acct('me@koofr.eu', 10 * GB, 0), provider: 'koofr' as const };
  const plan = planChunks([google, dropbox, koofr], 3 * GB);
  assert.deepStrictEqual(
    plan.map(c => [c.account.provider, c.size]),
    [['google', 1 * GB], ['dropbox', 2 * GB]]
  );
  assert.strictEqual(plan.some(c => c.account.provider === 'koofr'), false);

  const plan2 = planChunks([google, dropbox, koofr], 5 * GB);
  assert.deepStrictEqual(
    plan2.map(c => [c.account.provider, c.size]),
    [['google', 1 * GB], ['dropbox', 2 * GB], ['koofr', 2 * GB]]
  );
});

test('zero-byte file → one empty chunk in first usable account', () => {
  const plan = planChunks([acct('a@gmail.com', 15 * GB, 0), acct('b@gmail.com', 15 * GB, 0)], 0);
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].size, 0);
  assert.strictEqual(plan[0].account.email, 'a@gmail.com');
});

test('unknown quota account treated as having space → gets whole file', () => {
  const plan = planChunks([acct('a@gmail.com', null, null), acct('b@gmail.com', 15 * GB, 0)], 5 * GB);
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].account.email, 'a@gmail.com');
  assert.strictEqual(plan[0].size, 5 * GB);
});


test('byte ranges are contiguous and cover the whole file; usage exact', () => {
  const plan = planChunks(
    [acct('a@gmail.com', 15 * GB, 10 * GB), acct('b@gmail.com', 15 * GB, 3 * GB), acct('c@gmail.com', 15 * GB, 0)],
    25 * GB
  );
  assert.strictEqual(plan.length, 3, emails(plan));
  let prevEnd = -1;
  let total = 0;
  for (const c of plan) {
    assert.strictEqual(c.startByte, prevEnd + 1);
    total += c.size;
    prevEnd = c.endByte;
  }
  assert.strictEqual(total, 25 * GB);
  assert.strictEqual(plan[plan.length - 1].endByte, 25 * GB - 1);
  assert.deepStrictEqual(plan.map(c => c.size), [5 * GB, 12 * GB, 8 * GB]);
});

import type { AccountRow } from '../../shared/types';

export interface ChunkPlanEntry {
  account: AccountRow;
  startByte: number;
  endByte: number;
  size: number;
}

/** Free bytes on an account, or null when its quota is unknown. */
export function availableBytes(account: AccountRow): number | null {
  if (account.total_bytes && account.used_bytes !== null) {
    return account.total_bytes - account.used_bytes;
  }
  return null;
}

/**
 * Decide where each chunk goes. Accounts are filled in connection order:
 * - accounts that are 100% full are skipped
 * - if an account can fit the whole remaining file, it gets it as ONE chunk (no splitting)
 * - otherwise the account is filled to the top with a single chunk of its exact free space,
 *   so no usable storage is left behind while a later account is touched
 */
export function planChunks(accounts: AccountRow[], totalBytes: number): ChunkPlanEntry[] {
  if (accounts.length === 0) {
    throw new Error('No Google Drive accounts linked.');
  }

  const plan: ChunkPlanEntry[] = [];

  if (totalBytes === 0) {
    const first = accounts.find(a => {
      const available = availableBytes(a);
      return available === null || available > 0;
    }) ?? accounts[0];
    plan.push({ account: first, startByte: 0, endByte: 0, size: 0 });
    return plan;
  }

  let remaining = totalBytes;
  let startByte = 0;

  for (const account of accounts) {
    if (remaining <= 0) break;

    const available = availableBytes(account);

    // 100% full — skip; the whole file goes to a later account.
    if (available !== null && available <= 0) continue;

    // Fits entirely (or quota unknown — assume it can hold the rest): one chunk, no splitting.
    if (available === null || available >= remaining) {
      plan.push({ account, startByte, endByte: startByte + remaining - 1, size: remaining });
      remaining = 0;
      break;
    }

    // Fill this account to the top with its exact free space.
    plan.push({ account, startByte, endByte: startByte + available - 1, size: available });
    startByte += available;
    remaining -= available;
  }

  if (remaining > 0) {
    throw new Error('No account has enough free space for this file.');
  }

  return plan;
}


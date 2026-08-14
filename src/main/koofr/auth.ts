import { addAccount } from '../db/queries';
import type { AccountRow } from '../../shared/types';
import { logE2E } from '../e2eLog';
import {
  koofrEnsureFolder,
  koofrGetProfile,
  koofrGetQuota,
} from './drive';

const STORAGE_FOLDER_NAME = 'LizVault';

export interface KoofrConnectResult {
  account: AccountRow;
  folderCreated: boolean;
}

export async function connectKoofrAccount(userId: number, email: string, password: string): Promise<KoofrConnectResult> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail || !password) {
    throw new Error('Koofr email and app password are required.');
  }

  logE2E('oauth.koofr.start', { userId });
  console.log('[Koofr] Validating credentials…');
  const profile = await koofrGetProfile(trimmedEmail, password);
  console.log('[Koofr] Account:', profile.email, 'display:', profile.displayName);

  const { total, used } = await koofrGetQuota(trimmedEmail, password);
  console.log('[Koofr] Quota:', total, 'used:', used);

  const { id: rootFolderId, created: folderCreated } = await koofrEnsureFolder(trimmedEmail, password, STORAGE_FOLDER_NAME);
  console.log(`[Koofr] ${folderCreated ? 'Created' : 'Found existing'} ${STORAGE_FOLDER_NAME} storage folder (mount):`, rootFolderId);

  const account = addAccount({
    user_id: userId,
    email: profile.email,
    provider: 'koofr',
    refresh_token: password,
    total_bytes: total,
    used_bytes: used,
    root_folder_id: rootFolderId,
  });
  logE2E('oauth.koofr.complete', { userId, email: profile.email, accountId: account.id, quotaTotal: total, quotaUsed: used, folderCreated, rootFolderId });
  console.log('[Koofr] Account saved ✓ id:', account.id, 'display:', profile.displayName);

  return { account, folderCreated };
}

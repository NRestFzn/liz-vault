import { getChunksForFile, getAccountByEmail, removeFile, getChildIds, getFile, updateAccountUsage, getAppState, getTrashedFiles } from '../db/queries';
import { deleteChunkFile } from './storage';
import { errorCode } from '../errors';
import { logE2E, logE2EError } from '../e2eLog';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function sweepExpiredTrash(userId: number): Promise<void> {
  const raw = getAppState('autoEmptyTrashDays');
  const days = raw == null ? 0 : parseInt(raw, 10);
  if (!Number.isFinite(days) || days <= 0) return;

  const cutoff = Date.now() - days * DAY_MS;
  const expired = getTrashedFiles(userId).filter(f => {
    if (!f.deleted_at) return false;
    const t = Date.parse(f.deleted_at.endsWith('Z') || f.deleted_at.includes('T') ? f.deleted_at : `${f.deleted_at.replace(' ', 'T')}Z`);
    return Number.isFinite(t) && t < cutoff;
  });

  for (const f of expired) {
    try {
      await deleteFileChunks(userId, f.id);
      logE2E('trash.auto-emptied', { fileId: f.id, name: f.name, deletedAt: f.deleted_at });
    } catch (e) {
      logE2EError('trash.auto-empty.error', e, { fileId: f.id, name: f.name });
    }
  }
}

function collectDescendantIds(userId: number, folderId: number): number[] {
  const ids: number[] = [folderId];
  const queue: number[] = [folderId];
  let i = 0;
  while (i < queue.length) {
    const current = queue[i++];
    for (const childId of getChildIds(userId, current)) {
      ids.push(childId);
      queue.push(childId);
    }
  }
  return ids;
}

export async function deleteFileChunks(userId: number, fileId: number): Promise<number[]> {
  const target = getFile(fileId, userId);
  if (!target) return [];

  const fileIds = target.is_folder === 1 ? collectDescendantIds(userId, fileId) : [fileId];
  logE2E('delete.start', { fileId, name: target.name, isFolder: target.is_folder === 1, affectedIds: fileIds.length });

  for (const id of fileIds) {
    const chunks = getChunksForFile(id);

    for (const chunk of chunks) {
      try {
        const account = getAccountByEmail(chunk.account_email, chunk.account_provider);
        if (account) {
          await deleteChunkFile(account, chunk.drive_file_id).catch(err => {
            if (errorCode(err) !== 404) {
              console.error(`Failed to delete chunk ${chunk.id} from drive:`, err);
              logE2EError('chunk.delete.error', err, { fileId: id, chunkId: chunk.id, provider: account.provider, accountEmail: account.email });
            }
          });
          logE2E('chunk.delete.success', { fileId: id, chunkId: chunk.id, provider: account.provider, accountEmail: account.email, size: chunk.size_bytes });

          if (account.used_bytes !== null) {
            const newUsage = Math.max(0, account.used_bytes - chunk.size_bytes);
            updateAccountUsage(account.id, userId, newUsage);
          }
        }
      } catch (e) {
        console.error(`Error processing chunk ${chunk.id} deletion:`, e);
        logE2EError('chunk.delete.error', e, { fileId: id, chunkId: chunk.id });
      }
    }
  }

  removeFile(fileId, userId);
  logE2E('delete.complete', { fileId, name: target.name, affectedIds: fileIds.length });
  return fileIds;
}

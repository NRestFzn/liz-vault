import { getChunksForFile, getAccountByEmail, removeFile, getChildIds, getFile, updateAccountUsage } from '../db/queries';
import { getDriveClient } from '../google/auth';

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

  for (const id of fileIds) {
    const chunks = getChunksForFile(id);

    for (const chunk of chunks) {
      try {
        const account = getAccountByEmail(chunk.account_email);
        if (account) {
          const drive = getDriveClient(account.refresh_token);

          await drive.files.delete({ fileId: chunk.drive_file_id }).catch(err => {
            if (err.code !== 404) {
              console.error(`Failed to delete chunk ${chunk.id} from drive:`, err);
            }
          });

          if (account.used_bytes !== null) {
            const newUsage = Math.max(0, account.used_bytes - chunk.size_bytes);
            updateAccountUsage(account.id, userId, newUsage);
          }
        }
      } catch (e) {
        console.error(`Error processing chunk ${chunk.id} deletion:`, e);
      }
    }
  }

  removeFile(fileId, userId);
  return fileIds;
}

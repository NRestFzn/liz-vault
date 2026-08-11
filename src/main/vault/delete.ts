import { getChunksForFile, getAccount, removeFile, getChildIds, getFile, updateAccountUsage } from '../db/queries';
import { getDriveClient } from '../google/auth';

/**
 * Collect every file id under `folderId` (including the folder itself),
 * traversing subfolders breadth-first. Files at any depth are included.
 * Index-based queue to avoid O(n²) shift() re-indexing.
 */
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

/**
 * Delete a file or folder from all connected drives and the DB.
 * Folders are deleted recursively — every file inside (at any depth) has its
 * Drive chunks removed first, then the folder row is removed and the FK
 * `ON DELETE CASCADE` cleans up the rest of the DB rows.
 *
 * Returns the ids of every deleted row (for thumbnail-cache cleanup).
 */
export async function deleteFileChunks(userId: number, fileId: number): Promise<number[]> {
  const target = getFile(fileId, userId);
  if (!target) return [];

  // Folders themselves have no chunks; their children do.
  const fileIds = target.is_folder === 1 ? collectDescendantIds(userId, fileId) : [fileId];

  for (const id of fileIds) {
    const chunks = getChunksForFile(id);

    for (const chunk of chunks) {
      try {
        const account = getAccount(chunk.account_id, userId);
        if (account) {
          const drive = getDriveClient(account.refresh_token);

          // Attempt to delete from Drive
          await drive.files.delete({ fileId: chunk.drive_file_id }).catch(err => {
            // If 404, it's already gone, which is fine
            if (err.code !== 404) {
              console.error(`Failed to delete chunk ${chunk.id} from drive:`, err);
            }
          });

          // Update account usage
          if (account.used_bytes !== null) {
            // Prevent negative usage if db out of sync
            const newUsage = Math.max(0, account.used_bytes - chunk.size_bytes);
            updateAccountUsage(account.id, userId, newUsage);
          }
        }
      } catch (e) {
        console.error(`Error processing chunk ${chunk.id} deletion:`, e);
        // We continue deleting other chunks even if one fails
      }
    }
  }

  // Deleting the top folder row cascades to all descendant rows via FK.
  removeFile(fileId, userId);
  return fileIds;
}

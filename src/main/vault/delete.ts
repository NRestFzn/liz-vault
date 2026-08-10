import { getChunksForFile, getAccount, removeFile, updateAccountUsage } from '../db/queries';
import { getDriveClient } from '../google/auth';

export async function deleteFileChunks(fileId: number) {
  const chunks = getChunksForFile(fileId);
  
  for (const chunk of chunks) {
    try {
      const account = getAccount(chunk.account_id);
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
          updateAccountUsage(account.id, newUsage);
        }
      }
    } catch (e) {
      console.error(`Error processing chunk ${chunk.id} deletion:`, e);
      // We continue deleting other chunks even if one fails
    }
  }

  // The DB foreign key cascading will delete the chunks when the file is deleted
  // Or we just call removeFile which deletes from DB
  removeFile(fileId);
}

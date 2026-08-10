import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import { addFile, updateFileStatus, getAllAccounts, updateAccountUsage, addChunk } from '../db/queries';
import { getDriveClient } from '../google/auth';
import { CHUNK_SIZE } from '../../shared/constants';

export async function uploadFile(mainWindow: BrowserWindow, filePath: string, fileName: string) {
  const stat = fs.statSync(filePath);
  const totalBytes = stat.size;

  // Insert to DB as uploading
  const fileRow = addFile({
    name: fileName,
    size_bytes: totalBytes,
    mime_type: null,
    status: 'uploading'
  });

  const fileId = fileRow.id;
  let bytesUploaded = 0;
  let chunkIndex = 0;

  try {
    const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });

    for await (const chunkBuffer of stream) {
      const accounts = getAllAccounts();
      if (accounts.length === 0) {
        throw new Error('No Google Drive accounts linked.');
      }

      // Find account with most available space that can fit this chunk
      let targetAccount = null;
      let maxAvailable = -1;

      for (const account of accounts) {
        if (account.total_bytes && account.used_bytes !== null) {
          const available = account.total_bytes - account.used_bytes;
          if (available > maxAvailable) {
            maxAvailable = available;
            targetAccount = account;
          }
        } else {
          // If quota is unknown, assume it has space for MVP purposes
          if (maxAvailable === -1) {
            targetAccount = account;
          }
        }
      }

      if (!targetAccount) {
        targetAccount = accounts[0]; // fallback
      }

      if (maxAvailable !== -1 && maxAvailable < chunkBuffer.length) {
        throw new Error('No account has enough free space for the next chunk.');
      }

      const drive = getDriveClient(targetAccount.refresh_token);

      const media = {
        mimeType: 'application/octet-stream',
        body: require('stream').Readable.from(chunkBuffer),
      };

      // Upload chunk to Drive
      const driveFile = await drive.files.create({
        requestBody: {
          name: `${fileName}.chunk${chunkIndex}`,
          parents: targetAccount.root_folder_id ? [targetAccount.root_folder_id] : undefined
        },
        media: media,
        fields: 'id'
      });

      const driveFileId = driveFile.data.id!;

      // Save chunk to DB
      addChunk({
        file_id: fileId,
        account_id: targetAccount.id,
        drive_file_id: driveFileId,
        sequence: chunkIndex,
        size_bytes: chunkBuffer.length,
        status: 'uploaded'
      });

      // Update account usage (approximate by adding chunk size)
      if (targetAccount.used_bytes !== null) {
        updateAccountUsage(targetAccount.id, targetAccount.used_bytes + chunkBuffer.length);
      }

      bytesUploaded += chunkBuffer.length;

      // Emit progress
      mainWindow.webContents.send('upload:progress', {
        fileId,
        bytesUploaded,
        totalBytes,
        chunkIndex
      });

      chunkIndex++;
    }

    updateFileStatus(fileId, 'ready');
    const completedFile = { ...fileRow, status: 'ready' as const };
    
    mainWindow.webContents.send('upload:complete', { fileId, file: completedFile });

  } catch (error: any) {
    console.error('Upload error:', error);
    updateFileStatus(fileId, 'error');
    mainWindow.webContents.send('upload:error', { fileId, error: String(error) });
    throw error;
  }
}

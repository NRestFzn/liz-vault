import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import { addFile, updateFileStatus, getAllAccounts, updateAccountUsage, addChunk } from '../db/queries';
import { getDriveClient } from '../google/auth';
import { CHUNK_SIZE } from '../../shared/constants';

export async function uploadFile(userId: number, mainWindow: BrowserWindow, filePath: string, fileName: string, parentFolderId: number | null = null) {
  if (!filePath) {
    throw new Error('Upload failed: filePath is undefined. This may be due to a browser security restriction on file inputs.');
  }

  const stat = fs.statSync(filePath);
  const totalBytes = stat.size;

  // Insert to DB as uploading
  const fileRow = addFile({
    user_id: userId,
    name: fileName,
    size_bytes: totalBytes,
    mime_type: null,
    status: 'uploading',
    is_folder: 0,
    parent_folder_id: parentFolderId,
    is_starred: 0
  });

  const fileId = fileRow.id;
  let bytesUploaded = 0;
  let chunkIndex = 0;

  try {
    const chunksCount = Math.max(1, Math.ceil(totalBytes / CHUNK_SIZE));

    for (let chunkIndex = 0; chunkIndex < chunksCount; chunkIndex++) {
      const startByte = chunkIndex * CHUNK_SIZE;
      let endByte = Math.min(startByte + CHUNK_SIZE - 1, totalBytes - 1);
      if (totalBytes === 0) endByte = 0;
      
      const chunkSize = totalBytes === 0 ? 0 : endByte - startByte + 1;

      const accounts = getAllAccounts(userId);
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

      if (maxAvailable !== -1 && maxAvailable < chunkSize) {
        throw new Error('No account has enough free space for the next chunk.');
      }

      const drive = getDriveClient(targetAccount.refresh_token);

      let stream;
      if (totalBytes === 0) {
        stream = require('stream').Readable.from([Buffer.alloc(0)]);
      } else {
        stream = fs.createReadStream(filePath, { start: startByte, end: endByte });
      }

      let chunkBytesRead = 0;
      // Track progress while streaming to Google
      stream.on('data', (dataChunk: Buffer | string) => {
        chunkBytesRead += dataChunk.length;
        // Emit progress
        mainWindow.webContents.send('upload:progress', {
          fileId,
          fileName,
          bytesUploaded: (chunkIndex * CHUNK_SIZE) + chunkBytesRead,
          totalBytes,
          chunkIndex
        });
      });

      const media = {
        mimeType: 'application/octet-stream',
        body: stream,
      };

      let driveFileId;
      try {
        // Upload chunk to Drive
        const driveFile = await drive.files.create({
          requestBody: {
            name: `${fileName}.chunk${chunkIndex}`,
            parents: targetAccount.root_folder_id ? [targetAccount.root_folder_id] : undefined
          },
          media: media,
          fields: 'id'
        });
        driveFileId = driveFile.data.id!;
      } catch (err: any) {
        if (err.code === 404 && targetAccount.root_folder_id) {
          console.warn('[Upload] 404 on upload. Root folder missing. Re-creating LizVault_Data...');
          const folder = await drive.files.create({
            requestBody: {
              name: 'LizVault_Data',
              mimeType: 'application/vnd.google-apps.folder'
            },
            fields: 'id'
          });
          const newRootId = folder.data.id!;
          
          const { getDb } = require('../db/schema');
          getDb().prepare('UPDATE accounts SET root_folder_id = ? WHERE id = ? AND user_id = ?').run(newRootId, targetAccount.id, userId);
          targetAccount.root_folder_id = newRootId;

          // Re-create stream for retry
          chunkBytesRead = 0;
          let newStream;
          if (totalBytes === 0) {
            newStream = require('stream').Readable.from([Buffer.alloc(0)]);
          } else {
            newStream = fs.createReadStream(filePath, { start: startByte, end: endByte });
            newStream.on('data', (dataChunk: Buffer | string) => {
              chunkBytesRead += dataChunk.length;
              mainWindow.webContents.send('upload:progress', { fileId, fileName, bytesUploaded: (chunkIndex * CHUNK_SIZE) + chunkBytesRead, totalBytes, chunkIndex });
            });
          }

          const retryFile = await drive.files.create({
            requestBody: {
              name: `${fileName}.chunk${chunkIndex}`,
              parents: [newRootId]
            },
            media: { mimeType: 'application/octet-stream', body: newStream },
            fields: 'id'
          });
          driveFileId = retryFile.data.id!;
        } else {
          throw err;
        }
      }

      // Save chunk to DB
      addChunk({
        file_id: fileId,
        account_id: targetAccount.id,
        drive_file_id: driveFileId,
        sequence: chunkIndex,
        size_bytes: chunkSize,
        status: 'uploaded'
      });

      // Update account usage (approximate by adding chunk size)
      if (targetAccount.used_bytes !== null) {
        updateAccountUsage(targetAccount.id, userId, targetAccount.used_bytes + chunkSize);
      }
    }

    updateFileStatus(fileId, userId, 'ready');
    const completedFile = { ...fileRow, status: 'ready' as const };
    
    mainWindow.webContents.send('upload:complete', { fileId, file: completedFile });

  } catch (error: any) {
    console.error('Upload error:', error);
    updateFileStatus(fileId, userId, 'error');
    mainWindow.webContents.send('upload:error', { fileId, error: String(error) });
    throw error;
  }
}

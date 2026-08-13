import fs from 'node:fs';
import type { BrowserWindow } from 'electron';
import { addFile, updateFileStatus, getAllAccounts, updateAccountUsage, addChunk, updateAccountRootFolder, getFilesInFolder, getChunksForFile } from '../db/queries';
import { getDriveClient, findOrCreateFolder } from '../google/auth';
import { planChunks } from './placement';
import { deleteFileChunks } from './delete';
import { errorCode, errorMessage } from '../errors';

export async function uploadFile(userId: number, mainWindow: BrowserWindow, filePath: string, fileName: string, parentFolderId: number | null = null) {
  if (!filePath) {
    throw new Error('Upload failed: filePath is undefined. This may be due to a browser security restriction on file inputs.');
  }

  const stat = fs.statSync(filePath);
  const totalBytes = stat.size;

  await cleanStaleUploadState(userId, fileName, parentFolderId);

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

  try {
    const plan = planChunks(getAllAccounts(userId), totalBytes);

    for (let i = 0; i < plan.length; i++) {
      const entry = plan[i];
      const chunkIndex = i;
      const targetAccount = entry.account;
      const startByte = entry.startByte;
      const endByte = entry.endByte;
      const chunkSize = entry.size;

      const drive = getDriveClient(targetAccount.refresh_token);

      let stream: NodeJS.ReadableStream;
      if (totalBytes === 0) {
        stream = require('node:stream').Readable.from([Buffer.alloc(0)]);
      } else {
        stream = fs.createReadStream(filePath, { start: startByte, end: endByte });
      }

      let chunkBytesRead = 0;
      stream.on('data', (dataChunk: Buffer | string) => {
        chunkBytesRead += dataChunk.length;
        mainWindow.webContents.send('upload:progress', {
          fileId,
          fileName,
          bytesUploaded: bytesUploaded + chunkBytesRead,
          totalBytes,
          chunkIndex
        });
      });

      const media = {
        mimeType: 'application/octet-stream',
        body: stream,
      };

      let driveFileId: string;
      try {
        const driveFile = await drive.files.create({
          requestBody: {
            name: `${fileName}.chunk${chunkIndex}`,
            parents: targetAccount.root_folder_id ? [targetAccount.root_folder_id] : undefined
          },
          media: media,
          fields: 'id'
        });
        const id = driveFile.data.id;
        if (!id) throw new Error('Drive did not return an id for the uploaded chunk.');
        driveFileId = id;
      } catch (err) {
        if (errorCode(err) === 404 && targetAccount.root_folder_id) {
          console.warn('[Upload] 404 on upload. Root folder missing. Re-creating LizVault_Data...');
          const { id: newRootId } = await findOrCreateFolder(drive, 'LizVault', 'LizVault_Data');

          updateAccountRootFolder(targetAccount.id, userId, newRootId);
          targetAccount.root_folder_id = newRootId;

          chunkBytesRead = 0;
          let newStream: NodeJS.ReadableStream;
          if (totalBytes === 0) {
            newStream = require('node:stream').Readable.from([Buffer.alloc(0)]);
          } else {
            newStream = fs.createReadStream(filePath, { start: startByte, end: endByte });
            newStream.on('data', (dataChunk: Buffer | string) => {
              chunkBytesRead += dataChunk.length;
              mainWindow.webContents.send('upload:progress', { fileId, fileName, bytesUploaded: bytesUploaded + chunkBytesRead, totalBytes, chunkIndex });
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
          const id = retryFile.data.id;
          if (!id) throw new Error('Drive did not return an id for the uploaded chunk.');
          driveFileId = id;
        } else {
          throw err;
        }
      }

      addChunk({
        file_id: fileId,
        account_email: targetAccount.email,
        drive_file_id: driveFileId,
        sequence: chunkIndex,
        size_bytes: chunkSize,
        status: 'uploaded'
      });

      if (targetAccount.used_bytes !== null) {
        updateAccountUsage(targetAccount.id, userId, targetAccount.used_bytes + chunkSize);
      }

      bytesUploaded += chunkSize;
    }

    updateFileStatus(fileId, userId, 'ready');
    const completedFile = { ...fileRow, status: 'ready' as const };
    
    mainWindow.webContents.send('upload:complete', { fileId, file: completedFile });

  } catch (error) {
    console.error('Upload error:', error);
    try {
      await deleteFileChunks(userId, fileId);
      mainWindow.webContents.send('file:deleted', { fileId });
    } catch (cleanupError) {
      console.error('Failed to clean up partial upload (chunks may remain on Drive):', cleanupError);
    }
    mainWindow.webContents.send('upload:error', { fileId, error: String(error) });
    throw error;
  }
}

async function cleanStaleUploadState(userId: number, fileName: string, parentFolderId: number | null): Promise<void> {
  const staleRows = getFilesInFolder(userId, parentFolderId).filter(f => f.name === fileName && f.status !== 'ready');
  for (const row of staleRows) {
    try {
      await deleteFileChunks(userId, row.id);
    } catch (e) {
      console.warn(`[Upload] Failed to clean stale row ${row.id}:`, errorMessage(e));
    }
  }

  const registered = new Set<string>();
  for (const row of getFilesInFolder(userId, parentFolderId).filter(f => f.name === fileName)) {
    for (const chunk of getChunksForFile(row.id)) registered.add(chunk.drive_file_id);
  }
  await sweepOrphanChunks(userId, fileName, [...registered]);
}

async function sweepOrphanChunks(userId: number, fileName: string, registeredIds: string[]): Promise<void> {
  const registered = new Set(registeredIds);
  const safeName = fileName.replace(/'/g, "\\'");
  for (const account of getAllAccounts(userId)) {
    if (!account.root_folder_id) continue;
    try {
      const drive = getDriveClient(account.refresh_token);
      const res = await drive.files.list({
        q: `name contains '${safeName}.chunk' and '${account.root_folder_id}' in parents and trashed=false`,
        spaces: 'drive',
        fields: 'files(id,name)',
      });
      for (const f of res.data.files || []) {
        if (!f.id) continue;
        if (!registered.has(f.id)) {
          await drive.files.delete({ fileId: f.id });
          console.warn(`[Upload] Deleted orphan chunk "${f.name}" (${f.id}) from ${account.email}`);
        }
      }
    } catch (e) {
      console.warn(`[Upload] Orphan sweep failed for ${account.email}:`, errorMessage(e));
    }
  }
}

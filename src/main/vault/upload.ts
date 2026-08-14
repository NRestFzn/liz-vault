import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { addFile, updateFileStatus, getAllAccounts, updateAccountUsage, addChunk, updateAccountRootFolder, getFilesInFolder, getChunksForFile, createFolder, findDuplicateName, getUniqueName, getAppState } from '../db/queries';
import { ensureUserManifestKey } from '../db/config';
import { createChunkCipher } from '../db/chunkCrypto';
import { getDriveClient } from '../google/auth';
import { planChunks } from './placement';
import { deleteFileChunks } from './delete';
import { chunkName, deleteChunkFile, ensureStorageFolder, listFolderFiles, sanitizeName, uploadChunk } from './storage';
import { errorCode, errorMessage } from '../errors';
import { logE2E, logE2EError } from '../e2eLog';

export async function uploadFile(userId: number, mainWindow: BrowserWindow, filePath: string, fileName: string, parentFolderId: number | null = null) {
  if (!filePath) {
    throw new Error('Upload failed: filePath is undefined. This may be due to a browser security restriction on file inputs.');
  }

  const stat = fs.statSync(filePath);
  const totalBytes = stat.size;
  logE2E('upload.start', { fileId: 0, fileName, totalBytes, parentFolderId });

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
    logE2E('upload.plan', {
      fileId,
      fileName,
      totalBytes,
      chunks: plan.map(c => ({ provider: c.account.provider, email: c.account.email, size: c.size, startByte: c.startByte, endByte: c.endByte })),
    });

    for (let i = 0; i < plan.length; i++) {
      const entry = plan[i];
      const chunkIndex = i;
      const targetAccount = entry.account;
      const startByte = entry.startByte;
      const endByte = entry.endByte;
      const chunkSize = entry.size;

      let sourceStream: NodeJS.ReadableStream;
      if (totalBytes === 0) {
        sourceStream = require('node:stream').Readable.from([Buffer.alloc(0)]);
      } else {
        sourceStream = fs.createReadStream(filePath, { start: startByte, end: endByte });
      }

      let chunkBytesRead = 0;
      sourceStream.on('data', (dataChunk: Buffer | string) => {
        chunkBytesRead += dataChunk.length;
        mainWindow.webContents.send('upload:progress', {
          fileId,
          fileName,
          bytesUploaded: bytesUploaded + chunkBytesRead,
          totalBytes,
          chunkIndex
        });
      });

      const manifestKey = ensureUserManifestKey(userId);
      let encCipher: import('node:crypto').CipherGCM;
      let encIv: Buffer;
      let encTag = '';
      const initial = createChunkCipher(manifestKey);
      encCipher = initial.cipher;
      encIv = initial.iv;
      sourceStream.pipe(encCipher);

      const chunkFile = chunkName(fileName, chunkIndex, targetAccount.provider);

      let driveFileId: string;
      try {
        logE2E('chunk.upload.start', { fileId, fileName, chunkIndex, provider: targetAccount.provider, accountEmail: targetAccount.email, chunkSize, startByte, endByte });
        driveFileId = await uploadChunk(targetAccount, chunkFile, encCipher, chunkSize);
        encTag = encCipher.getAuthTag().toString('base64');
        logE2E('chunk.upload.success', { fileId, fileName, chunkIndex, provider: targetAccount.provider, accountEmail: targetAccount.email, driveFileId });
      } catch (err) {
        if (errorCode(err) === 404 && targetAccount.root_folder_id) {
          console.warn('[Upload] 404 on upload. Root folder missing. Re-creating LizVault...');
          logE2E('chunk.upload.retry-404', { fileId, fileName, chunkIndex, provider: targetAccount.provider, accountEmail: targetAccount.email });
          const { id: newRootId } = await ensureStorageFolder(targetAccount, 'LizVault', 'LizVault_Data');

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

          const retryCipher = createChunkCipher(manifestKey);
          encCipher = retryCipher.cipher;
          encIv = retryCipher.iv;
          newStream.pipe(retryCipher.cipher);
          driveFileId = await uploadChunk(targetAccount, chunkFile, retryCipher.cipher, chunkSize);
          encTag = retryCipher.cipher.getAuthTag().toString('base64');
          logE2E('chunk.upload.retry-success', { fileId, fileName, chunkIndex, provider: targetAccount.provider, accountEmail: targetAccount.email, driveFileId });
        } else {
          logE2EError('chunk.upload.error', err, { fileId, fileName, chunkIndex, provider: targetAccount.provider, accountEmail: targetAccount.email });
          throw err;
        }
      }

      addChunk({
        file_id: fileId,
        account_email: targetAccount.email,
        account_provider: targetAccount.provider,
        drive_file_id: driveFileId,
        sequence: chunkIndex,
        size_bytes: chunkSize,
        status: 'uploaded',
        enc_iv: encIv.toString('base64'),
        enc_tag: encTag
      });

      if (targetAccount.used_bytes !== null) {
        updateAccountUsage(targetAccount.id, userId, targetAccount.used_bytes + chunkSize);
      }

      bytesUploaded += chunkSize;
    }

    updateFileStatus(fileId, userId, 'ready');
    const completedFile = { ...fileRow, status: 'ready' as const };
    
    mainWindow.webContents.send('upload:complete', { fileId, file: completedFile });
    logE2E('upload.complete', { fileId, fileName, totalBytes, chunkCount: plan.length });

  } catch (error) {
    console.error('Upload error:', error);
    logE2EError('upload.error', error, { fileId, fileName });
    try {
      await deleteFileChunks(userId, fileId);
      mainWindow.webContents.send('file:deleted', { fileId });
      logE2E('upload.rollback', { fileId, fileName });
    } catch (cleanupError) {
      console.error('Failed to clean up partial upload (chunks may remain on Drive):', cleanupError);
      logE2EError('upload.rollback.error', cleanupError, { fileId, fileName });
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
      if (account.provider !== 'google') {
        const files = await listFolderFiles(account, account.root_folder_id);
        const prefix = sanitizeName(`${fileName}.chunk`);
        for (const f of files) {
          if (f.name.startsWith(prefix) && !registered.has(f.id)) {
            await deleteChunkFile(account, f.id);
            console.warn(`[Upload] Deleted orphan chunk "${f.name}" (${f.id}) from ${account.email}`);
          }
        }
      } else {
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
      }
    } catch (e) {
      console.warn(`[Upload] Orphan sweep failed for ${account.email}:`, errorMessage(e));
    }
  }
}

export async function uploadFolder(userId: number, mainWindow: BrowserWindow, folderPath: string, parentFolderId: number | null = null, folderName?: string): Promise<void> {
  let finalName = folderName ?? path.basename(folderPath);
  const autoRename = getAppState('autoRenameDuplicates') !== '0';
  if (folderName === undefined && findDuplicateName(userId, finalName, parentFolderId, true)) {
    if (!autoRename) {
      throw new Error(`A folder named "${finalName}" already exists here.`);
    }
    finalName = getUniqueName(userId, finalName, parentFolderId, true);
  }
  const folderRow = createFolder(userId, finalName, parentFolderId);
  mainWindow.webContents.send('upload:complete', { fileId: folderRow.id, file: folderRow });
  logE2E('folder.upload.start', { folderName: finalName, folderId: folderRow.id, sourcePath: folderPath, parentFolderId });

  const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    const childPath = path.join(folderPath, entry.name);
    try {
      if (entry.isDirectory()) {
        await uploadFolder(userId, mainWindow, childPath, folderRow.id);
      } else if (entry.isFile()) {
        let fileName = entry.name;
        if (findDuplicateName(userId, fileName, folderRow.id, false)) {
          if (!autoRename) {
            throw new Error(`A file named "${fileName}" already exists here.`);
          }
          fileName = getUniqueName(userId, fileName, folderRow.id, false);
        }
        await uploadFile(userId, mainWindow, childPath, fileName, folderRow.id);
      }
    } catch (e) {
      console.error(`[Folder Upload] Failed to process ${childPath}:`, errorMessage(e));
      logE2EError('folder.upload.entry.error', e, { folderPath: childPath });
    }
  }

  logE2E('folder.upload.complete', { folderName: finalName, folderId: folderRow.id });
}

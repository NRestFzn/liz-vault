import fs from 'node:fs';
import type { BrowserWindow } from 'electron';
import { getFile, getChunksForFile, getAccountByEmail, updateFileStatus } from '../db/queries';
import { PROVIDER_NAMES } from '../../shared/types';
import { downloadChunkStream } from './storage';

export async function downloadFile(userId: number, mainWindow: BrowserWindow, fileId: number, savePath: string) {
  const fileRow = getFile(fileId, userId);
  if (!fileRow) {
    throw new Error('File not found in database');
  }

  updateFileStatus(fileId, userId, 'downloading');

  const chunks = getChunksForFile(fileId);
  if (chunks.length === 0) {
    updateFileStatus(fileId, userId, 'error');
    throw new Error('No chunks found for this file');
  }

  const writeStream = fs.createWriteStream(savePath, { flags: 'w' });
  let bytesDownloaded = 0;
  const totalBytes = fileRow.size_bytes;
  
  try {
    let chunkIndex = 0;
    for (const chunk of chunks) {
      const account = getAccountByEmail(chunk.account_email, chunk.account_provider);
      if (!account) {
        throw new Error(`${PROVIDER_NAMES[chunk.account_provider]} account ${chunk.account_email} not connected — re-connect it to download this file.`);
      }

      const stream = await downloadChunkStream(account, chunk.drive_file_id);

      await new Promise<void>((resolve, reject) => {
        stream
          .on('data', (dataChunk: Buffer) => {
            bytesDownloaded += dataChunk.length;
            mainWindow.webContents.send('download:progress', {
              fileId,
              fileName: fileRow.name,
              bytesDownloaded,
              totalBytes,
              chunkIndex
            });
          })
          .on('end', () => {
            resolve();
          })
          .on('error', (err: Error) => {
            reject(err);
          })
          .pipe(writeStream, { end: false });
      });

      chunkIndex++;
    }

    writeStream.end();
    updateFileStatus(fileId, userId, 'ready');
    mainWindow.webContents.send('download:complete', { fileId, savePath });

  } catch (error) {
    console.error('Download error:', error);
    writeStream.end();
    updateFileStatus(fileId, userId, 'error');
    mainWindow.webContents.send('download:error', { fileId, error: String(error) });
    throw error;
  }
}

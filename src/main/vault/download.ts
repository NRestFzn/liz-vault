import fs from 'fs';
import { BrowserWindow } from 'electron';
import { getFile, getChunksForFile, getAccountByEmail, updateFileStatus } from '../db/queries';
import { getDriveClient } from '../google/auth';

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
      const account = getAccountByEmail(chunk.account_email);
      if (!account) {
        throw new Error(`Drive account ${chunk.account_email} not connected — re-connect it to download this file.`);
      }

      const drive = getDriveClient(account.refresh_token);

      const response = await drive.files.get(
        { fileId: chunk.drive_file_id, alt: 'media' },
        { responseType: 'stream' }
      );

      await new Promise<void>((resolve, reject) => {
        response.data
          .on('data', (dataChunk: Buffer) => {
            bytesDownloaded += dataChunk.length;
            // Emit progress continuously
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
          .on('error', (err: any) => {
            reject(err);
          })
          .pipe(writeStream, { end: false }); // Don't end writeStream until all chunks are done
      });

      chunkIndex++;
    }

    writeStream.end();
    updateFileStatus(fileId, userId, 'ready');
    mainWindow.webContents.send('download:complete', { fileId, savePath });

  } catch (error: any) {
    console.error('Download error:', error);
    writeStream.end();
    updateFileStatus(fileId, userId, 'error');
    mainWindow.webContents.send('download:error', { fileId, error: String(error) });
    throw error;
  }
}

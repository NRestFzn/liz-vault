import fs from 'fs';
import { BrowserWindow } from 'electron';
import { getFile, getChunksForFile, getAccount, updateFileStatus } from '../db/queries';
import { getDriveClient } from '../google/auth';

export async function downloadFile(mainWindow: BrowserWindow, fileId: number, savePath: string) {
  const fileRow = getFile(fileId);
  if (!fileRow) {
    throw new Error('File not found in database');
  }

  updateFileStatus(fileId, 'downloading');

  const chunks = getChunksForFile(fileId);
  if (chunks.length === 0) {
    updateFileStatus(fileId, 'error');
    throw new Error('No chunks found for this file');
  }

  const writeStream = fs.createWriteStream(savePath, { flags: 'w' });
  let bytesDownloaded = 0;
  const totalBytes = fileRow.size_bytes;
  
  try {
    let chunkIndex = 0;
    for (const chunk of chunks) {
      const account = getAccount(chunk.account_id);
      if (!account) {
        throw new Error(`Account ${chunk.account_id} not found for chunk`);
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
            // Emit progress occasionally or on every chunk depending on granularity needed
          })
          .on('end', () => {
            resolve();
          })
          .on('error', (err: any) => {
            reject(err);
          })
          .pipe(writeStream, { end: false }); // Don't end writeStream until all chunks are done
      });

      mainWindow.webContents.send('download:progress', {
        fileId,
        bytesDownloaded,
        totalBytes,
        chunkIndex
      });

      chunkIndex++;
    }

    writeStream.end();
    updateFileStatus(fileId, 'ready');
    mainWindow.webContents.send('download:complete', { fileId, savePath });

  } catch (error: any) {
    console.error('Download error:', error);
    writeStream.end();
    updateFileStatus(fileId, 'error');
    mainWindow.webContents.send('download:error', { fileId, error: String(error) });
    throw error;
  }
}

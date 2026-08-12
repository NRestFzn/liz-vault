import { getFile, getChunksForFile, getAccountByEmail } from '../db/queries';
import { getDriveClient } from '../google/auth';
import { isBrowserDecodableImage, getImageMime } from '../../shared/fileCategory';


const MAX_THUMBNAIL_BYTES = 20 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 200;

const cache = new Map<number, string>();
const inFlight = new Map<number, Promise<string | null>>();

export function invalidateThumbnail(fileId: number): void {
  cache.delete(fileId);
  inFlight.delete(fileId);
}

export function getThumbnailDataUrl(userId: number, fileId: number): Promise<string | null> {
  const cached = cache.get(fileId);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(fileId);
  if (pending) return pending;

  const promise = fetchThumbnail(userId, fileId);
  inFlight.set(fileId, promise);
  promise.finally(() => inFlight.delete(fileId)).catch(() => {});
  return promise;
}

async function fetchThumbnail(userId: number, fileId: number): Promise<string | null> {
  const cached = cache.get(fileId);
  if (cached) return cached;

  const file = getFile(fileId, userId);
  if (!file || file.is_folder === 1) return null;
  if (file.size_bytes > MAX_THUMBNAIL_BYTES) return null;
  if (!isBrowserDecodableImage(file.name)) return null;

  const mime = getImageMime(file.name);
  if (!mime) return null;

  const chunks = getChunksForFile(fileId);
  const firstChunk = chunks.find(c => c.sequence === 0) ?? chunks[0];
  if (!firstChunk) return null;

  const account = getAccountByEmail(firstChunk.account_email);
  if (!account) return null;

  const drive = getDriveClient(account.refresh_token);
  const res = await drive.files.get(
    { fileId: firstChunk.drive_file_id, alt: 'media' },
    { responseType: 'stream' }
  );

  const buffer = await streamToBuffer(res.data);
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(fileId, dataUrl);
  return dataUrl;
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

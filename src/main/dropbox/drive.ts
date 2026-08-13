import { createHash, randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { getDropboxCredentials } from '../db/config';

const API_BASE = 'https://api.dropboxapi.com/2';
const CONTENT_BASE = 'https://content.dropboxapi.com/2';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const SESSION_FRAGMENT_SIZE = 128 * 1024 * 1024;

export class DropboxApiError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

function requireClientId(): string {
  const { clientId } = getDropboxCredentials();
  if (!clientId) {
    throw new Error('Dropbox API credentials are not set. Open Settings and add your App key first.');
  }
  return clientId;
}

export function generateCodeVerifier(): string {
  return randomBytes(64).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function fetchAccessToken(refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: requireClientId(),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new DropboxApiError(await readErrorText(res), res.status);
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new DropboxApiError('No access token in Dropbox token response.');
  return data.access_token;
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const token = await fetchAccessToken(refreshToken);
  tokenCache.set(refreshToken, { token, expiresAt: Date.now() + 3.5 * 60 * 60 * 1000 });
  return token;
}

async function readErrorText(res: Response): Promise<string> {
  try {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body) as { error_summary?: string; error?: { '.tag'?: string } | string };
      const tag = typeof parsed.error === 'object' && parsed.error ? parsed.error['.tag'] : undefined;
      return parsed.error_summary || tag || `Dropbox request failed (${res.status})`;
    } catch {
      return body || `Dropbox request failed (${res.status})`;
    }
  } catch {
    return `Dropbox request failed (${res.status})`;
  }
}

async function apiFetch(refreshToken: string, path: string, body?: unknown): Promise<Response> {
  const token = await getAccessToken(refreshToken);
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function apiJson(refreshToken: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await apiFetch(refreshToken, path, body);
  if (!res.ok) throw new DropboxApiError(await readErrorText(res), res.status);
  return res.json() as Promise<Record<string, unknown>>;
}

export interface DropboxProfile {
  email: string;
  displayName: string | null;
}

export async function dropboxGetProfile(refreshToken: string): Promise<DropboxProfile> {
  const data = await apiJson(refreshToken, '/users/get_current_account', null);
  const email = data.email ? String(data.email) : '';
  if (!email) throw new Error('Failed to retrieve the Dropbox account identity.');
  const name = data.name as { display_name?: string } | undefined;
  return { email, displayName: name?.display_name || null };
}

export async function dropboxGetQuota(refreshToken: string): Promise<{ total: number | null; used: number | null }> {
  const data = await apiJson(refreshToken, '/users/get_space_usage', null);
  const used = typeof data.used === 'number' ? data.used : null;
  const allocation = data.allocation as { allocated?: number } | undefined;
  const total = allocation?.allocated != null && allocation.allocated > 0 ? allocation.allocated : null;
  return { total, used };
}

export async function dropboxTestConnection(refreshToken: string): Promise<void> {
  await apiJson(refreshToken, '/users/get_current_account', null);
}

export async function dropboxListChildren(refreshToken: string, folderPath: string): Promise<{ id: string; name: string }[]> {
  const data = await apiJson(refreshToken, '/files/list_folder', { path: folderPath, limit: 2000 });
  const entries = (data.entries as Array<{ '.tag'?: string; id?: unknown; name?: unknown }> | undefined) ?? [];
  return entries
    .filter(e => e['.tag'] === 'file')
    .map(e => ({ id: e.id ? String(e.id) : '', name: e.name ? String(e.name) : '' }))
    .filter(e => e.id);
}

export async function dropboxDeleteItem(refreshToken: string, itemId: string): Promise<void> {
  const res = await apiFetch(refreshToken, '/files/delete_v2', { path: itemId });
  if (!res.ok && res.status !== 409) {
    throw new DropboxApiError(await readErrorText(res), res.status);
  }
}

export async function dropboxDownloadStream(refreshToken: string, itemId: string): Promise<NodeJS.ReadableStream> {
  const token = await getAccessToken(refreshToken);
  const res = await fetch(`${CONTENT_BASE}/files/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: itemId }),
    },
  });
  if (!res.ok) throw new DropboxApiError(await readErrorText(res), res.status);
  if (!res.body) throw new DropboxApiError('No content returned from Dropbox.');
  return Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
}

export async function dropboxEnsureFolder(refreshToken: string, preferredName: string, legacyName: string): Promise<{ id: string; created: boolean }> {
  for (const candidate of [preferredName, legacyName]) {
    const path = `/${candidate}`;
    const res = await apiFetch(refreshToken, '/files/get_metadata', { path });
    if (res.ok) {
      const meta = await res.json() as { id?: unknown };
      return { id: meta.id ? String(meta.id) : path, created: false };
    }
    if (res.status !== 409) {
      const data = await res.json().catch(() => null) as { error_summary?: string } | null;
      if (data?.error_summary?.includes('not_found')) continue;
      throw new DropboxApiError(await readErrorText(res), res.status);
    }
  }
  const created = await apiJson(refreshToken, '/files/create_folder_v2', { path: `/${preferredName}`, autorename: false });
  const id = created.id ? String(created.id) : '';
  if (!id) throw new DropboxApiError('Dropbox did not return an id for the storage folder.');
  return { id, created: true };
}

async function uploadSmall(refreshToken: string, path: string, body: Buffer): Promise<string> {
  const token = await getAccessToken(refreshToken);
  const res = await fetch(`${CONTENT_BASE}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false, mute: true }),
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new DropboxApiError(await readErrorText(res), res.status);
  const data = await res.json() as { id?: unknown };
  const id = data.id ? String(data.id) : '';
  if (!id) throw new DropboxApiError('Dropbox did not return an id for the uploaded chunk.');
  return id;
}

export async function dropboxUploadChunk(
  refreshToken: string,
  folderId: string,
  name: string,
  size: number,
  stream: NodeJS.ReadableStream
): Promise<string> {
  const path = `${folderId.endsWith('/') ? folderId : folderId}/${name}`;
  if (size <= SESSION_FRAGMENT_SIZE) {
    const buffer = await streamToBuffer(stream);
    return uploadSmall(refreshToken, path, buffer);
  }

  const session = await apiJson(refreshToken, '/files/upload_session/start', { close: false });
  const sessionId = session.session_id ? String(session.session_id) : '';
  if (!sessionId) throw new DropboxApiError('Dropbox did not return an upload session id.');

  let offset = 0;
  for await (const frag of fixedSizeFragments(stream, SESSION_FRAGMENT_SIZE)) {
    const cursor = { session_id: sessionId, offset };
    if (offset + frag.length < size) {
      const token = await getAccessToken(refreshToken);
      const append = await fetch(`${CONTENT_BASE}/files/upload_session/append_v2`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({ cursor }),
        },
        body: new Uint8Array(frag),
      });
      if (!append.ok) throw new DropboxApiError(await readErrorText(append), append.status);
    } else {
      const token = await getAccessToken(refreshToken);
      const finish = await fetch(`${CONTENT_BASE}/files/upload_session/finish`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({
            cursor,
            commit: { path, mode: 'overwrite', autorename: false, mute: true },
          }),
        },
        body: new Uint8Array(frag),
      });
      if (!finish.ok) throw new DropboxApiError(await readErrorText(finish), finish.status);
      const data = await finish.json() as { id?: unknown };
      const id = data.id ? String(data.id) : '';
      if (!id) throw new DropboxApiError('Dropbox did not return an id for the uploaded chunk.');
      return id;
    }
    offset += frag.length;
  }
  throw new DropboxApiError('Dropbox chunk upload was incomplete.');
}

async function* fixedSizeFragments(stream: NodeJS.ReadableStream, size: number): AsyncGenerator<Buffer> {
  const t = new Transform({
    transform(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void) {
      const parts = (this as { parts?: Buffer[]; len?: number }).parts ?? [];
      let len = (this as { len?: number }).len ?? 0;
      parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      len += parts[parts.length - 1].length;
      while (len >= size) {
        const frag = Buffer.alloc(size);
        let off = 0;
        while (off < size) {
          const head = parts[0];
          const take = Math.min(head.length, size - off);
          head.copy(frag, off, 0, take);
          off += take;
          if (take === head.length) parts.shift();
          else parts[0] = head.subarray(take);
        }
        len -= size;
        this.push(frag);
      }
      (this as { parts?: Buffer[]; len?: number }).parts = parts;
      (this as { len?: number }).len = len;
      cb();
    },
    flush(cb: () => void) {
      const parts = (this as { parts?: Buffer[] }).parts ?? [];
      if (parts.length > 0) this.push(Buffer.concat(parts));
      (this as { parts?: Buffer[] }).parts = [];
      (this as { len?: number }).len = 0;
      cb();
    },
  });
  stream.pipe(t);
  yield* t[Symbol.asyncIterator]();
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

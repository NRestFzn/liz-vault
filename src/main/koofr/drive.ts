import { randomBytes } from 'node:crypto';
import https from 'node:https';
import { Readable, Transform } from 'node:stream';

const API_BASE = 'https://app.koofr.net';
const MIB = 1024 * 1024;

export class KoofrApiError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

function basicAuth(email: string, password: string): string {
  return `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;
}

async function readErrorText(res: Response): Promise<string> {
  try {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string };
      if (typeof parsed.error === 'object' && parsed.error?.message) return parsed.error.message;
      if (typeof parsed.error === 'string') return parsed.error;
      return `Koofr request failed (${res.status})`;
    } catch {
      return body || `Koofr request failed (${res.status})`;
    }
  } catch {
    return `Koofr request failed (${res.status})`;
  }
}

async function apiFetch(email: string, password: string, path: string, init?: RequestInit): Promise<Response> {
  const url = `${API_BASE}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: basicAuth(email, password),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

async function apiJson(email: string, password: string, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await apiFetch(email, password, path, init);
  if (!res.ok) throw new KoofrApiError(await readErrorText(res), res.status);
  return res.json() as Promise<Record<string, unknown>>;
}

export interface KoofrProfile {
  email: string;
  displayName: string | null;
}

export async function koofrGetProfile(email: string, password: string): Promise<KoofrProfile> {
  const user = await apiJson(email, password, '/api/v2/user');
  const userEmail = user.email ? String(user.email) : '';
  if (!userEmail) throw new Error('Failed to retrieve the Koofr account identity.');
  const displayName = [user.firstName, user.lastName]
    .map(v => (v ? String(v) : ''))
    .filter(Boolean)
    .join(' ') || null;
  return { email: userEmail, displayName };
}

interface KoofrMount {
  id: string;
  isPrimary?: boolean;
  spaceTotal?: number;
  spaceUsed?: number;
}

async function getPrimaryMount(email: string, password: string): Promise<KoofrMount> {
  const data = await apiJson(email, password, '/api/v2/mounts');
  const mounts = (data.mounts as KoofrMount[] | undefined) ?? [];
  const primary = mounts.find(m => m.isPrimary) ?? mounts[0];
  if (!primary?.id) throw new Error('No Koofr mount found for this account.');
  return primary;
}

export async function koofrGetQuota(email: string, password: string): Promise<{ total: number | null; used: number | null }> {
  const mount = await getPrimaryMount(email, password);
  const detail = await apiJson(email, password, `/api/v2/mounts/${encodeURIComponent(mount.id)}`);
  const total = typeof detail.spaceTotal === 'number' && detail.spaceTotal > 0 ? detail.spaceTotal * MIB : null;
  const used = typeof detail.spaceUsed === 'number' ? detail.spaceUsed * MIB : null;
  return { total, used };
}

export async function koofrTestConnection(email: string, password: string): Promise<void> {
  await apiJson(email, password, '/api/v2/user');
}

export async function koofrEnsureFolder(email: string, password: string, folderName: string): Promise<{ id: string; created: boolean }> {
  const mount = await getPrimaryMount(email, password);
  const mountId = mount.id;
  const infoRes = await apiFetch(email, password, `/api/v2/mounts/${encodeURIComponent(mountId)}/files/info?path=${encodeURIComponent(`/${folderName}`)}`);
  if (infoRes.ok) return { id: mountId, created: false };
  if (infoRes.status !== 404) throw new KoofrApiError(await readErrorText(infoRes), infoRes.status);
  await apiJson(email, password, `/api/v2/mounts/${encodeURIComponent(mountId)}/files/folder?path=${encodeURIComponent('/')}`, {
    method: 'POST',
    body: JSON.stringify({ name: folderName }),
  });
  return { id: mountId, created: true };
}

export async function koofrListChildren(email: string, password: string, mountId: string, folderPath: string): Promise<{ id: string; name: string }[]> {
  const data = await apiJson(email, password, `/api/v2/mounts/${encodeURIComponent(mountId)}/files/list?path=${encodeURIComponent(folderPath)}`);
  const files = (data.files as Array<{ name?: unknown; type?: unknown }> | undefined) ?? [];
  return files
    .filter(f => f.type === 'file')
    .map(f => ({ id: `${folderPath}/${String(f.name ?? '')}`, name: String(f.name ?? '') }))
    .filter(f => f.name);
}

export async function koofrDeleteItem(email: string, password: string, mountId: string, path: string): Promise<void> {
  const res = await apiFetch(email, password, `/api/v2/mounts/${encodeURIComponent(mountId)}/files/remove?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new KoofrApiError(await readErrorText(res), res.status);
}

export async function koofrDownloadStream(email: string, password: string, mountId: string, path: string): Promise<NodeJS.ReadableStream> {
  const res = await fetch(`${API_BASE}/content/api/v2/mounts/${encodeURIComponent(mountId)}/files/get?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: basicAuth(email, password) },
  });
  if (!res.ok) throw new KoofrApiError(await readErrorText(res), res.status);
  if (!res.body) throw new KoofrApiError('No content returned from Koofr.');
  return Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
}

const MULTIPART_BOUNDARY_PREFIX = '----LizVaultBoundary';

function multipartContentType(boundary: string): string {
  return `multipart/form-data; boundary=${boundary}`;
}

function multipartPreamble(boundary: string, name: string): Buffer {
  const safeName = name.replace(/"/g, '\\"');
  return Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
    'Content-Type: application/octet-stream\r\n' +
    '\r\n'
  );
}

function multipartEpilogue(boundary: string): Buffer {
  return Buffer.from(`\r\n--${boundary}--\r\n`);
}

export async function koofrUploadChunk(
  email: string,
  password: string,
  mountId: string,
  folderPath: string,
  name: string,
  stream: NodeJS.ReadableStream,
  size: number
): Promise<string> {
  const boundary = `${MULTIPART_BOUNDARY_PREFIX}${randomBytes(16).toString('hex')}`;
  const preamble = multipartPreamble(boundary, name);
  const epilogue = multipartEpilogue(boundary);
  const contentLength = preamble.length + size + epilogue.length;

  const params = new URLSearchParams({
    path: folderPath,
    filename: name,
    info: 'true',
    overwrite: 'true',
  });
  const url = `${API_BASE}/content/api/v2/mounts/${encodeURIComponent(mountId)}/files/put?${params.toString()}`;

  const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    let headerSent = false;
    const body = new Transform({
      transform(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void) {
        if (!headerSent) {
          this.push(preamble);
          headerSent = true;
        }
        this.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
      flush(cb: () => void) {
        if (!headerSent) this.push(preamble);
        this.push(epilogue);
        cb();
      },
    });

    const req = https.request(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(email, password),
        'Content-Type': multipartContentType(boundary),
        'Content-Length': String(contentLength),
      },
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
      res.on('error', reject);
    });

    req.on('error', reject);
    stream.on('error', err => req.destroy(err));
    stream.pipe(body).pipe(req);
  });

  if (res.status < 200 || res.status >= 300) {
    let message = `Koofr request failed (${res.status})`;
    try {
      const parsed = JSON.parse(res.body) as { error?: { message?: string } | string };
      if (typeof parsed.error === 'object' && parsed.error?.message) message = parsed.error.message;
      else if (typeof parsed.error === 'string') message = parsed.error;
    } catch { }
    throw new KoofrApiError(message, res.status);
  }

  const data = JSON.parse(res.body) as { name?: unknown };
  const fileName = data.name ? String(data.name) : '';
  if (!fileName) throw new KoofrApiError('Koofr did not return a name for the uploaded chunk.');
  return `${folderPath}/${fileName}`;
}

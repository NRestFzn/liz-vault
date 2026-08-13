import { Readable } from 'node:stream';

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

export async function koofrUploadChunk(
  email: string,
  password: string,
  mountId: string,
  folderPath: string,
  name: string,
  stream: NodeJS.ReadableStream
): Promise<string> {
  const buffer = await streamToBuffer(stream);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' }), name);
  const params = new URLSearchParams({
    path: folderPath,
    filename: name,
    info: 'true',
    overwrite: 'true',
  });
  const res = await fetch(`${API_BASE}/content/api/v2/mounts/${encodeURIComponent(mountId)}/files/put?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: basicAuth(email, password) },
    body: form,
  });
  if (!res.ok) throw new KoofrApiError(await readErrorText(res), res.status);
  const data = await res.json() as { name?: unknown };
  const fileName = data.name ? String(data.name) : '';
  if (!fileName) throw new KoofrApiError('Koofr did not return a name for the uploaded chunk.');
  return `${folderPath}/${fileName}`;
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

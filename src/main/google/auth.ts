import { google } from 'googleapis';
import { shell } from 'electron';
import http from 'http';
import { addAccount, addUser, getAccount, getGoogleCredentials, seedManifestForUser } from '../db/queries';
import { AccountRow, UserRow } from '../../shared/types';

// MAIN account folder — hosts the vault manifest.json (created at login).
const VAULT_FOLDER_NAME = 'LizVault';
// STORAGE account folder — holds the raw chunk files (created on Connect Drive).
const STORAGE_FOLDER_NAME = 'LizVault_Data';
// Each lookup accepts the other name so folders from older builds are reused.
const LEGACY_FOLDER_NAME = STORAGE_FOLDER_NAME; // old main-account name
const LEGACY_STORAGE_NAME = VAULT_FOLDER_NAME; // old storage-account name

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Google API credentials are configured in the Settings page and stored in
// the local config.json — NOT in .env. Read them live on every OAuth client
// creation so a settings change applies without a restart.
function getOAuthCredentials(): { clientId: string; clientSecret: string } {
  return getGoogleCredentials();
}

function assertCredentialsConfigured(): void {
  const { clientId, clientSecret } = getOAuthCredentials();
  if (!clientId || !clientSecret) {
    throw new Error('Google API credentials are not set. Open Settings and add your Client ID and Client Secret first.');
  }
}

// Google no longer accepts custom URI schemes (e.g. lizvault://oauth/callback)
// as OAuth redirect URIs. Native/desktop apps must use the loopback redirect
// flow (RFC 8252): a temporary one-shot HTTP listener on 127.0.0.1 catches the
// callback.
//
// For a "Desktop app" OAuth client (the recommended type), Google accepts ANY
// loopback port dynamically — nothing needs to be registered in the console.
// So we bind port 0 (ephemeral): the OS picks a free port, and the redirect
// URI is built from whatever port was actually assigned. No .env, no fixed
// port, no registration — works identically on every device.
const LOOPBACK_HOST = '127.0.0.1';

// The currently-pending OAuth/login flow. Tracked so a NEW flow can abort a
// stale one (e.g. the user cancelled the previous attempt — the browser never
// called back, so the old listener would otherwise linger until its timeout
// and hold the port). The fail function is stored too, so aborting settles the
// old flow's promise immediately instead of the renderer waiting for the
// 5-minute timeout (and later showing a confusing "timed out" error).
interface ActiveOAuthFlow {
  server: http.Server;
  fail: (err: Error) => void;
}
let activeOAuthFlow: ActiveOAuthFlow | null = null;

/**
 * Thrown when a newer flow aborts a still-pending previous one. The IPC
 * handlers translate this into `{ cancelled: true }` (not an error) so the
 * renderer ignores it — the user simply started a fresh attempt.
 */
export class OAuthCancelledError extends Error {
  constructor() {
    super('Previous login attempt was cancelled by a newer attempt.');
    this.name = 'OAuthCancelledError';
  }
}

export function abortActiveOAuthFlow(): void {
  if (activeOAuthFlow) {
    try { activeOAuthFlow.server.close(); } catch { /* already closed */ }
    try { activeOAuthFlow.fail(new OAuthCancelledError()); } catch { /* already settled */ }
    activeOAuthFlow = null;
  }
}

/** Resolve the redirect URI from the OS-assigned ephemeral port. */
function resolveRedirectUri(server: http.Server): string {
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  return `http://${LOOPBACK_HOST}:${port}/oauth/callback`;
}
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const SUCCESS_HTML =
  '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">' +
  '<h2>Authentication complete! You can close this window.</h2></body></html>';

const ERROR_HTML =
  '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">' +
  '<h2>Authentication failed. Please close this window and try again.</h2></body></html>';

export function createOAuthClient(redirectUri: string) {
  assertCredentialsConfigured();
  const { clientId, clientSecret } = getOAuthCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export interface OAuthFlowResult {
  account: AccountRow;
  /** True when a new storage folder (`LizVault_Data`) was created on this account's Drive. */
  folderCreated: boolean;
}

export interface LoginFlowResult {
  user: UserRow;
  /** True when the vault `LizVault` folder was newly created on the main account. */
  folderCreated: boolean;
}

export async function initiateOAuthFlow(userId: number): Promise<OAuthFlowResult> {
  // Fail fast (before opening a browser / binding a port) when credentials
  // are missing — surfaces a clear error through the IPC handler.
  assertCredentialsConfigured();
  return new Promise<OAuthFlowResult>((resolve, reject) => {
    // Cancel any previous (still-pending) OAuth flow so its port frees up and
    // its renderer-side invoke settles immediately.
    abortActiveOAuthFlow();
    const server = http.createServer();
    let settled = false;
    let callbackReceived = false;
    let timeout: NodeJS.Timeout | undefined;
    // Resolved once the listener is bound (ephemeral port) — read by the
    // request handler and the browser-opening code below.
    let redirectUri = '';

    const cleanup = () => {
      if (activeOAuthFlow?.server === server) activeOAuthFlow = null;
      server.close();
      if (timeout) clearTimeout(timeout);
    };

    const fail = (err: Error) => {
      if (settled || callbackReceived) return;
      settled = true;
      cleanup();
      reject(err);
    };
    activeOAuthFlow = { server, fail };

    server.on('request', async (req, res) => {
      const reqUrl = new URL(req.url || '/', redirectUri);

      const callbackPath = new URL(redirectUri).pathname;
      if (reqUrl.pathname !== callbackPath) {
        res.writeHead(204);
        res.end();
        return;
      }

      callbackReceived = true;
      const code = reqUrl.searchParams.get('code');
      const errParam = reqUrl.searchParams.get('error');

      res.setHeader('content-type', 'text/html');
      res.end(code ? SUCCESS_HTML : ERROR_HTML);

      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);

      if (!code) {
        // Google's own "Cancel" button on the consent page redirects here with
        // error=access_denied — a real, detectable cancellation.
        cleanup();
        reject(new Error(
          errParam === 'access_denied'
            ? 'You cancelled the sign-in in the browser.'
            : 'No code found in callback URL'
        ));
        return;
      }

      try {
        const result = await completeOAuth(code, redirectUri, userId);
        cleanup();
        resolve(result);
      } catch (e) {
        cleanup();
        reject(e as Error);
      }
    });

    server.listen(0, LOOPBACK_HOST, async () => {
      try {
        redirectUri = resolveRedirectUri(server);
        console.log('[OAuth] redirect URI:', redirectUri);
        const oauth2Client = createOAuthClient(redirectUri);
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: SCOPES,
          prompt: 'consent'
        });

        await shell.openExternal(authUrl);
      } catch (e) {
        fail(e as Error);
      }
    });

    timeout = setTimeout(() => fail(new Error('OAuth login timed out. Please try again.')), CALLBACK_TIMEOUT_MS);

    server.on('error', (err: NodeJS.ErrnoException) => {
      fail(err);
    });
  });
}

async function completeOAuth(code: string, redirectUri: string, userId: number): Promise<OAuthFlowResult> {
  console.log('[OAuth] Exchanging code for tokens…');
  const oauth2Client = createOAuthClient(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (!tokens.refresh_token) {
    throw new Error('No refresh token received. User must grant offline access.');
  }
  console.log('[OAuth] Got refresh token ✓');

  // Get user email
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email;
  if (!email) {
    throw new Error('Failed to retrieve user email.');
  }
  console.log('[OAuth] User email:', email);

  // Get Drive quota info
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const about = await drive.about.get({ fields: 'storageQuota' });
  const limit = about.data.storageQuota?.limit ? parseInt(about.data.storageQuota.limit, 10) : null;
  const usage = about.data.storageQuota?.usage ? parseInt(about.data.storageQuota.usage, 10) : null;
  console.log('[OAuth] Drive quota — limit:', limit, 'usage:', usage);

  // Create/find the STORAGE folder (holds raw chunks — the manifest does NOT
  // live here anymore). Prefer the current name, accept the legacy name so
  // folders created by older builds are reused.
  let rootFolderId = null;
  let folderCreated = false;
  const { id, created } = await findOrCreateFolder(drive, STORAGE_FOLDER_NAME, LEGACY_STORAGE_NAME);
  rootFolderId = id;
  folderCreated = created;
  console.log(`[OAuth] ${created ? 'Created' : 'Found existing'} ${STORAGE_FOLDER_NAME} storage folder:`, rootFolderId);

  // Save account locally (config.json) — the refresh token is the key that
  // locates the vault manifest on Drive, so it stays off Drive itself.
  console.log('[OAuth] Saving account to local config…');
  const account = addAccount({
    user_id: userId,
    email,
    refresh_token: tokens.refresh_token,
    total_bytes: limit,
    used_bytes: usage,
    root_folder_id: rootFolderId
  });
  console.log('[OAuth] Account saved ✓ id:', account.id);

  return { account, folderCreated };
}

export function getDriveClient(refreshToken: string) {
  // Redirect URI is unused for refresh-token flows; any value works.
  const client = createOAuthClient('http://127.0.0.1/oauth/callback');
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: client });
}

/**
 * Find an existing folder (preferred name, then legacy) or create a new one
 * with the preferred name. Shared by login, connect, manifest and the upload
 * 404-retry so the folder-name pairs never drift apart.
 */
export async function findOrCreateFolder(drive: any, preferredName: string, legacyName: string): Promise<{ id: string; created: boolean }> {
  const query = `(name='${preferredName}' or name='${legacyName}') and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const existing = await drive.files.list({ q: query, spaces: 'drive', fields: 'files(id, name)' });
  if (existing.data.files && existing.data.files.length > 0) {
    const preferred = existing.data.files.find((f: any) => f.name === preferredName) ?? existing.data.files[0];
    return { id: preferred.id!, created: false };
  }
  const folder = await drive.files.create({
    requestBody: { name: preferredName, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  return { id: folder.data.id!, created: true };
}

/**
 * Verifies an account's refresh token still works with a lightweight Drive
 * API call. Refresh tokens for testing-mode OAuth clients expire after 7 days,
 * and revoked/expired tokens surface here as a clear error so the UI can show
 * a "re-login" state. The IPC handler persists the result.
 */
export async function testAccountToken(userId: number, accountId: number): Promise<{ ok: boolean; expired?: boolean; error?: string }> {
  try {
    const account = getAccount(accountId, userId);
    if (!account) return { ok: false, expired: true, error: 'Account not found.' };
    const drive = getDriveClient(account.refresh_token);
    await drive.about.get({ fields: 'user' });
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message || e);
    // Auth-class errors mean the token itself is dead — a definitive "expired".
    if (/unauthorized_client|invalid_grant|invalid_client/i.test(msg)) {
      return { ok: false, expired: true, error: 'Your Google login has expired or was revoked. Re-login to continue.' };
    }
    // Everything else (network, missing credentials, 5xx) is transient — do NOT
    // mark the account expired; just surface the error for display.
    return { ok: false, expired: false, error: msg };
  }
}

/**
 * Login flow — same loopback OAuth as initiateOAuthFlow but saves the result
 * to the `users` table instead of `accounts`. Throws if the email is already
 * in use as a drive storage account.
 */
export async function initiateLoginFlow(): Promise<LoginFlowResult> {
  assertCredentialsConfigured();
  return new Promise<LoginFlowResult>((resolve, reject) => {
    abortActiveOAuthFlow();
    const server = http.createServer();
    let settled = false;
    let callbackReceived = false;
    let timeout: NodeJS.Timeout | undefined;
    let redirectUri = '';

    const cleanup = () => {
      if (activeOAuthFlow?.server === server) activeOAuthFlow = null;
      server.close();
      if (timeout) clearTimeout(timeout);
    };

    const fail = (err: Error) => {
      if (settled || callbackReceived) return;
      settled = true;
      cleanup();
      reject(err);
    };
    activeOAuthFlow = { server, fail };

    server.on('request', async (req, res) => {
      const reqUrl = new URL(req.url || '/', redirectUri);
      const callbackPath = new URL(redirectUri).pathname;
      if (reqUrl.pathname !== callbackPath) {
        res.writeHead(204);
        res.end();
        return;
      }

      callbackReceived = true;
      const code = reqUrl.searchParams.get('code');
      const errParam = reqUrl.searchParams.get('error');

      res.setHeader('content-type', 'text/html');
      res.end(code ? SUCCESS_HTML : ERROR_HTML);

      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);

      if (!code) {
        cleanup();
        reject(new Error(
          errParam === 'access_denied'
            ? 'You cancelled the sign-in in the browser.'
            : 'No code found in callback URL'
        ));
        return;
      }

      try {
        const result = await completeLoginOAuth(code, redirectUri);
        cleanup();
        resolve(result);
      } catch (e) {
        cleanup();
        reject(e as Error);
      }
    });

    server.listen(0, LOOPBACK_HOST, async () => {
      try {
        redirectUri = resolveRedirectUri(server);
        console.log('[Login] redirect URI:', redirectUri);
        const oauth2Client = createOAuthClient(redirectUri);
        // Drive access is part of login now — the main account hosts the
        // vault manifest, so the consent screen requests drive.file too.
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.metadata.readonly',
          ],
          prompt: 'consent',
        });
        await shell.openExternal(authUrl);
      } catch (e) {
        fail(e as Error);
      }
    });

    timeout = setTimeout(() => fail(new Error('Login timed out. Please try again.')), CALLBACK_TIMEOUT_MS);

    server.on('error', (err: NodeJS.ErrnoException) => {
      fail(err);
    });
  });
}

async function completeLoginOAuth(code: string, redirectUri: string): Promise<LoginFlowResult> {
  console.log('[Login] Exchanging code for tokens…');
  const oauth2Client = createOAuthClient(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (!tokens.refresh_token) {
    throw new Error('No refresh token received. Grant offline access to continue.');
  }

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email;
  const displayName = userInfo.data.name ?? null;
  const avatarUrl = userInfo.data.picture ?? null;

  if (!email) throw new Error('Failed to retrieve email from Google.');
  console.log('[Login] User email:', email);

  // Create/find the MAIN account's vault folder (best-effort — a failure here
  // must not block login; ensureManifestLoaded self-heals it later).
  let rootFolderId: string | null = null;
  let folderCreated = false;
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const { id, created } = await findOrCreateFolder(drive, VAULT_FOLDER_NAME, LEGACY_FOLDER_NAME);
    rootFolderId = id;
    folderCreated = created;
    console.log(`[Login] ${created ? 'Created' : 'Found existing'} ${VAULT_FOLDER_NAME} folder:`, rootFolderId);
  } catch (e: any) {
    console.warn('[Login] Failed to ensure vault folder:', e?.message || e);
  }

  const user = addUser({ email, refresh_token: tokens.refresh_token, display_name: displayName, avatar_url: avatarUrl, root_folder_id: rootFolderId });
  console.log('[Login] User saved ✓ id:', user.id);

  // Seed the vault manifest in the main account's folder (never overwrites an
  // existing one — that is how a second device finds its vault).
  await seedManifestForUser(user);
  return { user, folderCreated };
}

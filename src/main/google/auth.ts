import { google } from 'googleapis';
import { shell } from 'electron';
import http from 'http';
import { addAccount, addUser, getAllAccounts } from '../db/queries';
import { AccountRow, UserRow } from '../../shared/types';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env variables
// In development __dirname is dist/main/main/google, so we go up 4 levels
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET';

// Google no longer accepts custom URI schemes (e.g. lizvault://oauth/callback)
// as OAuth redirect URIs. Native/desktop apps must use the loopback redirect
// flow (RFC 8252): a temporary one-shot HTTP listener on 127.0.0.1 catches the
// callback. No redirect URI needs to be registered in Google Cloud Console.
const DEFAULT_LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_LOOPBACK_PORT = 3000;
const DEFAULT_REDIRECT_URI = `http://${DEFAULT_LOOPBACK_HOST}:${DEFAULT_LOOPBACK_PORT}/oauth/callback`;

interface LoopbackConfig {
  /** Full redirect URI, e.g. http://127.0.0.1:3000/oauth/callback */
  redirectUri: string;
  /** Host the one-shot listener binds to */
  host: string;
  /** Port the one-shot listener binds to */
  port: number;
}

// The redirect URI must exactly match the one registered in Google Cloud
// Console (e.g. http://127.0.0.1:3000/oauth/callback on a Web application
// client). Configure it via OAUTH_REDIRECT_URI in .env so you can change it
// later without touching code. OAUTH_PORT is kept as a legacy fallback.
function getLoopbackConfig(): LoopbackConfig {
  const full = process.env.OAUTH_REDIRECT_URI;
  if (full) {
    try {
      const url = new URL(full);
      const host = url.hostname;
      const port = url.port ? Number(url.port) : 80;
      const isLoopback = host === '127.0.0.1' || host === 'localhost';
      const isHttp = url.protocol === 'http:';
      if (isLoopback && isHttp && Number.isInteger(port) && port > 0 && port <= 65535) {
        return { redirectUri: full, host, port };
      }
      console.warn('[OAuth] Invalid OAUTH_REDIRECT_URI in .env (must be http(s)://127.0.0.1 or localhost with a valid port), falling back to', DEFAULT_REDIRECT_URI);
    } catch {
      console.warn('[OAuth] Invalid OAUTH_REDIRECT_URI in .env, falling back to', DEFAULT_REDIRECT_URI);
    }
  }

  // Legacy: OAUTH_PORT only configures the port on 127.0.0.1.
  const raw = process.env.OAUTH_PORT;
  if (raw) {
    const port = Number(raw);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      return { redirectUri: `http://${DEFAULT_LOOPBACK_HOST}:${port}/oauth/callback`, host: DEFAULT_LOOPBACK_HOST, port };
    }
    console.warn('[OAuth] Invalid OAUTH_PORT in .env, falling back to', DEFAULT_LOOPBACK_PORT);
  }
  return { redirectUri: DEFAULT_REDIRECT_URI, host: DEFAULT_LOOPBACK_HOST, port: DEFAULT_LOOPBACK_PORT };
}

const LOOPBACK = getLoopbackConfig();
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const SUCCESS_HTML =
  '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">' +
  '<h2>Authentication complete! You can close this window.</h2></body></html>';

const ERROR_HTML =
  '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">' +
  '<h2>Authentication failed. Please close this window and try again.</h2></body></html>';

export function createOAuthClient(redirectUri: string) {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri);
}

export async function initiateOAuthFlow(userId: number): Promise<AccountRow> {
  return new Promise<AccountRow>((resolve, reject) => {
    const server = http.createServer();
    let settled = false;
    let callbackReceived = false;
    let timeout: NodeJS.Timeout | undefined;

    const cleanup = () => {
      server.close();
      if (timeout) clearTimeout(timeout);
    };

    const fail = (err: Error) => {
      if (settled || callbackReceived) return;
      settled = true;
      cleanup();
      reject(err);
    };

    server.on('request', async (req, res) => {
      const redirectUri = LOOPBACK.redirectUri;
      const reqUrl = new URL(req.url || '/', redirectUri);

      const callbackPath = new URL(redirectUri).pathname;
      if (reqUrl.pathname !== callbackPath) {
        res.writeHead(204);
        res.end();
        return;
      }

      callbackReceived = true;
      const code = reqUrl.searchParams.get('code');

      res.setHeader('content-type', 'text/html');
      res.end(code ? SUCCESS_HTML : ERROR_HTML);
      server.close();

      if (!code) {
        if (!settled) {
          settled = true;
          if (timeout) clearTimeout(timeout);
          reject(new Error('No code found in callback URL'));
        }
        return;
      }

      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);

      try {
        const account = await completeOAuth(code, redirectUri, userId);
        resolve(account);
      } catch (e) {
        reject(e as Error);
      }
    });

    server.listen(LOOPBACK.port, LOOPBACK.host, async () => {
      const redirectUri = LOOPBACK.redirectUri;
      console.log('[OAuth] redirect URI:', redirectUri);
      const oauth2Client = createOAuthClient(redirectUri);
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
      });

      try {
        await shell.openExternal(authUrl);
      } catch (e) {
        fail(e as Error);
      }
    });

    timeout = setTimeout(() => fail(new Error('OAuth login timed out. Please try again.')), CALLBACK_TIMEOUT_MS);

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        fail(new Error(`Port ${LOOPBACK.port} is already in use by another program. Close it and try again, or change OAUTH_REDIRECT_URI in .env (and re-register it in Google Cloud Console if needed).`));
      } else {
        fail(err);
      }
    });
  });
}

async function completeOAuth(code: string, redirectUri: string, userId: number): Promise<AccountRow> {
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

  // Create root folder "LizVault_Data"
  let rootFolderId = null;
  const query = "name='LizVault_Data' and mimeType='application/vnd.google-apps.folder' and trashed=false";
  const existing = await drive.files.list({ q: query, spaces: 'drive', fields: 'files(id, name)' });

  if (existing.data.files && existing.data.files.length > 0) {
    rootFolderId = existing.data.files[0].id!;
    console.log('[OAuth] Found existing LizVault_Data folder:', rootFolderId);
  } else {
    const folder = await drive.files.create({
      requestBody: {
        name: 'LizVault_Data',
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });
    rootFolderId = folder.data.id!;
    console.log('[OAuth] Created LizVault_Data folder:', rootFolderId);
  }

  // Save to DB
  console.log('[OAuth] Saving account to database…');
  const account = addAccount({
    user_id: userId,
    email,
    refresh_token: tokens.refresh_token,
    total_bytes: limit,
    used_bytes: usage,
    root_folder_id: rootFolderId
  });
  console.log('[OAuth] Account saved ✓ id:', account.id);
  return account;
}

export function getDriveClient(refreshToken: string) {
  // Redirect URI is unused for refresh-token flows; the configured one is fine.
  const client = createOAuthClient(LOOPBACK.redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: client });
}

/**
 * Login flow — same loopback OAuth as initiateOAuthFlow but saves the result
 * to the `users` table instead of `accounts`. Throws if the email is already
 * in use as a drive storage account.
 */
export async function initiateLoginFlow(): Promise<UserRow> {
  return new Promise<UserRow>((resolve, reject) => {
    const server = http.createServer();
    let settled = false;
    let callbackReceived = false;
    let timeout: NodeJS.Timeout | undefined;

    const cleanup = () => {
      server.close();
      if (timeout) clearTimeout(timeout);
    };

    const fail = (err: Error) => {
      if (settled || callbackReceived) return;
      settled = true;
      cleanup();
      reject(err);
    };

    server.on('request', async (req, res) => {
      const redirectUri = LOOPBACK.redirectUri;
      const reqUrl = new URL(req.url || '/', redirectUri);
      const callbackPath = new URL(redirectUri).pathname;
      if (reqUrl.pathname !== callbackPath) {
        res.writeHead(204);
        res.end();
        return;
      }

      callbackReceived = true;
      const code = reqUrl.searchParams.get('code');

      res.setHeader('content-type', 'text/html');
      res.end(code ? SUCCESS_HTML : ERROR_HTML);
      server.close();

      if (!code) {
        if (!settled) {
          settled = true;
          if (timeout) clearTimeout(timeout);
          reject(new Error('No code found in callback URL'));
        }
        return;
      }

      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);

      try {
        const user = await completeLoginOAuth(code, redirectUri);
        resolve(user);
      } catch (e) {
        reject(e as Error);
      }
    });

    server.listen(LOOPBACK.port, LOOPBACK.host, async () => {
      const redirectUri = LOOPBACK.redirectUri;
      console.log('[Login] redirect URI:', redirectUri);
      const oauth2Client = createOAuthClient(redirectUri);
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
        ],
        prompt: 'consent',
      });
      try {
        await shell.openExternal(authUrl);
      } catch (e) {
        fail(e as Error);
      }
    });

    timeout = setTimeout(() => fail(new Error('Login timed out. Please try again.')), CALLBACK_TIMEOUT_MS);

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        fail(new Error(`Port ${LOOPBACK.port} is in use. Close it and try again.`));
      } else {
        fail(err);
      }
    });
  });
}

async function completeLoginOAuth(code: string, redirectUri: string): Promise<UserRow> {
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

  const user = addUser({ email, refresh_token: tokens.refresh_token, display_name: displayName, avatar_url: avatarUrl });
  console.log('[Login] User saved ✓ id:', user.id);
  return user;
}

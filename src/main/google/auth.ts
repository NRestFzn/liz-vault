import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';
import { errorMessage } from '../errors';
import { runLoopbackOAuthFlow } from '../oauth/loopback';
import { addAccount, addUser, getGoogleCredentials, seedManifestForUser } from '../db/queries';
import type { AccountRow, UserRow } from '../../shared/types';

const VAULT_FOLDER_NAME = 'LizVault';
const STORAGE_FOLDER_NAME = 'LizVault';
const LEGACY_FOLDER_NAME = 'LizVault_Data';
const LEGACY_STORAGE_NAME = 'LizVault_Data';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

function getOAuthCredentials(): { clientId: string; clientSecret: string } {
  return getGoogleCredentials();
}

function assertCredentialsConfigured(): void {
  const { clientId, clientSecret } = getOAuthCredentials();
  if (!clientId || !clientSecret) {
    throw new Error('Google API credentials are not set. Open Settings and add your Client ID and Client Secret first.');
  }
}

export function createOAuthClient(redirectUri: string) {
  assertCredentialsConfigured();
  const { clientId, clientSecret } = getOAuthCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export interface OAuthFlowResult {
  account: AccountRow;
  folderCreated: boolean;
}

export interface LoginFlowResult {
  user: UserRow;
  folderCreated: boolean;
}

export async function initiateOAuthFlow(userId: number): Promise<OAuthFlowResult> {
  assertCredentialsConfigured();
  const { code, redirectUri } = await runLoopbackOAuthFlow(async (redirectUri) => {
    const oauth2Client = createOAuthClient(redirectUri);
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    });
  }, 'OAuth login timed out. Please try again.');
  return completeOAuth(code, redirectUri, userId);
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

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email;
  if (!email) {
    throw new Error('Failed to retrieve user email.');
  }
  console.log('[OAuth] User email:', email);

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const about = await drive.about.get({ fields: 'storageQuota' });
  const limit = about.data.storageQuota?.limit ? parseInt(about.data.storageQuota.limit, 10) : null;
  const usage = about.data.storageQuota?.usage ? parseInt(about.data.storageQuota.usage, 10) : null;
  console.log('[OAuth] Drive quota — limit:', limit, 'usage:', usage);

  let rootFolderId = null;
  let folderCreated = false;
  const { id, created } = await findOrCreateFolder(drive, STORAGE_FOLDER_NAME, LEGACY_STORAGE_NAME);
  rootFolderId = id;
  folderCreated = created;
  console.log(`[OAuth] ${created ? 'Created' : 'Found existing'} ${STORAGE_FOLDER_NAME} storage folder:`, rootFolderId);

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
  const client = createOAuthClient('http://localhost/oauth/callback');
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: client });
}

export async function findOrCreateFolder(drive: drive_v3.Drive, preferredName: string, legacyName: string): Promise<{ id: string; created: boolean }> {
  const query = `(name='${preferredName}' or name='${legacyName}') and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const existing = await drive.files.list({ q: query, spaces: 'drive', fields: 'files(id, name)' });
  if (existing.data.files && existing.data.files.length > 0) {
    const preferred = existing.data.files.find(f => f.name === preferredName) ?? existing.data.files[0];
    const id = preferred.id;
    if (!id) throw new Error('Drive did not return an id for the vault folder.');
    return { id, created: false };
  }
  const folder = await drive.files.create({
    requestBody: { name: preferredName, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  const id = folder.data.id;
  if (!id) throw new Error('Drive did not return an id for the vault folder.');
  return { id, created: true };
}

export async function initiateLoginFlow(): Promise<LoginFlowResult> {
  assertCredentialsConfigured();
  const { code, redirectUri } = await runLoopbackOAuthFlow(async (redirectUri) => {
    const oauth2Client = createOAuthClient(redirectUri);
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.metadata.readonly',
      ],
      prompt: 'consent',
    });
  }, 'Login timed out. Please try again.');
  return completeLoginOAuth(code, redirectUri);
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

  let rootFolderId: string | null = null;
  let folderCreated = false;
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const { id, created } = await findOrCreateFolder(drive, VAULT_FOLDER_NAME, LEGACY_FOLDER_NAME);
    rootFolderId = id;
    folderCreated = created;
    console.log(`[Login] ${created ? 'Created' : 'Found existing'} ${VAULT_FOLDER_NAME} folder:`, rootFolderId);
  } catch (e) {
    console.warn('[Login] Failed to ensure vault folder:', errorMessage(e));
  }

  const user = addUser({ email, refresh_token: tokens.refresh_token, display_name: displayName, avatar_url: avatarUrl, root_folder_id: rootFolderId });
  console.log('[Login] User saved ✓ id:', user.id);

  await seedManifestForUser(user);
  return { user, folderCreated };
}

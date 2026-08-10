import { google } from 'googleapis';
import { shell, BrowserWindow } from 'electron';
import { addAccount } from '../db/queries';
import { getDb } from '../db/schema';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env variables
// In development __dirname is dist/main/main/google, so we go up 4 levels
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

// The redirect URI matches what is configured in Google Cloud Console
const REDIRECT_URI = 'lizvault://oauth/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET';

export function createOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export async function initiateOAuthFlow() {
  const oauth2Client = createOAuthClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // Force to get refresh token
  });
  
  // Open the OS browser to log in
  await shell.openExternal(authUrl);
}

export async function handleOAuthCallback(urlStr: string) {
  try {
    const url = new URL(urlStr);
    const code = url.searchParams.get('code');
    if (!code) {
      throw new Error('No code found in URL');
    }

    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    if (!tokens.refresh_token) {
      throw new Error('No refresh token received. User must grant offline access.');
    }

    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;
    if (!email) {
      throw new Error('Failed to retrieve user email.');
    }

    // Get Drive quota info
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const about = await drive.about.get({ fields: 'storageQuota' });
    const limit = about.data.storageQuota?.limit ? parseInt(about.data.storageQuota.limit, 10) : null;
    const usage = about.data.storageQuota?.usage ? parseInt(about.data.storageQuota.usage, 10) : null;

    // Create root folder "LizVault_Data"
    let rootFolderId = null;
    const query = "name='LizVault_Data' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    const existing = await drive.files.list({ q: query, spaces: 'drive', fields: 'files(id, name)' });
    
    if (existing.data.files && existing.data.files.length > 0) {
      rootFolderId = existing.data.files[0].id!;
    } else {
      const folder = await drive.files.create({
        requestBody: {
          name: 'LizVault_Data',
          mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id'
      });
      rootFolderId = folder.data.id!;
    }

    // Save to DB
    const account = addAccount({
      email,
      refresh_token: tokens.refresh_token,
      total_bytes: limit,
      used_bytes: usage,
      root_folder_id: rootFolderId
    });

    return account;
  } catch (error) {
    console.error('OAuth Callback Error:', error);
    throw error;
  }
}

export function getDriveClient(refreshToken: string) {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: client });
}

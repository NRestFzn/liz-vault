import { runLoopbackOAuthFlow } from '../oauth/loopback';
import { addAccount } from '../db/queries';
import type { AccountRow } from '../../shared/types';
import { getDropboxCredentials } from '../db/config';
import { logE2E } from '../e2eLog';
import {
  dropboxEnsureFolder,
  dropboxGetProfile,
  dropboxGetQuota,
  DropboxApiError,
  generateCodeChallenge,
  generateCodeVerifier,
} from './drive';

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const SCOPES = 'files.content.read files.content.write files.metadata.read files.metadata.write account_info.read';
const STORAGE_FOLDER_NAME = 'LizVault';
const LEGACY_STORAGE_NAME = 'LizVault_Data';

function requireClientId(): string {
  const { clientId } = getDropboxCredentials();
  if (!clientId) {
    throw new Error('Dropbox API credentials are not set. Open Settings and add your App key first.');
  }
  return clientId;
}

async function exchangeCode(redirectUri: string, code: string, verifier: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: requireClientId(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: SCOPES,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    let message = `Dropbox token exchange failed (${res.status}).`;
    try {
      const body = await res.text();
      const parsed = JSON.parse(body) as { error_description?: string };
      if (parsed.error_description) message = parsed.error_description;
    } catch { }
    throw new DropboxApiError(message, res.status);
  }
  const data = await res.json() as { refresh_token?: string };
  if (!data.refresh_token) {
    throw new Error('No refresh token received. User must grant offline access.');
  }
  return data.refresh_token;
}

export interface DropboxConnectResult {
  account: AccountRow;
  folderCreated: boolean;
}

export async function initiateDropboxOAuthFlow(userId: number): Promise<DropboxConnectResult> {
  const clientId = requireClientId();
  logE2E('oauth.dropbox.start', { userId });
  let verifier = '';
  const { code, redirectUri } = await runLoopbackOAuthFlow(async (redirectUri) => {
    verifier = generateCodeVerifier();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      code_challenge: generateCodeChallenge(verifier),
      code_challenge_method: 'S256',
      token_access_type: 'offline',
    });
    return `${AUTH_URL}?${params.toString()}`;
  }, 'Dropbox login timed out. Please try again.');

  console.log('[Dropbox] Exchanging code for tokens…');
  logE2E('oauth.dropbox.code-received', { userId });
  const refreshToken = await exchangeCode(redirectUri, code, verifier);
  console.log('[Dropbox] Got refresh token ✓');

  const { email, displayName } = await dropboxGetProfile(refreshToken);
  const { total, used } = await dropboxGetQuota(refreshToken);
  console.log('[Dropbox] Account:', email, 'quota:', total, 'used:', used);

  const { id: rootFolderId, created: folderCreated } = await dropboxEnsureFolder(refreshToken, STORAGE_FOLDER_NAME, LEGACY_STORAGE_NAME);
  console.log(`[Dropbox] ${folderCreated ? 'Created' : 'Found existing'} ${STORAGE_FOLDER_NAME} storage folder:`, rootFolderId);

  const account = addAccount({
    user_id: userId,
    email,
    provider: 'dropbox',
    refresh_token: refreshToken,
    total_bytes: total,
    used_bytes: used,
    root_folder_id: rootFolderId,
  });
  logE2E('oauth.dropbox.complete', { userId, email, accountId: account.id, quotaTotal: total, quotaUsed: used, folderCreated, rootFolderId });
  console.log('[Dropbox] Account saved ✓ id:', account.id, 'display:', displayName);

  return { account, folderCreated };
}

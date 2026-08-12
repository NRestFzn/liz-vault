/**
 * queries.ts — facade over the two JSON stores that replaced SQLite:
 *  - ./config    → local config.json  (credentials, users, accounts, settings)
 *  - ./manifest  → manifest.json on Drive (files + chunks)
 *
 * All exported signatures are identical to the old SQLite implementation so
 * the IPC layer and vault modules need no other changes.
 */

import { removeUser as removeConfigUser } from './config';
import { removeFilesForUser } from './manifest';

// Local config store (credentials, users, accounts, settings, active user)
export {
  initConfig,
  getGoogleCredentials,
  setGoogleCredentials,
  getActiveUserId,
  setActiveUserId,
  addUser,
  getUser,
  addAccount,
  setAccountTokenStatus,
  getAccount,
  getAccountByEmail,
  getAllAccounts,
  removeAccount,
  updateAccountUsage,
  updateAccountRootFolder,
  getAppState,
  setAppState,
  deleteAppState,
} from './config';

// Drive manifest store (files + chunks)
export {
  initManifest,
  resetVaultStore,
  ensureManifestLoaded,
  invalidateManifestLoaded,
  seedManifestForUser,
  flushManifestSave,
  flushNow,
  cancelScheduledSave,
  addFile,
  createFolder,
  getFile,
  getAllFiles,
  getFilesInFolder,
  getChildIds,
  getFolderItemCounts,
  getFolderPath,
  toggleStarred,
  getStarredFiles,
  getStorageStats,
  searchFilesAndFolders,
  renameFile,
  findDuplicateName,
  getUniqueName,
  updateFileStatus,
  removeFile,
  removeFilesForUser,
  addChunk,
  getChunk,
  getChunksForFile,
  getChunksForAccount,
  updateChunkStatus,
} from './manifest';

/**
 * Delete a login user + everything they own. Composed here because the old
 * FK cascade spanned both stores: users→accounts (config) and users→files/
 * chunks (manifest).
 */
export function removeUser(id: number): void {
  removeFilesForUser(id);
  removeConfigUser(id);
}


import { removeUser as removeConfigUser } from './config';
import { removeFilesForUser } from './manifest';

export {
  initConfig,
  getGoogleCredentials,
  setGoogleCredentials,
  getDropboxCredentials,
  setDropboxCredentials,
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

export function removeUser(id: number): void {
  removeFilesForUser(id);
  removeConfigUser(id);
}

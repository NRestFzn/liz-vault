export interface AccountRow {
  id: number;
  user_id: number;
  email: string;
  refresh_token: string;
  total_bytes: number | null;
  used_bytes: number | null;
  root_folder_id: string | null;
  added_at: string;
}

/** Login identity — separate from drive storage accounts. */
export interface UserRow {
  id: number;
  email: string;
  refresh_token: string;
  display_name: string | null;
  avatar_url: string | null;
  added_at: string;
}

export interface IpcUserLoginResponse {
  user?: UserRow;
  error?: string;
}

export interface IpcUserCurrentResponse {
  user: UserRow | null;
}

export type FileStatus = 'ready' | 'uploading' | 'downloading' | 'error';

export interface FileRow {
  id: number;
  user_id: number;
  name: string;
  size_bytes: number;
  mime_type: string | null;
  status: FileStatus;
  created_at: string;
  updated_at: string | null;
  is_folder: number; // 0 | 1
  parent_folder_id: number | null;
  is_starred: number; // 0 | 1
}

export type ChunkStatus = 'uploaded' | 'pending' | 'error';

/** A file or folder result from global search, plus its immediate parent folder name and full ancestor chain (for breadcrumbs). */
export interface SearchResultRow extends FileRow {
  parent_name: string | null;
  /** Full ancestor chain (root → immediate parent). Empty when the item is at root. */
  parent_path: string[];
}

export interface ChunkRow {
  id: number;
  file_id: number;
  account_id: number;
  drive_file_id: string;
  sequence: number;
  size_bytes: number;
  status: ChunkStatus;
}

// IPC Channels

// 1. Accounts
export interface IpcAccountAddResponse {
  account?: AccountRow;
  error?: string;
}

export interface IpcAccountRemoveRequest {
  accountId: number;
}

export interface IpcAccountRemoveResponse {
  success?: boolean;
  error?: string;
  affectedFiles?: number;
}

export interface IpcAccountsListResponse {
  accounts: AccountRow[];
}

// 2. Files
export interface IpcFilesListResponse {
  files: FileRow[];
}

export interface IpcFilesSearchAllRequest {
  query: string;
}

export interface IpcFilesSearchAllResponse {
  results: SearchResultRow[];
}

export interface IpcFolderCreateRequest {
  name: string;
  parentFolderId?: number | null;
}

export interface IpcFolderCreateResponse {
  folder?: FileRow;
  error?: string;
}

export interface IpcFilesInFolderRequest {
  folderId: number | null;
}

export interface IpcFilesInFolderResponse {
  items: FileRow[];
}

export interface IpcFolderItemCountsRequest {
  folderIds: number[];
}

export interface IpcFolderItemCountsResponse {
  counts: Record<number, number>;
}

export interface IpcFolderPathRequest {
  folderId: number | null;
}

export interface IpcFolderPathResponse {
  path: FileRow[];
}

export interface IpcFilesStarredResponse {
  files: FileRow[];
}

export interface IpcFileStarRequest {
  fileId: number;
  starred: boolean;
}

export interface IpcFileStarResponse {
  file?: FileRow;
  error?: string;
}

export interface StorageCategories {
  photo: number;
  video: number;
  document: number;
  other: number;
}

export interface IpcStorageStatsResponse {
  categories: StorageCategories;
}

export interface IpcFileUploadRequest {
  filePath: string;
  fileName: string;
  parentFolderId?: number | null;
}

export interface IpcFileUploadResponse {
  fileId?: number;
  error?: string;
}

export interface IpcFileDownloadRequest {
  fileId: number;
  savePath: string;
}

export interface IpcFileDownloadResponse {
  success?: boolean;
  error?: string;
}

export interface IpcFileDeleteRequest {
  fileId: number;
}

export interface IpcFileDeleteResponse {
  success?: boolean;
  error?: string;
}

export interface IpcFilesDeleteManyRequest {
  fileIds: number[];
}

export interface IpcFilesDeleteManyResponse {
  success?: boolean;
  error?: string;
}

// Events from Main -> Renderer
export interface IpcUploadProgressEvent {
  fileId: number;
  bytesUploaded: number;
  totalBytes: number;
  chunkIndex: number;
}

export interface IpcUploadCompleteEvent {
  fileId: number;
  file: FileRow;
}

export interface IpcUploadErrorEvent {
  fileId: number;
  error: string;
}

export interface IpcDownloadProgressEvent {
  fileId: number;
  bytesDownloaded: number;
  totalBytes: number;
  chunkIndex: number;
}

export interface IpcDownloadCompleteEvent {
  fileId: number;
  savePath: string;
}

export interface IpcDownloadErrorEvent {
  fileId: number;
  error: string;
}

export interface IpcFileDeletedEvent {
  fileId: number;
}

export interface IpcFileStarredEvent {
  file: FileRow;
}

// Settings

export interface IpcSettingsGetResponse {
  confirmDelete: boolean;
}

export interface IpcSettingsSetRequest {
  confirmDelete: boolean;
}

export interface IpcSettingsSetResponse {
  success?: boolean;
  error?: string;
}

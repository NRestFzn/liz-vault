export type AccountProvider = 'google' | 'dropbox' | 'koofr';

export const PROVIDER_NAMES: Record<AccountProvider, string> = {
  google: 'Google Drive',
  dropbox: 'Dropbox',
  koofr: 'Koofr',
};

export interface AccountRow {
  id: number;
  user_id: number;
  email: string;
  provider: AccountProvider;
  refresh_token: string;
  total_bytes: number | null;
  used_bytes: number | null;
  root_folder_id: string | null;
  added_at: string;
  token_ok: number;
  last_checked_at: string | null;
}

export interface UserRow {
  id: number;
  email: string;
  refresh_token: string;
  display_name: string | null;
  avatar_url: string | null;
  root_folder_id: string | null;
  manifest_key: string | null;
  added_at: string;
}

export interface IpcUserLoginResponse {
  user?: UserRow;
  folderCreated?: boolean;
  cancelled?: boolean;
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
  is_folder: number;
  parent_folder_id: number | null;
  is_starred: number;
  deleted_at: string | null;
}

export type ChunkStatus = 'uploaded' | 'pending' | 'error';

export interface SearchResultRow extends FileRow {
  parent_name: string | null;
  parent_path: string[];
}

export interface ChunkRow {
  id: number;
  file_id: number;
  account_email: string;
  account_provider: AccountProvider;
  drive_file_id: string;
  sequence: number;
  size_bytes: number;
  status: ChunkStatus;
  enc_iv?: string | null;
  enc_tag?: string | null;
}


export interface IpcAccountAddResponse {
  account?: AccountRow;
  folderCreated?: boolean;
  cancelled?: boolean;
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

export interface IpcAccountTestResponse {
  ok: boolean;
  expired?: boolean;
  error?: string;
}

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
  duplicate?: boolean;
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
  duplicate?: boolean;
  error?: string;
}

export interface IpcFileRenameRequest {
  fileId: number;
  newName: string;
}

export interface IpcFileRenameResponse {
  file?: FileRow;
  duplicate?: boolean;
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

export interface TrashItemRow extends FileRow {
  parent_path: string[];
}

export interface IpcTrashListResponse {
  items: TrashItemRow[];
}

export interface IpcFileRestoreRequest {
  fileId: number;
}

export interface IpcFileRestoreResponse {
  success?: boolean;
  error?: string;
}

export interface IpcTrashEmptyResponse {
  success?: boolean;
  error?: string;
}

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

export interface IpcFileRenamedEvent {
  file: FileRow;
}


export interface IpcSettingsGetResponse {
  confirmDelete: boolean;
  autoRenameDuplicates: boolean;
  autoRefreshQuota: boolean;
  autoEmptyTrashDays: number;
}

export interface IpcSettingsSetRequest {
  confirmDelete?: boolean;
  autoRenameDuplicates?: boolean;
  autoRefreshQuota?: boolean;
  autoEmptyTrashDays?: number;
}

export interface IpcSettingsSetResponse {
  success?: boolean;
  error?: string;
}


export interface IpcCredentialsGetRequest {
  provider?: AccountProvider;
}

export interface IpcCredentialsGetResponse {
  clientId: string;
  clientSecret: string;
}

export interface IpcCredentialsSetRequest {
  provider?: AccountProvider;
  clientId: string;
  clientSecret: string;
}

export interface IpcCredentialsSetResponse {
  success?: boolean;
  error?: string;
}

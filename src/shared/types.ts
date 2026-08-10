export interface AccountRow {
  id: number;
  email: string;
  refresh_token: string;
  total_bytes: number | null;
  used_bytes: number | null;
  root_folder_id: string | null;
  added_at: string;
}

export type FileStatus = 'ready' | 'uploading' | 'downloading' | 'error';

export interface FileRow {
  id: number;
  name: string;
  size_bytes: number;
  mime_type: string | null;
  status: FileStatus;
  created_at: string;
  updated_at: string | null;
}

export type ChunkStatus = 'uploaded' | 'pending' | 'error';

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

export interface IpcFilesSearchRequest {
  query: string;
}

export interface IpcFileUploadRequest {
  filePath: string;
  fileName: string;
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

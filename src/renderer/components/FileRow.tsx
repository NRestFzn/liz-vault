import React from 'react';
import { FileRow as FileRowType } from '../../shared/types';

interface FileRowProps {
  file: FileRowType;
  onContextMenu: (e: React.MouseEvent, file: FileRowType) => void;
}

function getFileTypeClass(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
  if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext)) return 'audio';
  if (['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(ext)) return 'document';
  return 'other';
}

const SvgIcon = ({ children }: { children: React.ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

function getFileIcon(typeClass: string): React.ReactNode {
  switch (typeClass) {
    case 'image': return <SvgIcon><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></SvgIcon>;
    case 'video': return <SvgIcon><polygon points="23 7 16 12 23 17 23 7"/><rect width="15" height="14" x="1" y="5" rx="2" ry="2"/></SvgIcon>;
    case 'audio': return <SvgIcon><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></SvgIcon>;
    case 'document': return <SvgIcon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></SvgIcon>;
    default: return <SvgIcon><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></SvgIcon>;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
  return date.toLocaleDateString('en-US', options);
}

export const FileRow: React.FC<FileRowProps> = ({ file, onContextMenu }) => {
  const typeClass = getFileTypeClass(file.name);
  const icon = getFileIcon(typeClass);
  const modifiedDate = file.updated_at || file.created_at;

  return (
    <tr onContextMenu={(e) => onContextMenu(e, file)}>
      <td>
        <input type="checkbox" className="file-table-checkbox" />
      </td>
      <td>
        <div className="file-name-cell">
          <div className={`file-type-icon ${typeClass}`}>{icon}</div>
          <span className="file-name-text">{file.name}</span>
        </div>
      </td>
      <td className="file-date">{formatDate(modifiedDate)}</td>
      <td className="file-size">{formatFileSize(file.size_bytes)}</td>
      <td>
        <div className="file-access">
          <div className="file-access-avatar">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <span className="file-access-email">@gmail.com</span>
        </div>
      </td>
      <td style={{ textAlign: 'right' }}>
        <button className="file-kebab" onClick={(e) => onContextMenu(e, file)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </td>
    </tr>
  );
};

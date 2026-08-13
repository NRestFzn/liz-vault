import type React from 'react';
import type { FileRow as FileRowType } from '../../shared/types';
import { getFileTypeInfo } from '../../shared/fileCategory';
import { formatBytes } from '../../shared/format';
import { FileTypeIcon } from './FileTypeIcon';

interface FileRowProps {
  file: FileRowType;
  isSelected: boolean;
  isHighlighted?: boolean;
  onSelect: (checked: boolean) => void;
  onContextMenu: (e: React.MouseEvent, file: FileRowType) => void;
}

function formatDate(dateStr: string): string {
  const isUTC = !dateStr.includes('Z') && !dateStr.includes('T');
  const date = new Date(isUTC ? `${dateStr.replace(' ', 'T')}Z` : dateStr);
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
  return date.toLocaleDateString('en-US', options);
}

export const FileRow: React.FC<FileRowProps> = ({ file, isSelected, isHighlighted, onSelect, onContextMenu }) => {
  const typeInfo = getFileTypeInfo(file.name);
  const modifiedDate = file.updated_at || file.created_at;

  return (
    <tr id={`file-row-${file.id}`} className={`border-b border-line transition-colors duration-100 hover:bg-accent/[0.02] ${isHighlighted ? 'bg-accent-soft' : ''}`} onContextMenu={(e) => onContextMenu(e, file)}>
      <td className="w-9 py-3.5 pl-1">
        <input 
          type="checkbox" 
          className="h-4 w-4 cursor-pointer rounded border-[1.5px] border-line accent-accent" 
          checked={isSelected}
          onChange={(e) => onSelect(e.target.checked)}
        />
      </td>
      <td className="px-3 py-3.5 align-middle">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `${typeInfo.color}1A` }}>
            <FileTypeIcon name={file.name} size={16} />
          </div>
          <span className="font-medium text-ink flex items-center gap-2">
            {file.name}
            {file.is_starred === 1 && (
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            )}
          </span>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-3.5 text-muted">{formatDate(modifiedDate)}</td>
      <td className="whitespace-nowrap px-3 py-3.5 text-muted">{formatBytes(file.size_bytes)}</td>
      <td className="px-3 py-3.5 text-right">
        <button type="button" aria-label="More options" className="cursor-pointer rounded border-0 bg-transparent px-2 py-1 text-[18px] text-muted transition-colors duration-100 hover:bg-surface" onClick={(e) => onContextMenu(e, file)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </td>
    </tr>
  );
};

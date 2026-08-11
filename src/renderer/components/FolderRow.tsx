import React from 'react';

interface FolderRowProps {
  name: string;
  updated: string;
  itemCount: number;
  isStarred?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/**
 * List-view folder row — same column layout as the file table so folders and
 * files line up when both are shown in list mode. Clicking navigates into the
 * folder.
 */
export const FolderRow: React.FC<FolderRowProps> = ({ name, updated, itemCount, isStarred, onClick, onContextMenu }) => (
  <tr
    className={`border-b border-line transition-colors duration-100 hover:bg-accent/[0.02] ${onClick ? 'cursor-pointer' : ''}`}
    onClick={onClick}
    onContextMenu={onContextMenu}
  >
    <td className="w-9 py-3.5 pl-1" />
    <td className="px-3 py-3.5 align-middle">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: 'var(--color-folder-blue)1A' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-folder-blue)' }}>
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
          </svg>
        </div>
        <span className="flex items-center gap-2 font-medium text-ink">
          {name}
          {isStarred && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-amber-400">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          )}
        </span>
      </div>
    </td>
    <td className="whitespace-nowrap px-3 py-3.5 text-muted">{updated}</td>
    <td className="whitespace-nowrap px-3 py-3.5 text-muted">{itemCount} item{itemCount === 1 ? '' : 's'}</td>
    <td className="px-3 py-3.5" />
  </tr>
);

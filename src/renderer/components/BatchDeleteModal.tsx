import React, { useEffect, useRef } from 'react';
import { FileRow as FileRowType } from '../../shared/types';
import { FileTypeIcon } from './FileTypeIcon';

interface BatchDeleteModalProps {
  items: FileRowType[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Multi-delete confirmation modal. Unlike the single-item ConfirmDialog, this
 * one ALWAYS appears for batch deletes so the user can re-check exactly what
 * is being removed (names listed with type icons). Folders and files mix.
 */
export const BatchDeleteModal: React.FC<BatchDeleteModalProps> = ({ items, onConfirm, onCancel }) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
      onCancel();
    }
  };

  const folderCount = items.filter(i => i.is_folder === 1).length;
  const fileCount = items.length - folderCount;
  const summary =
    folderCount > 0 && fileCount > 0
      ? `${folderCount} folder${folderCount === 1 ? '' : 's'} and ${fileCount} file${fileCount === 1 ? '' : 's'}`
      : folderCount > 0
        ? `${folderCount} folder${folderCount === 1 ? '' : 's'}`
        : `${fileCount} file${fileCount === 1 ? '' : 's'}`;

  return (
    <div
      className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className="w-[440px] max-w-[90vw] rounded-xl border border-line bg-panel p-6 shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
        role="alertdialog"
        aria-modal="true"
      >
        <h3 className="mb-1 text-[18px] font-semibold text-ink">Delete {items.length} items?</h3>
        <div className="mb-4 text-[12.5px] leading-relaxed text-muted">
          {summary} will be permanently removed from all connected drives. Folders are deleted along with everything inside them. This cannot be undone.
        </div>

        {/* Scrollable list of everything being deleted */}
        <div className="max-h-[220px] overflow-y-auto rounded-lg border border-line bg-surface/60 p-1.5">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/[0.05]">
              {item.is_folder === 1 ? (
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: 'var(--color-folder-blue)1A' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-folder-blue)' }}>
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                  </svg>
                </div>
              ) : (
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: 'var(--color-accent)1A' }}>
                  <FileTypeIcon name={item.name} size={14} />
                </div>
              )}
              <span className="min-w-0 truncate text-[13px] font-medium text-ink">{item.name}</span>
              {item.is_folder === 1 && (
                <span className="ml-auto flex-shrink-0 pl-2 text-[11px] text-muted">folder</span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-outline" onClick={onCancel}>Cancel</button>
          <button
            ref={confirmRef}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-red-700"
            onClick={onConfirm}
          >
            Delete {items.length} items
          </button>
        </div>
      </div>
    </div>
  );
};

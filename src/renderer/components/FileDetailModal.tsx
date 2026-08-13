import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { SearchResultRow } from '../../shared/types';
import { getFileTypeInfo, splitFileName } from '../../shared/fileCategory';
import { formatBytes } from '../../shared/format';
import { FileTypeIcon } from './FileTypeIcon';
import { ThumbnailImage } from './ThumbnailImage';
import { ConfirmDialog } from './ConfirmDialog';
import { RenameModal } from './RenameModal';
import { useToast } from './Toast';
import { AnimatePresence, motion } from 'motion/react';

const { ipcRenderer } = window.require('electron');

interface FileDetailModalProps {
  file: SearchResultRow;
  onClose: () => void;
  onOpenLocation: (file: SearchResultRow) => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const isUTC = !dateStr.includes('Z') && !dateStr.includes('T');
  const date = new Date(isUTC ? `${dateStr.replace(' ', 'T')}Z` : dateStr);
  return date.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

const STAR_ICON = (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

export const FileDetailModal: React.FC<FileDetailModalProps> = ({ file, onClose, onOpenLocation }) => {
  const [starred, setStarred] = useState(file.is_starred === 1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(file.name);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const { toastError } = useToast();
  const typeInfo = getFileTypeInfo(displayName);
  const location =
    file.parent_path && file.parent_path.length > 0
      ? `All Files / ${file.parent_path.join(' / ')}`
      : 'All Files';

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmOpen && !renameOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, confirmOpen, renameOpen]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('[role="alertdialog"]')) return;
    if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  const toggleStar = async () => {
    try {
      const res = await ipcRenderer.invoke('file:star', { fileId: file.id, starred: !starred });
      if (res?.error) {
        toastError(res.error);
      } else {
        setStarred(v => !v);
      }
    } catch (e) {
      toastError(String(e));
    }
  };

  const handleDownload = async () => {
    try {
      const { filePath } = await ipcRenderer.invoke('file:pick-download-path', displayName);
      if (filePath) {
        const res = await ipcRenderer.invoke('file:download', { fileId: file.id, savePath: filePath });
        if (res?.error) toastError(res.error);
      }
    } catch (e) {
      toastError(String(e));
    }
  };

  const handleRenameConfirm = async (newName: string) => {
    try {
      const res = await ipcRenderer.invoke('file:rename', { fileId: file.id, newName });
      if (res?.error) {
        setRenameError(res.duplicate ? `A file named “${newName}” already exists here.` : res.error);
        return;
      }
      if (res?.file) setDisplayName(res.file.name);
      setRenameOpen(false);
      setRenameError(null);
    } catch (e) {
      toastError(String(e));
    }
  };

  const handleDeleteClick = async () => {
    try {
      const res = await ipcRenderer.invoke('settings:get');
      if (res.confirmDelete === false) {
        await runDelete();
      } else {
        setConfirmOpen(true);
      }
    } catch {
      setConfirmOpen(true);
    }
  };

  const persistDontAskAgain = async (dontAskAgain: boolean) => {
    if (!dontAskAgain) return;
    try {
      await ipcRenderer.invoke('settings:set', { confirmDelete: false });
    } catch (e) {
      console.error(e);
    }
  };

  const runDelete = async () => {
    try {
      const res = await ipcRenderer.invoke('file:delete', { fileId: file.id });
      if (res?.error) toastError(res.error);
    } catch (e) {
      toastError(String(e));
    }
    onClose();
  };

  const handleConfirmDelete = async (dontAskAgain: boolean) => {
    await persistDontAskAgain(dontAskAgain);
    await runDelete();
  };

  const handleCancelDelete = async (dontAskAgain: boolean) => {
    await persistDontAskAgain(dontAskAgain);
    setConfirmOpen(false);
  };

  const meta = [
    { label: 'Location', value: location },
    { label: 'Type', value: typeInfo.label },
    { label: 'Size', value: formatBytes(file.size_bytes) },
    { label: 'Created', value: formatDate(file.created_at) },
    { label: 'Modified', value: formatDate(file.updated_at || file.created_at) },
  ];

  return (
      <motion.div
        className="fixed inset-0 z-[15000] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
        onMouseDown={handleBackdropClick}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="flex max-h-[calc(100vh-48px)] w-[520px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_16px_48px_rgba(0,0,0,0.18)]"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-line px-6 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${typeInfo.color}1A` }}
            >
              <FileTypeIcon name={displayName} size={18} />
            </div>
            <h3 className="truncate text-[15px] font-semibold text-ink">{displayName}</h3>
          </div>
          <button type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-surface hover:text-ink"
          >
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex h-[220px] min-h-0 items-center justify-center overflow-hidden border-b border-line bg-surface">
          <ThumbnailImage file={{ ...file, name: displayName }} iconSize={72} />
        </div>

        <div className="flex-shrink-0 px-6 py-5">
          <div className="mb-5 flex items-center gap-2.5">
            <span
              className="rounded-md px-2 py-0.5 text-[11px] font-medium"
              style={{ color: typeInfo.color, backgroundColor: `${typeInfo.color}1A` }}
            >
              {typeInfo.label}
            </span>
            <span className="rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
              {formatBytes(file.size_bytes)}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {meta.map(row => (
              <div key={row.label} className="flex items-baseline justify-between gap-6">
                <span className="flex-shrink-0 text-[12px] text-muted">{row.label}</span>
                <span className="min-w-0 truncate text-right text-[13px] font-medium text-ink">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">
          <button type="button" className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={toggleStar}>
            <span className={starred ? 'text-amber-400' : 'text-muted'}>{STAR_ICON}</span>
            {starred ? 'Starred' : 'Add Star'}
          </button>
          <button type="button" className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={() => onOpenLocation(file)}>
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
            Open Location
          </button>
          <button type="button" className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={() => { setRenameError(null); setRenameOpen(true); }}>
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            Rename
          </button>
          <button type="button" className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={handleDownload}>
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
          <button type="button"
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-1.5 text-[12px] font-medium text-red-600 transition-all duration-150 hover:border-red-300 hover:bg-red-100"
            onClick={handleDeleteClick}
          >
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            Delete
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {confirmOpen && (
          <ConfirmDialog
            title="Delete File"
            message={<>Delete <span className="font-medium text-ink">“{displayName}”</span> from all connected drives? This cannot be undone.</>}
            confirmLabel="Delete"
            checkboxLabel="Don't ask again"
            onConfirm={handleConfirmDelete}
            onCancel={handleCancelDelete}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {renameOpen && (
          <RenameModal
            title={file.is_folder === 1 ? 'Rename Folder' : 'Rename File'}
            initialName={file.is_folder === 1 ? displayName : splitFileName(displayName).base}
            suffix={file.is_folder === 1 ? '' : splitFileName(displayName).ext}
            error={renameError}
            onConfirm={handleRenameConfirm}
            onCancel={() => { setRenameOpen(false); setRenameError(null); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

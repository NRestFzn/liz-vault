import React, { useEffect, useRef, useState } from 'react';
import { FileRow as FileRowType } from '../../shared/types';
import { ConfirmDialog } from './ConfirmDialog';
import { BatchDeleteModal } from './BatchDeleteModal';
import { useToast } from './Toast';
const { ipcRenderer } = window.require('electron');

interface ContextMenuProps {
  x: number;
  y: number;
  file: FileRowType;
  onClose: () => void;
  onOpen?: () => void;
  onRename?: (file: FileRowType) => void;
  selectedFiles?: FileRowType[];
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, file, onClose, onOpen, onRename, selectedFiles }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const isFolder = file.is_folder === 1;
  const { toastError } = useToast();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Ignore clicks inside the confirm dialog — it has its own dismissal.
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && !(e.target as Element).closest('[role="alertdialog"]')) {
        onClose();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const targets = selectedFiles && selectedFiles.length > 0 ? selectedFiles : [file];
  const isBatch = targets.length > 1;
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Multi-delete ALWAYS shows the listing re-check modal (it exists so the
  // user can verify exactly which items are being removed).
  const [batchOpen, setBatchOpen] = useState(false);

  const runDelete = async () => {
    try {
      if (targets.length > 1) {
        const res = await ipcRenderer.invoke('file:delete-many', { fileIds: targets.map(t => t.id) });
        if (res?.error) toastError(res.error);
      } else {
        const res = await ipcRenderer.invoke('file:delete', { fileId: targets[0].id });
        if (res?.error) toastError(res.error);
      }
    } catch (e: any) {
      toastError(String(e));
    }
    onClose();
  };

  // Multi-delete → always the listing modal (no settings opt-out).
  // Single delete → read the confirm-before-delete setting; show the custom
  // dialog unless disabled.
  const handleDeleteClick = async () => {
    if (isBatch) {
      setBatchOpen(true);
      return;
    }
    try {
      const res = await ipcRenderer.invoke('settings:get');
      if (res.confirmDelete === false) {
        await runDelete();
      } else {
        setConfirmOpen(true);
      }
    } catch {
      setConfirmOpen(true); // default to confirming on IPC failure
    }
  };

  // Persist the opt-out whether the user confirms or cancels (same semantics
  // as the previous native dialog).
  const persistDontAskAgain = async (dontAskAgain: boolean) => {
    if (!dontAskAgain) return;
    try {
      await ipcRenderer.invoke('settings:set', { confirmDelete: false });
    } catch (e) {
      console.error(e);
    }
  };

  const handleConfirmDelete = async (dontAskAgain: boolean) => {
    await persistDontAskAgain(dontAskAgain);
    await runDelete();
  };

  const handleCancelDelete = async (dontAskAgain: boolean) => {
    await persistDontAskAgain(dontAskAgain);
    setConfirmOpen(false);
  };

  // Single-delete confirmation copy (batch uses BatchDeleteModal instead).
  const deleteTitle = isFolder ? 'Delete Folder' : 'Delete File';
  const deleteMessage = isFolder
    ? <>Delete <span className="font-medium text-ink">“{file.name}”</span> and everything inside it? This cannot be undone.</>
    : <>Delete <span className="font-medium text-ink">“{file.name}”</span> from all connected drives? This cannot be undone.</>;

  const handleDownload = async () => {
    for (const target of targets) {
      try {
        const { filePath } = await ipcRenderer.invoke('file:pick-download-path', target.name);
        if (filePath) {
          const res = await ipcRenderer.invoke('file:download', { fileId: target.id, savePath: filePath });
          if (res?.error) toastError(res.error);
        }
      } catch (e: any) {
        toastError(String(e));
      }
    }
    onClose();
  };

  const handleStar = async () => {
    for (const target of targets) {
      try {
        const res = await ipcRenderer.invoke('file:star', { fileId: target.id, starred: !file.is_starred });
        if (res?.error) toastError(res.error);
      } catch (e: any) {
        toastError(String(e));
      }
    }
    onClose();
  };



  // Ensure menu stays within viewport bounds
  let safeX = x;
  let safeY = y;
  
  // Approximate width/height of the context menu
  const menuWidth = 160; 
  const menuHeight = 130;
  
  if (typeof window !== 'undefined') {
    if (x + menuWidth > window.innerWidth) safeX = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) safeY = window.innerHeight - menuHeight - 10;
  }

  return (
    <div
      ref={menuRef}
      style={{ top: safeY, left: safeX }}
      className="fixed z-[10000] min-w-[160px] rounded-lg border border-line bg-surface p-1.5 shadow-xl outline-none select-none flex flex-col gap-0.5"
    >
      {isFolder && onOpen && (
        <button
          onClick={() => { onOpen(); onClose(); }}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-accent/[0.08] hover:text-accent cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
          Open
        </button>
      )}

      {!isFolder && (
        <button
          onClick={handleDownload}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-accent/[0.08] hover:text-accent cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {targets.length > 1 ? `Download ${targets.length} items` : 'Download'}
        </button>
      )}
      
      <button
        onClick={handleStar}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-accent/[0.08] hover:text-accent cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={file.is_starred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={file.is_starred ? "text-amber-400" : ""}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        {targets.length > 1 ? (file.is_starred ? `Remove Star from ${targets.length} items` : `Star ${targets.length} items`) : (file.is_starred ? 'Remove Star' : 'Add Star')}
      </button>
      
      <div className="my-1 h-[1px] w-full bg-line" />

      {/* Rename is single-target only (batch rename doesn't make sense). */}
      {targets.length === 1 && onRename && (
        <button
          onClick={() => { onRename(file); onClose(); }}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-accent/[0.08] hover:text-accent cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          Rename
        </button>
      )}

      <button
        onClick={handleDeleteClick}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        {targets.length > 1 ? `Delete ${targets.length} items` : 'Delete'}
      </button>

      {confirmOpen && !isBatch && (
        <ConfirmDialog
          title={deleteTitle}
          message={deleteMessage}
          confirmLabel="Delete"
          checkboxLabel="Don't ask again"
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}

      {/* Multi-delete re-check — lists every item being removed */}
      {batchOpen && isBatch && (
        <BatchDeleteModal
          items={targets}
          onConfirm={runDelete}
          onCancel={() => setBatchOpen(false)}
        />
      )}
    </div>
  );
};

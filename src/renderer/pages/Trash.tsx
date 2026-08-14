import type React from 'react';
import { useEffect, useState, useCallback } from 'react';
import type { TrashItemRow } from '../../shared/types';
import { FileTypeIcon } from '../components/FileTypeIcon';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { formatBytes } from '../../shared/format';

const { ipcRenderer } = window.require('electron');

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const isUTC = !dateStr.includes('Z') && !dateStr.includes('T');
  const date = new Date(isUTC ? `${dateStr.replace(' ', 'T')}Z` : dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const Trash: React.FC = () => {
  const [items, setItems] = useState<TrashItemRow[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<TrashItemRow | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const { toastError } = useToast();

  const load = useCallback(async () => {
    const res = await ipcRenderer.invoke('trash:list');
    if (res.items) setItems(res.items);
  }, []);

  useEffect(() => {
    load();
    const onChanged = () => load();
    ipcRenderer.on('file:restored', onChanged);
    ipcRenderer.on('file:deleted', onChanged);
    return () => {
      ipcRenderer.removeListener('file:restored', onChanged);
      ipcRenderer.removeListener('file:deleted', onChanged);
    };
  }, [load]);

  const handleRestore = async (file: TrashItemRow) => {
    const res = await ipcRenderer.invoke('file:restore', { fileId: file.id });
    if (res?.error) toastError(res.error);
  };

  const handleDeleteForever = async (file: TrashItemRow) => {
    const res = await ipcRenderer.invoke('file:delete-forever', { fileId: file.id });
    setConfirmDelete(null);
    if (res?.error) toastError(res.error);
  };

  const handleEmptyTrash = async () => {
    const res = await ipcRenderer.invoke('trash:empty');
    setConfirmEmpty(false);
    if (res?.error) toastError(res.error);
  };

  const totalBytes = items.reduce((sum, f) => sum + (f.is_folder === 1 ? 0 : f.size_bytes), 0);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex min-h-[36px] items-center justify-between">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Trash</h1>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button type="button" className="btn-outline" onClick={() => setConfirmEmpty(true)}>
              Empty Trash
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex-1">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr>
              <th className="px-3 py-3 text-[12px] font-semibold text-muted">Name</th>
              <th className="px-3 py-3 text-[12px] font-semibold text-muted">Location</th>
              <th className="px-3 py-3 text-[12px] font-semibold text-muted">Deleted</th>
              <th className="px-3 py-3 text-[12px] font-semibold text-muted">Size</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(file => (
              <tr key={file.id} className="border-b border-line transition-colors duration-100 hover:bg-accent/[0.02]">
                <td className="px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {file.is_folder === 1 ? (
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: 'var(--color-folder-blue)1A' }}>
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-folder-blue)' }}>
                          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                        </svg>
                      </div>
                    ) : (
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: 'var(--color-accent)1A' }}>
                        <FileTypeIcon name={file.name} size={16} />
                      </div>
                    )}
                    <span className="min-w-0 truncate font-medium text-ink">{file.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-muted">
                  {file.parent_path.length > 0 ? `All Files / ${file.parent_path.join(' / ')}` : 'All Files'}
                </td>
                <td className="px-3 py-2.5 text-muted">{formatDate(file.deleted_at)}</td>
                <td className="px-3 py-2.5 text-muted">{file.is_folder === 1 ? '—' : formatBytes(file.size_bytes)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-outline px-3 py-1 text-[12px]" onClick={() => handleRestore(file)}>
                      Restore
                    </button>
                    <button type="button"
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-[12px] font-medium text-red-600 transition-all duration-150 hover:border-red-300 hover:bg-red-100"
                      onClick={() => setConfirmDelete(file)}
                    >
                      Delete Forever
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="p-12 text-center text-[14px] text-muted">Trash is empty.</td>
              </tr>
            )}
          </tbody>
        </table>
        {items.length > 0 && (
          <div className="mt-3 text-[12px] text-muted">
            {items.length} item{items.length === 1 ? '' : 's'} · {formatBytes(totalBytes)} of storage still in use
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={confirmDelete.is_folder === 1 ? 'Delete Folder Forever?' : 'Delete File Forever?'}
          message={<>Permanently delete <span className="font-medium text-ink">“{confirmDelete.name}”</span> from all connected drives? This cannot be undone.</>}
          confirmLabel="Delete Forever"
          onConfirm={() => handleDeleteForever(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmEmpty && (
        <ConfirmDialog
          title="Empty Trash?"
          message={<>Permanently delete all {items.length} item{items.length === 1 ? '' : 's'} in the trash? This cannot be undone.</>}
          confirmLabel="Empty Trash"
          onConfirm={handleEmptyTrash}
          onCancel={() => setConfirmEmpty(false)}
        />
      )}
    </div>
  );
};

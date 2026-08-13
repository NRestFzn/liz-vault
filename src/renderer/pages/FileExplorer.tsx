import type React from 'react';
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { FileRow as FileRowType } from '../../shared/types';
import { FolderCard } from '../components/FolderCard';
import { FolderRow } from '../components/FolderRow';
import { FileRow } from '../components/FileRow';
import { ViewToggle } from '../components/ViewToggle';
import { ContextMenu } from '../components/ContextMenu';
import { RenameModal } from '../components/RenameModal';
import { ThumbnailImage } from '../components/ThumbnailImage';
import { FileTypeIcon } from '../components/FileTypeIcon';
import { TruncatedLabel } from '../components/TruncatedLabel';
import { useToast } from '../components/Toast';
import { AnimatePresence } from 'motion/react';
import { splitFileName } from '../../shared/fileCategory';

const { ipcRenderer, webUtils } = window.require('electron');

interface FileExplorerProps {
  viewMode: 'list' | 'grid';
  onViewModeChange: (mode: 'list' | 'grid') => void;
  folderId: number | null;
  folderName: string | null;
  onFolderChange: (id: number | null, name: string | null) => void;
  highlightFileId: number | null;
  onHighlightHandled: () => void;
}

type SortField = 'name' | 'size_bytes' | 'created_at';
type SortOrder = 'asc' | 'desc';

const FOLDER_CARD_COLORS: Array<'orange' | 'green' | 'blue'> = ['orange', 'green', 'blue'];

const MAX_FOLDER_ROWS = 2;

function estimateFolderColumns(): number {
  if (typeof window === 'undefined') return 3;
  return Math.max(1, Math.floor((window.innerWidth - 296) / 226));
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const isUTC = !dateStr.includes('Z') && !dateStr.includes('T');
  const date = new Date(isUTC ? `${dateStr.replace(' ', 'T')}Z` : dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ viewMode, onViewModeChange, folderId, folderName, onFolderChange, highlightFileId, onHighlightHandled }) => {
  const [items, setItems] = useState<FileRowType[]>([]);
  const [folderPath, setFolderPath] = useState<FileRowType[]>([]);
  const [activeTab, setActiveTab] = useState<'recents' | 'starred'>('recents');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [folderCounts, setFolderCounts] = useState<Record<number, number>>({});
  const [foldersExpanded, setFoldersExpanded] = useState(false);
  const [gridColumns, setGridColumns] = useState(estimateFolderColumns);
  const folderGridRef = useRef<HTMLDivElement>(null);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const folderNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreateFolderOpen) folderNameInputRef.current?.focus();
  }, [isCreateFolderOpen]);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [renameTarget, setRenameTarget] = useState<FileRowType | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const { toastError } = useToast();

  const loadItems = useCallback(async () => {
    const res = await ipcRenderer.invoke('files:in-folder', { folderId });
    if (res.items) setItems(res.items);
  }, [folderId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    setFolderPath([]);
    if (folderId == null) return;
    let cancelled = false;
    ipcRenderer.invoke('folders:path', { folderId }).then((res: { path: FileRowType[] }) => {
      if (cancelled) return;
      if (res.path && res.path.length > 0) {
        setFolderPath(res.path);
      } else {
        onFolderChange(null, null);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [folderId, onFolderChange]);

  useEffect(() => {
    void folderId;
    setFoldersExpanded(false);
    setSelectedFiles(new Set());
  }, [folderId]);

  useEffect(() => {
    const folderIds = items.filter(f => f.is_folder === 1).map(f => f.id);
    if (folderIds.length === 0) {
      setFolderCounts({});
      return;
    }
    ipcRenderer.invoke('folders:item-counts', { folderIds }).then((res: { counts: Record<number, number> }) => {
      if (res.counts) setFolderCounts(res.counts);
    }).catch(() => {});
  }, [items]);

  useEffect(() => {
    const onDeleted = (_event: unknown, data: { fileId: number }) => {
      setItems(prev => prev.filter(f => f.id !== data.fileId));
    };
    const onStarred = (_event: unknown, data: { file: FileRowType }) => {
      setItems(prev => prev.map(f => (f.id === data.file.id ? data.file : f)));
    };
    const onUploadComplete = () => {
      loadItems();
    };
    const onRenamed = (_event: unknown, data: { file: FileRowType }) => {
      setItems(prev => prev.map(f => (f.id === data.file.id ? data.file : f)));
    };

    ipcRenderer.on('file:deleted', onDeleted);
    ipcRenderer.on('file:starred', onStarred);
    ipcRenderer.on('file:renamed', onRenamed);
    ipcRenderer.on('upload:complete', onUploadComplete);

    return () => {
      ipcRenderer.removeListener('file:deleted', onDeleted);
      ipcRenderer.removeListener('file:starred', onStarred);
      ipcRenderer.removeListener('file:renamed', onRenamed);
      ipcRenderer.removeListener('upload:complete', onUploadComplete);
    };
  }, [loadItems]);

  const folders = items.filter(f => f.is_folder === 1);
  const files = items.filter(f => f.is_folder === 0);
  const tabFolders = activeTab === 'starred' ? folders.filter(f => f.is_starred === 1) : folders;

  useEffect(() => {
    void viewMode;
    if (tabFolders.length === 0) return;
    const el = folderGridRef.current;
    if (!el) return;
    const measure = () => {
      const columns = getComputedStyle(el).gridTemplateColumns.split(' ').length;
      setGridColumns(Math.max(1, columns));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tabFolders.length, viewMode]);

  const maxVisibleFolders = gridColumns * MAX_FOLDER_ROWS;
  const visibleFolders = foldersExpanded ? tabFolders : tabFolders.slice(0, maxVisibleFolders);
  const hiddenFolderCount = tabFolders.length - maxVisibleFolders;

  const startUpload = async (filePath: string, fileName: string) => {
    const res = await ipcRenderer.invoke('file:upload', { filePath, fileName, parentFolderId: folderId });
    if (res?.duplicate) {
      toastError(`A file named “${fileName}” already exists here.`);
    } else if (res?.error) {
      toastError(res.error);
    }
  };

  const handleFileUpload = async () => {
    const { filePath, fileName } = await ipcRenderer.invoke('file:pick');
    if (filePath && fileName) {
      startUpload(filePath, fileName);
    }
  };

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file: FileRowType } | null>(null);

  const [flashId, setFlashId] = useState<number | null>(null);

  useEffect(() => {
    if (flashId == null) return;
    const t = setTimeout(() => setFlashId(null), 2600);
    return () => clearTimeout(t);
  }, [flashId]);

  useEffect(() => {
    if (highlightFileId == null) return;
    if (!items.some(f => f.id === highlightFileId)) return;
    setSelectedFiles(new Set([highlightFileId]));
    setFlashId(highlightFileId);
    setActiveTab('recents');
    requestAnimationFrame(() => {
      const el =
        document.getElementById(`file-row-${highlightFileId}`) ??
        document.getElementById(`file-card-${highlightFileId}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    onHighlightHandled();
  }, [items, highlightFileId, onHighlightHandled]);

  useEffect(() => {
    if (highlightFileId == null) return;
    const t = setTimeout(onHighlightHandled, 3000);
    return () => clearTimeout(t);
  }, [highlightFileId, onHighlightHandled]);

  const handleContextMenu = (e: React.MouseEvent, file: FileRowType) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  const toggleFolderSelect = (folder: FileRowType, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newSet = new Set(selectedFiles);
    if (newSet.has(folder.id)) newSet.delete(folder.id);
    else newSet.add(folder.id);
    setSelectedFiles(newSet);
  };

  const handleFolderClick = (folder: FileRowType, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) toggleFolderSelect(folder);
    else onFolderChange(folder.id, folder.name);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (const file of Array.from(e.dataTransfer.files)) {
        const filePath = webUtils.getPathForFile(file);
        if (filePath) startUpload(filePath, file.name);
      }
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const res = await ipcRenderer.invoke('folder:create', {
        name: newFolderName,
        parentFolderId: folderId
      });
      if (res.duplicate) {
        setIsCreateFolderOpen(false);
        toastError(`A folder named “${newFolderName.trim()}” already exists here.`);
        setNewFolderName('');
        return;
      }
      if (res.error) {
        toastError(res.error);
        return;
      }
      if (res.folder) {
        setItems(prev => [res.folder, ...prev]);
      }
      setIsCreateFolderOpen(false);
      setNewFolderName('');
    } catch (e) {
      toastError(String(e));
    }
  };

  const handleRenameConfirm = async (newName: string) => {
    if (!renameTarget) return;
    const res = await ipcRenderer.invoke('file:rename', { fileId: renameTarget.id, newName });
    if (res?.error) {
      const kind = renameTarget.is_folder === 1 ? 'folder' : 'file';
      setRenameError(res.duplicate ? `A ${kind} named “${newName}” already exists here.` : res.error);
      return;
    }
    setRenameTarget(null);
    setRenameError(null);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder(field === 'name' ? 'asc' : 'desc');
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return '';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  const filteredAndSortedFiles = useMemo(() => {
    let result = files;

    if (activeTab === 'starred') {
      result = result.filter(f => f.is_starred === 1);
    }

    return [...result].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (sortField === 'created_at') {
        aVal = a.updated_at || a.created_at;
        bVal = b.updated_at || b.created_at;
      }

      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [files, activeTab, sortField, sortOrder]);

  const visibleItems = useMemo(
    () => [...tabFolders, ...filteredAndSortedFiles],
    [tabFolders, filteredAndSortedFiles]
  );

  return (
    <fieldset onDragOver={handleDragOver} onDrop={handleDrop} className="m-0 flex h-full min-w-0 flex-col border-0 p-0">

      <div className="mb-6 flex min-h-[36px] flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-[20px] font-bold tracking-tight text-ink">
          <span className="inline-flex max-w-full items-center gap-1.5">
            <button type="button"
              className="inline-flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 text-muted transition-colors duration-100 hover:text-accent"
              onClick={() => onFolderChange(null, null)}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              All Files
            </button>
            {folderPath.length === 0 && folderName && (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="text-muted">/</span>
                <span className="truncate text-ink">{folderName}</span>
              </span>
            )}
            {folderPath.map((folder, i) => {
              const isCurrent = i === folderPath.length - 1;
              return (
                <span key={folder.id} className="flex min-w-0 items-center gap-1.5">
                  <span className="text-muted">/</span>
                  {isCurrent ? (
                    <span className="truncate text-ink">{folder.name}</span>
                  ) : (
                    <button type="button"
                      className="max-w-[180px] cursor-pointer truncate border-0 bg-transparent p-0 text-muted transition-colors duration-100 hover:text-accent"
                      onClick={() => onFolderChange(folder.id, folder.name)}
                    >
                      {folder.name}
                    </button>
                  )}
                </span>
              );
            })}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          <ViewToggle viewMode={viewMode} onViewChange={onViewModeChange} />
          <button type="button" className="btn-outline" onClick={handleFileUpload}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload
          </button>
          <button type="button" className="btn-outline" onClick={() => setIsCreateFolderOpen(true)}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg> New Folder
          </button>
        </div>
      </div>

      <div className="mb-4 flex min-h-[44px] items-center gap-2">
        <button type="button"
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150 ${
            activeTab === 'recents'
              ? 'border-accent bg-accent text-white'
              : 'border-line bg-panel text-muted hover:border-accent hover:text-accent'
          }`}
          onClick={() => setActiveTab('recents')}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Recents
        </button>
        <button type="button"
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150 ${
            activeTab === 'starred'
              ? 'border-accent bg-accent text-white'
              : 'border-line bg-panel text-muted hover:border-accent hover:text-accent'
          }`}
          onClick={() => setActiveTab('starred')}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Starred
        </button>
      </div>

      {viewMode === 'grid' && tabFolders.length > 0 && (
        <>
          <div
            ref={folderGridRef}
            className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4"
          >
            {visibleFolders.map((folder, i) => (
              <FolderCard
                key={folder.id}
                name={folder.name}
                updated={formatDate(folder.updated_at || folder.created_at)}
                color={FOLDER_CARD_COLORS[i % FOLDER_CARD_COLORS.length]}
                itemCount={folderCounts[folder.id] ?? 0}
                isStarred={folder.is_starred === 1}
                isSelected={selectedFiles.has(folder.id)}
                onClick={(e) => handleFolderClick(folder, e)}
                onSelect={(e) => toggleFolderSelect(folder, e)}
                onContextMenu={(e) => handleContextMenu(e, folder)}
              />
            ))}
          </div>

          {hiddenFolderCount > 0 && (
            <div className="-mt-2 mb-5 flex justify-center">
              <button type="button"
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-4 py-1.5 text-[12px] font-medium text-muted transition-all duration-150 hover:border-accent hover:text-accent"
                onClick={() => setFoldersExpanded(v => !v)}
              >
                <svg aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform duration-200 ${foldersExpanded ? 'rotate-180' : ''}`}
                >
                  <path d="m6 9 6 6 6-6"/>
                </svg>
                {foldersExpanded
                  ? 'Show fewer'
                  : `Show ${hiddenFolderCount} more folder${hiddenFolderCount === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </>
      )}

      {}
      <div className="mt-2 flex-1">
        {viewMode === 'grid' && tabFolders.length > 0 && filteredAndSortedFiles.length > 0 && (
          <div className="-mt-2 mb-5 border-t border-line" />
        )}
        {viewMode === 'list' ? (
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr>
                <th className="w-9 cursor-pointer py-3 pl-1 pr-3 text-[12px] font-semibold text-muted">
                  <input 
                    type="checkbox" 
                    className="h-4 w-4 cursor-pointer rounded border-[1.5px] border-line accent-accent" 
                    checked={visibleItems.length > 0 && visibleItems.every(f => selectedFiles.has(f.id))}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedFiles.size > 0 && !visibleItems.every(f => selectedFiles.has(f.id));
                    }}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFiles(new Set(visibleItems.map(f => f.id)));
                      } else {
                        setSelectedFiles(new Set());
                      }
                    }}
                  />
                </th>
                <th className="cursor-pointer px-3 py-3 text-[12px] font-semibold text-muted transition-colors duration-100 hover:text-ink" onClick={() => handleSort('name')}>Name{sortIndicator('name')}</th>
                <th className="cursor-pointer px-3 py-3 text-[12px] font-semibold text-muted transition-colors duration-100 hover:text-ink" onClick={() => handleSort('created_at')}>Last Modified{sortIndicator('created_at')}</th>
                <th className="cursor-pointer px-3 py-3 text-[12px] font-semibold text-muted transition-colors duration-100 hover:text-ink" onClick={() => handleSort('size_bytes')}>Size{sortIndicator('size_bytes')}</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {tabFolders.map(folder => (
                <FolderRow
                  key={folder.id}
                  name={folder.name}
                  updated={formatDate(folder.updated_at || folder.created_at)}
                  itemCount={folderCounts[folder.id] ?? 0}
                  isStarred={folder.is_starred === 1}
                  isSelected={selectedFiles.has(folder.id)}
                  onSelect={(checked) => {
                    const newSet = new Set(selectedFiles);
                    if (checked) newSet.add(folder.id);
                    else newSet.delete(folder.id);
                    setSelectedFiles(newSet);
                  }}
                  onClick={(e) => handleFolderClick(folder, e)}
                  onContextMenu={(e) => handleContextMenu(e, folder)}
                />
              ))}
              {tabFolders.length > 0 && filteredAndSortedFiles.length > 0 && (
                <tr className="bg-surface/60">
                  <td colSpan={5} className="h-3 p-0" />
                </tr>
              )}
              {filteredAndSortedFiles.map(file => (
              <FileRow 
                  key={file.id} 
                  file={file} 
                  isSelected={selectedFiles.has(file.id)}
                  isHighlighted={flashId === file.id}
                  onSelect={(checked) => {
                    const newSet = new Set(selectedFiles);
                    if (checked) newSet.add(file.id);
                    else newSet.delete(file.id);
                    setSelectedFiles(newSet);
                  }}
                  onContextMenu={handleContextMenu} 
                />
              ))}
              {tabFolders.length === 0 && filteredAndSortedFiles.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-[14px] text-muted">
                    {folderName 
                      ? 'This folder is empty.' 
                      : activeTab === 'starred'
                        ? 'No starred files yet. Right-click a file or folder and choose "Star".'
                        : 'No files found. Drag & drop or click Upload to add files.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
            {filteredAndSortedFiles.map(file => (
              <button type="button"
                key={file.id}
                id={`file-card-${file.id}`}
                className={`group relative flex cursor-pointer flex-col rounded-xl border p-0 text-left transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] ${
                  flashId === file.id ? 'border-accent bg-accent-soft shadow-[0_0_0_3px_rgba(51,102,255,0.15)]' : selectedFiles.has(file.id) ? 'border-accent bg-accent-soft' : 'border-line bg-panel hover:border-[#d1d5db]'
                }`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    const newSet = new Set(selectedFiles);
                    if (newSet.has(file.id)) newSet.delete(file.id);
                    else newSet.add(file.id);
                    setSelectedFiles(newSet);
                  } else {
                    setSelectedFiles(new Set([file.id]));
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, file)}
              >
                <div className={`flex h-[130px] w-full items-center justify-center overflow-hidden rounded-t-[11px] transition-colors duration-200 ${selectedFiles.has(file.id) ? 'bg-transparent' : 'bg-panel'}`}>
                  <ThumbnailImage file={file} iconSize={48} />
                </div>
                
                <div className={`flex items-center justify-between rounded-b-[11px] border-t p-3 ${selectedFiles.has(file.id) ? 'border-accent/20' : 'border-line'}`}>
                  <div className="flex min-w-0 items-center gap-2">
                    <FileTypeIcon name={file.name} size={16} />
                    <TruncatedLabel text={file.name} className="text-[13px] font-medium text-ink" maxWidthClass="max-w-[200px]" />
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5 pl-2">
                    {file.is_starred === 1 && (
                      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            ))}
            {tabFolders.length === 0 && filteredAndSortedFiles.length === 0 && (
              <div className="col-span-full p-12 text-center text-[14px] text-muted">
                {folderName 
                  ? 'This folder is empty.' 
                  : activeTab === 'starred'
                    ? 'No starred files yet. Right-click a file or folder and choose "Star".'
                    : 'No files found. Drag & drop or click Upload to add files.'}
              </div>
            )}
          </div>
        )}
      </div>

      {isCreateFolderOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
          <div className="w-[400px] max-w-[90vw] rounded-xl border border-line bg-panel p-6 shadow-[0_10px_30px_rgba(0,0,0,0.1)]">
            <h3 className="mb-4 text-[18px] font-semibold">Create New Folder</h3>
            <input
              ref={folderNameInputRef}
              type="text"
              className="mb-6 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[13px] text-ink transition-colors duration-150 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_rgba(51,102,255,0.08)]"
              placeholder="Folder Name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); }}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-outline" onClick={() => setIsCreateFolderOpen(false)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={handleCreateFolder}>Create Folder</button>
            </div>
          </div>
        </div>
      )}
      <AnimatePresence>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            file={contextMenu.file}
            selectedFiles={selectedFiles.has(contextMenu.file.id) ? visibleItems.filter(f => selectedFiles.has(f.id)) : undefined}
            onOpen={contextMenu.file.is_folder === 1 ? () => onFolderChange(contextMenu.file.id, contextMenu.file.name) : undefined}
            onRename={(f) => { setRenameTarget(f); setRenameError(null); }}
            onClose={() => setContextMenu(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {renameTarget && (
          <RenameModal
            title={renameTarget.is_folder === 1 ? 'Rename Folder' : 'Rename File'}
            initialName={renameTarget.is_folder === 1 ? renameTarget.name : splitFileName(renameTarget.name).base}
            suffix={renameTarget.is_folder === 1 ? '' : splitFileName(renameTarget.name).ext}
            error={renameError}
            onConfirm={handleRenameConfirm}
            onCancel={() => { setRenameTarget(null); setRenameError(null); }}
          />
        )}
      </AnimatePresence>
    </fieldset>
  );
};

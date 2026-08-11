import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { FileRow as FileRowType } from '../../shared/types';
import { FolderCard } from '../components/FolderCard';
import { FolderRow } from '../components/FolderRow';
import { FileRow } from '../components/FileRow';
import { ViewToggle } from '../components/ViewToggle';
import { ContextMenu } from '../components/ContextMenu';
import { RenameModal } from '../components/RenameModal';
import { ThumbnailImage } from '../components/ThumbnailImage';
import { FileTypeIcon } from '../components/FileTypeIcon';
import { splitFileName } from '../../shared/fileCategory';

const { ipcRenderer } = window.require('electron');

interface FileExplorerProps {
  viewMode: 'list' | 'grid';
  onViewModeChange: (mode: 'list' | 'grid') => void;
  // Controlled folder navigation (lifted to App so global search can drive it).
  folderId: number | null;
  folderName: string | null;
  onFolderChange: (id: number | null, name: string | null) => void;
  // External request to highlight a specific file (from global search).
  highlightFileId: number | null;
  onHighlightHandled: () => void;
}

type SortField = 'name' | 'size_bytes' | 'created_at';
type SortOrder = 'asc' | 'desc';

const FOLDER_CARD_COLORS: Array<'orange' | 'green' | 'blue'> = ['orange', 'green', 'blue'];

// Folder grid collapse — cap the cards at 2 rows with a show-more toggle.
const MAX_FOLDER_ROWS = 2;

// Rough first-paint guess for the main pane (window - 240px sidebar - px-7 padding).
function estimateFolderColumns(): number {
  if (typeof window === 'undefined') return 3;
  return Math.max(1, Math.floor((window.innerWidth - 296) / 226));
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const isUTC = !dateStr.includes('Z') && !dateStr.includes('T');
  const date = new Date(isUTC ? dateStr.replace(' ', 'T') + 'Z' : dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ viewMode, onViewModeChange, folderId, folderName, onFolderChange, highlightFileId, onHighlightHandled }) => {
  const [items, setItems] = useState<FileRowType[]>([]);
  // Ancestor chain for the breadcrumb, root → current folder.
  const [folderPath, setFolderPath] = useState<FileRowType[]>([]);
  const [activeTab, setActiveTab] = useState<'recents' | 'starred'>('recents');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [folderCounts, setFolderCounts] = useState<Record<number, number>>({});
  const [foldersExpanded, setFoldersExpanded] = useState(false);
  const [gridColumns, setGridColumns] = useState(estimateFolderColumns);
  const folderGridRef = useRef<HTMLDivElement>(null);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [renameTarget, setRenameTarget] = useState<FileRowType | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  // Duplicate-name warning (shown when the auto-rename setting is off).
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    const res = await ipcRenderer.invoke('files:in-folder', { folderId });
    if (res.items) setItems(res.items);
  }, [folderId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Resolve the full ancestor chain whenever navigation changes.
  useEffect(() => {
    setFolderPath([]); // drop the stale chain immediately
    if (folderId == null) return;
    let cancelled = false;
    ipcRenderer.invoke('folders:path', { folderId }).then((res: { path: FileRowType[] }) => {
      if (cancelled) return;
      if (res.path && res.path.length > 0) {
        setFolderPath(res.path);
      } else {
        // Folder was deleted while we were inside it — bail to the root.
        onFolderChange(null, null);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [folderId, onFolderChange]);

  // Collapse the folder grid again whenever the user navigates.
  useEffect(() => {
    setFoldersExpanded(false);
  }, [folderId]);

  // Fetch per-folder child counts (files + subfolders) for the folder cards.
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
    const onDeleted = (_: any, data: { fileId: number }) => {
      setItems(prev => prev.filter(f => f.id !== data.fileId));
    };
    const onStarred = (_: any, data: { file: FileRowType }) => {
      setItems(prev => prev.map(f => (f.id === data.file.id ? data.file : f)));
    };
    const onUploadComplete = () => {
      loadItems();
    };
    const onRenamed = (_: any, data: { file: FileRowType }) => {
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
  // The Starred tab shows starred folders AND files.
  const tabFolders = activeTab === 'starred' ? folders.filter(f => f.is_starred === 1) : folders;

  // Measure how many folder cards fit per row so the grid can be capped at
  // MAX_FOLDER_ROWS. Re-attach whenever the grid mounts (folders appear, or
  // the user switches back to grid view from list view).
  useEffect(() => {
    if (tabFolders.length === 0) return;
    const el = folderGridRef.current;
    if (!el) return;
    // Read the real resolved track count straight from CSS — no duplicated constants.
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
      setDuplicateWarning(`A file named “${fileName}” already exists here.`);
    }
  };

  const handleFileUpload = async () => {
    const { filePath, fileName } = await ipcRenderer.invoke('file:pick');
    if (filePath && fileName) {
      startUpload(filePath, fileName);
    }
  };

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file: FileRowType } | null>(null);

  // Temporary flash highlight for a file arrived at via global search.
  const [flashId, setFlashId] = useState<number | null>(null);

  useEffect(() => {
    if (flashId == null) return;
    const t = setTimeout(() => setFlashId(null), 2600);
    return () => clearTimeout(t);
  }, [flashId]);

  // Global search “navigate & highlight”: wait until the target folder's items
  // have loaded, then select + scroll to + flash the file row/card.
  useEffect(() => {
    if (highlightFileId == null) return;
    if (!items.some(f => f.id === highlightFileId)) return; // items not loaded yet
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

  // Fallback: if the target never appears (deleted/moved, or the folder load
  // failed), clear the pending highlight so it can't fire later by accident.
  useEffect(() => {
    if (highlightFileId == null) return;
    const t = setTimeout(onHighlightHandled, 3000);
    return () => clearTimeout(t);
  }, [highlightFileId, onHighlightHandled]);

  const handleContextMenu = (e: React.MouseEvent, file: FileRowType) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const filePath = (file as any).path;
      startUpload(filePath, file.name);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const res = await ipcRenderer.invoke('folder:create', {
      name: newFolderName,
      parentFolderId: folderId
    });
    if (res.duplicate) {
      setIsCreateFolderOpen(false);
      setDuplicateWarning(`A folder named “${newFolderName.trim()}” already exists here.`);
      setNewFolderName('');
      return;
    }
    if (res.folder) {
      setItems(prev => [res.folder, ...prev]);
    }
    setIsCreateFolderOpen(false);
    setNewFolderName('');
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
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

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

  return (
    <div onDragOver={handleDragOver} onDrop={handleDrop} className="flex h-full flex-col">

      {/* Page header — wraps when the window is narrow */}
      <div className="mb-6 flex min-h-[36px] flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-[20px] font-bold tracking-tight text-ink">
          {/* Breadcrumb — full folder path with clickable segments */}
          <span className="inline-flex max-w-full items-center gap-1.5">
            <span
              className="inline-flex cursor-pointer items-center gap-1 rounded text-muted transition-colors duration-100 hover:text-accent"
              onClick={() => onFolderChange(null, null)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              All Files
            </span>
            {/* While the full chain loads, show the current folder from folderName */}
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
                    <span
                      className="max-w-[180px] cursor-pointer truncate text-muted transition-colors duration-100 hover:text-accent"
                      onClick={() => onFolderChange(folder.id, folder.name)}
                    >
                      {folder.name}
                    </span>
                  )}
                </span>
              );
            })}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          <ViewToggle viewMode={viewMode} onViewChange={onViewModeChange} />
          <button className="btn-outline" onClick={handleFileUpload}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload
          </button>
          <button className="btn-outline" onClick={() => setIsCreateFolderOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg> New Folder
          </button>
        </div>
      </div>

      {/* Tab bar — sits above folders AND files so both are filtered */}
      <div className="mb-4 flex min-h-[44px] items-center gap-2">
        <button
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150 ${
            activeTab === 'recents'
              ? 'border-accent bg-accent text-white'
              : 'border-line bg-panel text-muted hover:border-accent hover:text-accent'
          }`}
          onClick={() => setActiveTab('recents')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Recents
        </button>
        <button
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150 ${
            activeTab === 'starred'
              ? 'border-accent bg-accent text-white'
              : 'border-line bg-panel text-muted hover:border-accent hover:text-accent'
          }`}
          onClick={() => setActiveTab('starred')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Starred
        </button>
      </div>

      {/* Folder cards (grid view only) — filtered by the active tab, capped at MAX_FOLDER_ROWS rows with a show-more toggle */}
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
                onClick={() => onFolderChange(folder.id, folder.name)}
                onContextMenu={(e) => handleContextMenu(e, folder)}
              />
            ))}
          </div>

          {hiddenFolderCount > 0 && (
            <div className="-mt-2 mb-5 flex justify-center">
              <button
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-4 py-1.5 text-[12px] font-medium text-muted transition-all duration-150 hover:border-accent hover:text-accent"
                onClick={() => setFoldersExpanded(v => !v)}
              >
                <svg
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

      {/* File list */}
      <div className="mt-2 flex-1">
        {/* Section divider between folders and files (only when both sections have content) */}
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
                    checked={filteredAndSortedFiles.length > 0 && selectedFiles.size === filteredAndSortedFiles.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFiles(new Set(filteredAndSortedFiles.map(f => f.id)));
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
              {/* Folders first as rows when in list view */}
              {tabFolders.map(folder => (
                <FolderRow
                  key={folder.id}
                  name={folder.name}
                  updated={formatDate(folder.updated_at || folder.created_at)}
                  itemCount={folderCounts[folder.id] ?? 0}
                  isStarred={folder.is_starred === 1}
                  onClick={() => onFolderChange(folder.id, folder.name)}
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
              <div
                key={file.id}
                id={`file-card-${file.id}`}
                className={`group relative flex cursor-pointer flex-col rounded-xl border transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] ${
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
                {/* Preview Area */}
                <div className={`flex h-[130px] w-full items-center justify-center overflow-hidden rounded-t-[11px] transition-colors duration-200 ${selectedFiles.has(file.id) ? 'bg-transparent' : 'bg-panel'}`}>
                  <ThumbnailImage file={file} iconSize={48} />
                </div>
                
                {/* Info Area */}
                <div className={`flex items-center justify-between rounded-b-[11px] border-t p-3 ${selectedFiles.has(file.id) ? 'border-accent/20' : 'border-line'}`}>
                  <div className="group/tooltip relative flex min-w-0 items-center gap-2">
                    <FileTypeIcon name={file.name} size={16} />
                    <span className="truncate text-[13px] font-medium text-ink">
                      {file.name}
                    </span>
                    {/* Custom Tooltip */}
                    <div className="pointer-events-none absolute left-6 top-full z-[100] mt-1.5 invisible w-max max-w-[200px] -translate-y-1 break-words rounded bg-[#333] px-2.5 py-1.5 text-[12px] font-medium leading-relaxed text-white opacity-0 shadow-lg transition-all delay-300 group-hover/tooltip:visible group-hover/tooltip:translate-y-0 group-hover/tooltip:opacity-100">
                      {file.name}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5 pl-2">
                    {file.is_starred === 1 && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                      </svg>
                    )}
                  </div>
                </div>
              </div>
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

      {/* Create Folder Modal */}
      {isCreateFolderOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
          <div className="w-[400px] max-w-[90vw] rounded-xl border border-line bg-panel p-6 shadow-[0_10px_30px_rgba(0,0,0,0.1)]">
            <h3 className="mb-4 text-[18px] font-semibold">Create New Folder</h3>
            <input
              type="text"
              className="mb-6 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[13px] text-ink transition-colors duration-150 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_rgba(51,102,255,0.08)]"
              placeholder="Folder Name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setIsCreateFolderOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateFolder}>Create Folder</button>
            </div>
          </div>
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          selectedFiles={selectedFiles.has(contextMenu.file.id) ? filteredAndSortedFiles.filter(f => selectedFiles.has(f.id)) : undefined}
          onOpen={contextMenu.file.is_folder === 1 ? () => onFolderChange(contextMenu.file.id, contextMenu.file.name) : undefined}
          onRename={(f) => { setRenameTarget(f); setRenameError(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Rename modal */}
      {renameTarget && (
        <RenameModal
          title={renameTarget.is_folder === 1 ? 'Rename Folder' : 'Rename File'}
          // Files: base name editable, extension preserved as a muted suffix.
          // Folders: the whole name is the base ("my.folder" stays intact).
          initialName={renameTarget.is_folder === 1 ? renameTarget.name : splitFileName(renameTarget.name).base}
          suffix={renameTarget.is_folder === 1 ? '' : splitFileName(renameTarget.name).ext}
          error={renameError}
          onConfirm={handleRenameConfirm}
          onCancel={() => { setRenameTarget(null); setRenameError(null); }}
        />
      )}

      {/* Duplicate-name warning (shown when the auto-rename setting is off) */}
      {duplicateWarning && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
          <div className="w-[400px] max-w-[90vw] rounded-xl border border-line bg-panel p-6 shadow-[0_10px_30px_rgba(0,0,0,0.1)]">
            <h3 className="mb-4 text-[18px] font-semibold text-ink">Already Exists</h3>
            <div className="mb-6 text-[13px] leading-relaxed text-muted">{duplicateWarning}</div>
            <div className="flex justify-end gap-2">
              <button className="btn-primary" onClick={() => setDuplicateWarning(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

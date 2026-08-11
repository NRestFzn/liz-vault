import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { FileRow as FileRowType } from '../../shared/types';
import { FileRow } from '../components/FileRow';
import { FolderRow } from '../components/FolderRow';
import { FolderCard } from '../components/FolderCard';
import { ViewToggle } from '../components/ViewToggle';
import { ContextMenu } from '../components/ContextMenu';
import { ThumbnailImage } from '../components/ThumbnailImage';
import { FileTypeIcon } from '../components/FileTypeIcon';

const FOLDER_CARD_COLORS: Array<'orange' | 'green' | 'blue'> = ['orange', 'green', 'blue'];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const isUTC = !dateStr.includes('Z') && !dateStr.includes('T');
  const date = new Date(isUTC ? dateStr.replace(' ', 'T') + 'Z' : dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const { ipcRenderer } = window.require('electron');

interface StarredProps {
  viewMode: 'list' | 'grid';
  onViewModeChange: (mode: 'list' | 'grid') => void;
}

type SortField = 'name' | 'size_bytes' | 'created_at';
type SortOrder = 'asc' | 'desc';

export const Starred: React.FC<StarredProps> = ({ viewMode, onViewModeChange }) => {
  const [files, setFiles] = useState<FileRowType[]>([]);
  const [folderCounts, setFolderCounts] = useState<Record<number, number>>({});
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file: FileRowType } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());

  const loadFiles = useCallback(async () => {
    const res = await ipcRenderer.invoke('files:starred');
    if (res.files) setFiles(res.files);
  }, []);

  useEffect(() => {
    loadFiles();

    const onDeleted = (_: any, data: { fileId: number }) => {
      setFiles(prev => prev.filter(f => f.id !== data.fileId));
    };
    const onStarred = (_: any, data: { file: FileRowType }) => {
      setFiles(prev =>
        data.file.is_starred === 1
          ? prev.some(f => f.id === data.file.id) ? prev : [data.file, ...prev]
          : prev.filter(f => f.id !== data.file.id)
      );
    };

    ipcRenderer.on('file:deleted', onDeleted);
    ipcRenderer.on('file:starred', onStarred);

    return () => {
      ipcRenderer.removeListener('file:deleted', onDeleted);
      ipcRenderer.removeListener('file:starred', onStarred);
    };
  }, [loadFiles]);

  // Fetch child counts for starred folders (shown in list rows / grid cards).
  useEffect(() => {
    const folderIds = files.filter(f => f.is_folder === 1).map(f => f.id);
    if (folderIds.length === 0) {
      setFolderCounts({});
      return;
    }
    ipcRenderer.invoke('folders:item-counts', { folderIds }).then((res: { counts: Record<number, number> }) => {
      if (res.counts) setFolderCounts(res.counts);
    }).catch(() => {});
  }, [files]);

  const handleContextMenu = (e: React.MouseEvent, file: FileRowType) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
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

  const folders = files.filter(f => f.is_folder === 1);
  const fileItems = files.filter(f => f.is_folder === 0);

  const filteredAndSortedFiles = useMemo(() => {
    let result = fileItems;

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
  }, [fileItems, sortField, sortOrder]);

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="mb-6 flex min-h-[36px] items-center justify-between">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Starred</h1>
        <ViewToggle viewMode={viewMode} onViewChange={onViewModeChange} />
      </div>

      {/* Starred folders sit on the surface (outside the panel) when in grid view */}
      {viewMode === 'grid' && folders.length > 0 && (
        <>
          <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
            {folders.map((folder, i) => (
              <FolderCard
                key={folder.id}
                name={folder.name}
                updated={formatDate(folder.updated_at || folder.created_at)}
                color={FOLDER_CARD_COLORS[i % FOLDER_CARD_COLORS.length]}
                itemCount={folderCounts[folder.id] ?? 0}
                isStarred
                onContextMenu={(e) => handleContextMenu(e, folder)}
              />
            ))}
          </div>
          {/* Section divider between folders and files (only when both sections have content) */}
          {filteredAndSortedFiles.length > 0 && (
            <div className="mb-3 border-t border-line" />
          )}
        </>
      )}

      {/* File list */}
      <div className="mt-2 flex-1">
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
              {/* Starred folders first as rows */}
              {folders.map(folder => (
                <FolderRow
                  key={folder.id}
                  name={folder.name}
                  updated={formatDate(folder.updated_at || folder.created_at)}
                  itemCount={folderCounts[folder.id] ?? 0}
                  isStarred
                  onContextMenu={(e) => handleContextMenu(e, folder)}
                />
              ))}
              {folders.length > 0 && filteredAndSortedFiles.length > 0 && (
                <tr className="bg-surface/60">
                  <td colSpan={5} className="h-3 p-0" />
                </tr>
              )}
              {filteredAndSortedFiles.map(file => (
                <FileRow 
                  key={file.id} 
                  file={file} 
                  isSelected={selectedFiles.has(file.id)}
                  onSelect={(checked) => {
                    const newSet = new Set(selectedFiles);
                    if (checked) newSet.add(file.id);
                    else newSet.delete(file.id);
                    setSelectedFiles(newSet);
                  }}
                  onContextMenu={handleContextMenu} 
                />
              ))}
              {folders.length === 0 && filteredAndSortedFiles.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-[14px] text-muted">No starred items yet. Right-click a file or folder and choose "Star".</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
            {filteredAndSortedFiles.map(file => (
              <div
                key={file.id}
                className={`group relative flex cursor-pointer flex-col rounded-xl border transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] ${
                  selectedFiles.has(file.id) ? 'border-accent bg-accent-soft' : 'border-line bg-panel hover:border-[#d1d5db]'
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
            {folders.length === 0 && filteredAndSortedFiles.length === 0 && (
              <div className="col-span-full p-12 text-center text-[14px] text-muted">No starred items yet. Right-click a file or folder and choose "Star".</div>
            )}
          </div>
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          selectedFiles={selectedFiles.has(contextMenu.file.id) ? filteredAndSortedFiles.filter(f => selectedFiles.has(f.id)) : undefined}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

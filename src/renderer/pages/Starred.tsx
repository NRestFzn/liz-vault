import React, { useEffect, useState, useMemo } from 'react';
import { FileRow as FileRowType } from '../../shared/types';
import { FileRow } from '../components/FileRow';
import { ViewToggle } from '../components/ViewToggle';

const { ipcRenderer } = window.require('electron');

interface StarredProps {
  searchQuery: string;
}

type SortField = 'name' | 'size_bytes' | 'created_at';
type SortOrder = 'asc' | 'desc';

export const Starred: React.FC<StarredProps> = ({ searchQuery }) => {
  const [files, setFiles] = useState<FileRowType[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const loadFiles = async () => {
    const res = await ipcRenderer.invoke('files:list');
    if (res.files) {
      // TODO: Filter by starred status once added to backend DB schema
      // For UI preview, we just show all files or we could show empty
      setFiles(res.files);
    }
  };

  useEffect(() => {
    loadFiles();

    const onDeleted = (_: any, data: { fileId: number }) => {
      setFiles(prev => prev.filter(f => f.id !== data.fileId));
    };

    ipcRenderer.on('file:deleted', onDeleted);

    return () => {
      ipcRenderer.removeListener('file:deleted', onDeleted);
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent, file: FileRowType) => {
    e.preventDefault();
    ipcRenderer.send('show-context-menu', file.id);
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

    if (searchQuery) {
      result = result.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
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
  }, [files, searchQuery, sortField, sortOrder]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Page header */}
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <h1 className="page-title">Starred</h1>
        <div className="page-actions">
          <ViewToggle viewMode={viewMode} onViewChange={setViewMode} />
        </div>
      </div>

      {/* File list */}
      <div style={{ flex: 1, marginTop: '8px' }}>
        {viewMode === 'list' ? (
          <table className="file-table">
            <thead>
              <tr>
                <th><input type="checkbox" className="file-table-checkbox" /></th>
                <th onClick={() => handleSort('name')}>Name{sortIndicator('name')}</th>
                <th onClick={() => handleSort('created_at')}>Last Modified{sortIndicator('created_at')}</th>
                <th onClick={() => handleSort('size_bytes')}>Size{sortIndicator('size_bytes')}</th>
                <th>Access</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedFiles.map(file => (
                <FileRow key={file.id} file={file} onContextMenu={handleContextMenu} />
              ))}
              {filteredAndSortedFiles.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">No starred files yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className="file-grid">
            {filteredAndSortedFiles.map(file => (
              <div
                key={file.id}
                className="file-grid-card"
                onContextMenu={(e) => handleContextMenu(e, file)}
              >
                <div className="file-grid-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                </div>
                <div className="file-grid-name">{file.name}</div>
                <div className="file-grid-size">
                  {(file.size_bytes / (1024 * 1024)).toFixed(2)} MB
                </div>
              </div>
            ))}
            {filteredAndSortedFiles.length === 0 && (
              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>No starred files yet.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

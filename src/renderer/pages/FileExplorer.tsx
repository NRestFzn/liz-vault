import React, { useEffect, useState, useMemo } from 'react';
import { FileRow as FileRowType } from '../../shared/types';
import { FolderCard } from '../components/FolderCard';
import { FileRow } from '../components/FileRow';
import { ViewToggle } from '../components/ViewToggle';

const { ipcRenderer } = window.require('electron');

interface FileExplorerProps {
  searchQuery: string;
}

type SortField = 'name' | 'size_bytes' | 'created_at';
type SortOrder = 'asc' | 'desc';

export const FileExplorer: React.FC<FileExplorerProps> = ({ searchQuery }) => {
  const [files, setFiles] = useState<FileRowType[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [activeTab, setActiveTab] = useState<'recents' | 'starred'>('recents');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const loadFiles = async () => {
    const res = await ipcRenderer.invoke('files:list');
    if (res.files) setFiles(res.files);
  };

  useEffect(() => {
    loadFiles();

    const onDeleted = (_: any, data: { fileId: number }) => {
      setFiles(prev => prev.filter(f => f.id !== data.fileId));
    };
    const onUploadComplete = (_: any, data: { fileId: number, file: FileRowType }) => {
      setFiles(prev => [data.file, ...prev]);
    };

    ipcRenderer.on('file:deleted', onDeleted);
    ipcRenderer.on('upload:complete', onUploadComplete);

    return () => {
      ipcRenderer.removeListener('file:deleted', onDeleted);
      ipcRenderer.removeListener('upload:complete', onUploadComplete);
    };
  }, []);

  const handleUploadClick = () => {
    document.getElementById('fileUploadInput')?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const filePath = (file as any).path;
      ipcRenderer.invoke('file:upload', { filePath, fileName: file.name });
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file: FileRowType) => {
    e.preventDefault();
    ipcRenderer.send('show-context-menu', file.id);
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
      ipcRenderer.invoke('file:upload', { filePath, fileName: file.name });
    }
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
    <div onDragOver={handleDragOver} onDrop={handleDrop} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <input type="file" id="fileUploadInput" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">
          {currentFolder ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => setCurrentFolder(null)}>
              <span style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                All Files
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>/</span>
              <span>{currentFolder}</span>
            </span>
          ) : 'All Files'}
        </h1>
        <div className="page-actions">
          <button className="btn-outline" onClick={handleUploadClick}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload
          </button>
          <button className="btn-outline" onClick={() => setIsCreateFolderOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg> New Folder
          </button>
        </div>
      </div>

      {/* Folder cards */}
      {!currentFolder && (
        <div className="folder-grid">
          <FolderCard name="memories" updated="Jun 4, 2026, 6:13 PM" color="orange" onClick={() => setCurrentFolder('memories')} />
          <FolderCard name="work" updated="Jun 4, 2026, 5:13 PM" color="orange" onClick={() => setCurrentFolder('work')} />
          <FolderCard name="documents" updated="Jun 4, 2026, 6:13 PM" color="green" onClick={() => setCurrentFolder('documents')} />
          <FolderCard name="videos" updated="Jun 4, 2026, 4:34 PM" color="blue" onClick={() => setCurrentFolder('videos')} />
        </div>
      )}

      {/* Tab bar + view toggle */}
      <div className="tab-bar">
        <div className="tab-buttons">
          <button
            className={`tab-btn ${activeTab === 'recents' ? 'active' : ''}`}
            onClick={() => setActiveTab('recents')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Recents
          </button>
          <button
            className={`tab-btn ${activeTab === 'starred' ? 'active' : ''}`}
            onClick={() => setActiveTab('starred')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Starred
          </button>
        </div>
        <ViewToggle viewMode={viewMode} onViewChange={setViewMode} />
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
                  <td colSpan={6} className="empty-state">No files found.</td>
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
              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                {currentFolder ? 'This folder is empty.' : 'No files found.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Folder Modal */}
      {isCreateFolderOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Create New Folder</h3>
            <input 
              type="text" 
              className="search-input" 
              style={{ width: '100%', marginBottom: '24px' }}
              placeholder="Folder Name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn-outline" onClick={() => setIsCreateFolderOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => {
                // TODO: Actually create folder in DB/cloud
                setIsCreateFolderOpen(false);
                setNewFolderName('');
              }}>Create Folder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

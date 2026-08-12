import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from './components/Sidebar';
import { TransferQueue } from './components/TransferQueue';
import { GlobalSearch } from './components/GlobalSearch';
import { FileDetailModal } from './components/FileDetailModal';
import { FileExplorer } from './pages/FileExplorer';
import { QuotaTracker } from './pages/QuotaTracker';
import { Starred } from './pages/Starred';
import { Settings } from './pages/Settings';
import { ToastProvider } from './components/Toast';
import { SearchResultRow, UserRow } from '../shared/types';

const { ipcRenderer } = window.require('electron');

const App = () => {
  const [activeView, setActiveView] = useState<'files' | 'quota' | 'shared' | 'starred' | 'settings'>('files');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    return (localStorage.getItem('lizvault_viewMode') as 'list' | 'grid') || 'list';
  });

  const handleViewModeChange = (mode: 'list' | 'grid') => {
    setViewMode(mode);
    localStorage.setItem('lizvault_viewMode', mode);
  };
  const [user, setUser] = useState<UserRow | null>(null);

  const [folderState, setFolderState] = useState<{ id: number | null; name: string | null }>({ id: null, name: null });
  const [highlightFileId, setHighlightFileId] = useState<number | null>(null);
  const [detailFile, setDetailFile] = useState<SearchResultRow | null>(null);

  const handleSearchNavigate = useCallback((result: SearchResultRow) => {
    if (result.is_folder !== 1) return;
    setActiveView('files');
    setFolderState({ id: result.id, name: result.name });
    setHighlightFileId(null);
  }, []);

  const handleSearchFileSelect = useCallback((result: SearchResultRow) => {
    setActiveView('files');
    setDetailFile(result);
  }, []);

  const handleDetailOpenLocation = useCallback((file: SearchResultRow) => {
    setDetailFile(null);
    setFolderState({ id: file.parent_folder_id, name: file.parent_name });
    setHighlightFileId(file.id);
  }, []);

  const handleHighlightHandled = useCallback(() => setHighlightFileId(null), []);
  const handleFolderChange = useCallback((id: number | null, name: string | null) => {
    setFolderState({ id, name });
  }, []);

  useEffect(() => {
    ipcRenderer.invoke('user:current').then((res: { user: UserRow | null }) => {
      setUser(res.user);
    });

    const onUserChanged = (_: any, data: { user: UserRow | null }) => {
      setUser(data.user);
    };
    ipcRenderer.on('user:changed', onUserChanged);

    return () => {
      ipcRenderer.removeListener('user:changed', onUserChanged);
    };
  }, []);

  return (
    <>
      <div className="drag-region"></div>

      <Sidebar activeView={activeView} onViewChange={setActiveView} />

      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        {user && <GlobalSearch onNavigate={handleSearchNavigate} onFileSelect={handleSearchFileSelect} />}
        {user ? (
          <div className="no-drag flex-1 overflow-y-auto px-7 pb-7 pt-5">
            {activeView === 'files' && <FileExplorer viewMode={viewMode} onViewModeChange={handleViewModeChange} folderId={folderState.id} folderName={folderState.name} onFolderChange={handleFolderChange} highlightFileId={highlightFileId} onHighlightHandled={handleHighlightHandled} />}
            {activeView === 'quota' && <QuotaTracker />}
            {activeView === 'shared' && <div>Shared With Me (Not Implemented)</div>}
            {activeView === 'starred' && <Starred viewMode={viewMode} onViewModeChange={handleViewModeChange} />}
            {activeView === 'settings' && <Settings />}
          </div>
        ) : activeView === 'settings' ? (
          <div className="no-drag flex-1 overflow-y-auto px-7 pb-7 pt-5">
            <Settings />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            <div className="flex flex-col items-center gap-3">
              <div className="text-lg font-medium text-ink">Welcome to LizVault</div>
              <div>Please log in from the sidebar to access your vault.</div>
            </div>
          </div>
        )}
      </main>

      {detailFile && (
        <FileDetailModal
          file={detailFile}
          onClose={() => setDetailFile(null)}
          onOpenLocation={handleDetailOpenLocation}
        />
      )}
    </>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(
    <ToastProvider queueSlot={<TransferQueue />}>
      <App />
    </ToastProvider>
  );
}

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { TransferQueue } from './components/TransferQueue';
import { FileExplorer } from './pages/FileExplorer';
import { QuotaTracker } from './pages/QuotaTracker';
import { Starred } from './pages/Starred';

const App = () => {
  const [activeView, setActiveView] = useState<'files' | 'quota' | 'shared' | 'starred' | 'settings'>('files');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <>
      <div className="drag-region"></div>
      
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      
      <main className="main-pane">
        <TopBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
        
        <div className="content-area no-drag">
          {activeView === 'files' && <FileExplorer searchQuery={searchQuery} />}
          {activeView === 'quota' && <QuotaTracker />}
          {activeView === 'shared' && <div>Shared With Me (Not Implemented)</div>}
          {activeView === 'starred' && <Starred searchQuery={searchQuery} />}
          {activeView === 'settings' && <div>Settings (Not Implemented)</div>}
        </div>
      </main>
      
      <TransferQueue />
    </>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<App />);
}

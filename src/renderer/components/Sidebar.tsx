import React, { useEffect, useState } from 'react';

declare global {
  interface Window {
    require: (module: string) => any;
  }
}

interface SidebarProps {
  activeView: string;
  onViewChange: (view: any) => void;
}

const SvgIcon = ({ children }: { children: React.ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const NAV_ITEMS = [
  { id: 'files', label: 'All Files', icon: <SvgIcon><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></SvgIcon> },
  { id: 'quota', label: 'Quota Tracker', icon: <SvgIcon><rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="8" x="14" y="12" rx="1"/></SvgIcon> },
  { id: 'starred', label: 'Starred', icon: <SvgIcon><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></SvgIcon> },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const [totalStorage, setTotalStorage] = useState(0);
  const [usedStorage, setUsedStorage] = useState(0);
  
  return (
    <aside className="sidebar no-drag">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">L</div>
        <span className="sidebar-logo-text">LizVault</span>
      </div>

      {/* User */}
      <div className="sidebar-user">
        <div className="sidebar-user-avatar">L</div>
        <span className="sidebar-user-email">@gmail.c...</span>
        <span className="sidebar-user-kebab">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </span>
      </div>

      <div className="sidebar-divider" />

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <div
            key={item.id}
            className={`nav-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => onViewChange(item.id)}
          >
            <span className="nav-item-icon">{item.icon}</span>
            {item.label}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="storage-legend">
          <div className="storage-legend-item">
            <span className="storage-legend-label">
              <span className="storage-legend-dot" style={{ background: 'var(--color-photo)' }} />
              Photo
            </span>
            <span className="storage-legend-value">376.71 KB</span>
          </div>
          <div className="storage-legend-item">
            <span className="storage-legend-label">
              <span className="storage-legend-dot" style={{ background: 'var(--color-video)' }} />
              Video
            </span>
            <span className="storage-legend-value">188.05 MB</span>
          </div>
          <div className="storage-legend-item">
            <span className="storage-legend-label">
              <span className="storage-legend-dot" style={{ background: 'var(--color-document)' }} />
              Document
            </span>
            <span className="storage-legend-value">5.81 MB</span>
          </div>
          <div className="storage-legend-item">
            <span className="storage-legend-label">
              <span className="storage-legend-dot" style={{ background: 'var(--color-image)' }} />
              Others
            </span>
            <span className="storage-legend-value">1.24 MB</span>
          </div>
          <div className="storage-legend-item">
            <span className="storage-legend-label">
              <span className="storage-legend-dot" style={{ background: 'var(--color-free)' }} />
              Free Storage
            </span>
            <span className="storage-legend-value">33.94 GB</span>
          </div>
        </div>

        <div className="storage-bar-container">
          <div className="storage-bar-track">
            <div className="storage-bar-segment" style={{ width: '1%', background: 'var(--color-photo)' }} />
            <div className="storage-bar-segment" style={{ width: '15%', background: 'var(--color-video)' }} />
            <div className="storage-bar-segment" style={{ width: '2%', background: 'var(--color-document)' }} />
            <div className="storage-bar-segment" style={{ width: '1%', background: 'var(--color-image)' }} />
          </div>
          <div className="storage-bar-label">
            {formatBytes(usedStorage || 26.06 * 1024 ** 3)} used of {formatBytes(totalStorage || 60 * 1024 ** 3)}
          </div>
        </div>

        <button className="sidebar-logout">
          <SvgIcon><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></SvgIcon> Log Out
        </button>
      </div>
    </aside>
  );
};

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

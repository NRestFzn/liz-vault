import React, { useCallback, useEffect, useState } from 'react';
import { AccountRow, StorageCategories, UserRow } from '../../shared/types';

const { ipcRenderer } = window.require('electron');

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
  { id: 'starred', label: 'Starred', icon: <SvgIcon><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></SvgIcon> },
  { id: 'quota', label: 'Quota Tracker', icon: <SvgIcon><rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="8" x="14" y="12" rx="1"/></SvgIcon> },
  { id: 'settings', label: 'Settings', icon: <SvgIcon><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/></SvgIcon> },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [categories, setCategories] = useState<StorageCategories>({ photo: 0, video: 0, document: 0, other: 0 });
  const [user, setUser] = useState<UserRow | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const acc = await ipcRenderer.invoke('accounts:list');
      if (acc.accounts) setAccounts(acc.accounts);
      const stats = await ipcRenderer.invoke('storage:stats');
      if (stats.categories) setCategories(stats.categories);
    } catch {
      // Ignore transient IPC failures; the next poll will retry.
    }
  }, []);

  // Load current user on mount
  useEffect(() => {
    ipcRenderer.invoke('user:current').then((res: { user: UserRow | null }) => {
      setUser(res.user);
    });
  }, []);

  useEffect(() => {
    load();

    const refresh = () => load();
    ipcRenderer.on('account:added', refresh);
    ipcRenderer.on('account:removed', refresh);
    ipcRenderer.on('upload:complete', refresh);
    ipcRenderer.on('file:deleted', refresh);

    // Listen for user state changes (login/logout from any source)
    const onUserChanged = (_: any, data: { user: UserRow | null }) => {
      setUser(data.user);
    };
    ipcRenderer.on('user:changed', onUserChanged);

    const interval = setInterval(refresh, 30000);

    return () => {
      ipcRenderer.removeListener('account:added', refresh);
      ipcRenderer.removeListener('account:removed', refresh);
      ipcRenderer.removeListener('upload:complete', refresh);
      ipcRenderer.removeListener('file:deleted', refresh);
      ipcRenderer.removeListener('user:changed', onUserChanged);
      clearInterval(interval);
    };
  }, [load]);

  const handleLogin = async () => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await ipcRenderer.invoke('user:login');
      if (res.error) setLoginError(res.error);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await ipcRenderer.invoke('user:logout');
    setUser(null);
  };

  const totalBytes = accounts.reduce((sum, a) => sum + (a.total_bytes || 0), 0);
  const usedBytes = accounts.reduce((sum, a) => sum + (a.used_bytes || 0), 0);
  const freeBytes = Math.max(0, totalBytes - usedBytes);

  const legend = [
    { label: 'Photo', color: 'var(--color-photo)', bytes: categories.photo },
    { label: 'Video', color: 'var(--color-video)', bytes: categories.video },
    { label: 'Document', color: 'var(--color-document)', bytes: categories.document },
    { label: 'Others', color: 'var(--color-image)', bytes: categories.other },
    { label: 'Free Storage', color: 'var(--color-free)', bytes: freeBytes },
  ];

  const avatarLetter = user?.display_name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <aside className="no-drag relative flex h-full w-[240px] min-w-[240px] flex-col border-r border-line bg-panel">
      {/* Logo */}
      <div className="flex h-[72px] items-center gap-2.5 border-b border-line px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[14px] font-bold text-white">L</div>
        <span className="text-[16px] font-bold tracking-tight text-ink">LizVault</span>
      </div>

      {/* User section */}
      {user ? (
        <div className="mx-3 my-4 flex items-center gap-2.5 rounded-lg p-3 transition-colors duration-150 hover:bg-surface">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#c4b5fd] text-[14px] font-semibold text-[#5b21b6]">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={avatarLetter} className="h-8 w-8 rounded-full object-cover" />
            ) : (
              avatarLetter
            )}
          </div>
          <div className="min-w-0 flex-1">
            {user.display_name && (
              <div className="truncate text-[12px] font-medium text-ink">{user.display_name}</div>
            )}
            <div className="truncate text-[11px] text-muted">{user.email}</div>
          </div>
        </div>
      ) : (
        <div className="mx-3 my-4 flex flex-col gap-2 rounded-lg border border-dashed border-line p-3">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface text-[14px] text-muted">?</div>
            <span>Not logged in</span>
          </div>
          {loginError && <div className="text-[11px] text-video">{loginError}</div>}
          <button
            className="btn-primary w-full py-1.5 text-[12px]"
            onClick={handleLogin}
            disabled={loginLoading}
          >
            {loginLoading ? 'Waiting…' : 'Login with Google'}
          </button>
        </div>
      )}

      <div className="mx-6 mb-4 h-px bg-line" />

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 px-3">
        {NAV_ITEMS.map(item => (
          <div
            key={item.id}
            className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] transition-all duration-150 hover:bg-surface hover:text-ink ${
              activeView === item.id ? 'bg-accent-soft font-medium text-accent' : 'text-muted'
            }`}
            onClick={() => onViewChange(item.id)}
          >
            <span className="flex h-5 w-5 items-center justify-center text-[16px]">{item.icon}</span>
            {item.label}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="mt-auto border-t border-line px-5 pb-5 pt-4">
        <div className="mb-4 flex flex-col gap-1.5">
          {legend.map(item => (
            <div key={item.label} className="flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: item.color }} />
                {item.label}
              </span>
              <span className="text-[12px] text-muted">{formatBytes(item.bytes)}</span>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <div className="flex h-1.5 overflow-hidden rounded-[3px] bg-line">
            {legend.slice(0, 4).map(item => (
              <div
                key={item.label}
                className="h-full transition-[width] duration-300"
                style={{ width: `${totalBytes > 0 && item.bytes > 0 ? Math.max(0.5, (item.bytes / totalBytes) * 100) : 0}%`, background: item.color }}
              />
            ))}
          </div>
          <div className="mt-1.5 text-[11px] text-muted">
            {formatBytes(usedBytes)} used of {formatBytes(totalBytes)}
          </div>
        </div>

        {user && (
          <button
            className="mt-3 flex cursor-pointer items-center gap-2 border-0 bg-transparent pt-2.5 text-[13px] text-video transition-opacity duration-150 hover:opacity-80"
            onClick={handleLogout}
          >
            <SvgIcon><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></SvgIcon> Log Out
          </button>
        )}
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

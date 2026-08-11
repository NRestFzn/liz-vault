import React, { useEffect, useState } from 'react';
import { AccountRow } from '../../shared/types';

const { ipcRenderer } = window.require('electron');

export const QuotaTracker: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadAccounts = async () => {
    const res = await ipcRenderer.invoke('accounts:list');
    if (res.accounts) setAccounts(res.accounts);
  };

  useEffect(() => {
    loadAccounts();

    const onAccountAdded = (_: any, data: { account: AccountRow }) => {
      setAccounts(prev => [...prev, data.account]);
    };

    const onAccountRemoved = () => loadAccounts();
    ipcRenderer.on('account:added', onAccountAdded);
    ipcRenderer.on('account:removed', onAccountRemoved);

    return () => {
      ipcRenderer.removeListener('account:added', onAccountAdded);
      ipcRenderer.removeListener('account:removed', onAccountRemoved);
    };
  }, []);

  // Auto-refresh: poll accounts while enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => { loadAccounts().catch(() => {}); }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleConnectDrive = async () => {
    setError(null);
    const res = await ipcRenderer.invoke('account:add');
    if (res.error) setError(res.error);
  };

  const handleRemoveAccount = async (id: number) => {
    if (confirm("Remove this account? Files using chunks in this account will be corrupted if you haven't migrated them.")) {
      await ipcRenderer.invoke('account:remove', { accountId: id });
      setAccounts(prev => prev.filter(a => a.id !== id));
    }
  };

  const totalStorage = accounts.reduce((sum, a) => sum + (a.total_bytes || 0), 0);
  const usedStorage = accounts.reduce((sum, a) => sum + (a.used_bytes || 0), 0);

  return (
    <div className="flex flex-col gap-7">
      {/* Header — wraps when the window is narrow (minimized/small) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="mb-1 text-[20px] font-bold">Quota Tracker</h2>
          <p className="text-[12px] text-muted">Track and manage connected drive storage accounts.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {error && <div className="text-[12px] text-video">{error}</div>}
          <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            className={`btn-outline px-3.5 py-1.5 text-[12px] ${autoRefresh ? 'border-accent text-accent' : ''}`}
            onClick={() => setAutoRefresh(v => !v)}
            title="Toggle periodic quota refresh"
          >
            Auto-refresh: {autoRefresh ? 'On' : 'Off'}
          </button>
          <button className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={loadAccounts}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Refresh
          </button>
          <button className="btn-primary" onClick={handleConnectDrive}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Connect Drive
          </button>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3.5">
        <StatCard title="Total Storage" value={formatGB(totalStorage)} />
        <StatCard title="Used Storage" value={formatGB(usedStorage)} />
        <StatCard title="Available" value={formatGB(totalStorage - usedStorage)} />
        <StatCard title="Accounts" value={String(accounts.length)} />
      </div>

      {/* Account cards */}
      <div className="grid grid-cols-2 gap-3.5">
        {accounts.map(acc => {
          const t = acc.total_bytes || 1;
          const u = acc.used_bytes || 0;
          const pct = Math.round((u / t) * 100);
          const barColor = pct > 80 ? 'var(--color-video)' : pct > 50 ? 'var(--color-image)' : 'var(--color-audio)';
          return (
            <AccountCard
              key={acc.id}
              email={acc.email}
              used={u / (1024 ** 3)}
              total={t / (1024 ** 3)}
              percent={pct}
              color={barColor}
              onRefresh={loadAccounts}
              onRemove={() => handleRemoveAccount(acc.id)}
            />
          );
        })}
        {accounts.length === 0 && (
          <div className="col-span-2 rounded-[10px] border border-line bg-panel p-12 text-center text-[13px] text-muted">
            No drive accounts connected. Click "Connect Drive" to add one.
          </div>
        )}
      </div>
    </div>
  );
};

function formatGB(bytes: number): string {
  return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
}

const StatCard = ({ title, value }: { title: string; value: string }) => (
  <div className="rounded-[10px] border border-line bg-panel p-[18px] transition-shadow duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
    <div className="mb-2 text-[11px] uppercase tracking-[0.04em] text-muted">{title}</div>
    <div className="text-[22px] font-bold">{value}</div>
  </div>
);

const AccountCard = ({ email, used, total, percent, color, onRefresh, onRemove }: {
  email: string; used: number; total: number; percent: number; color: string;
  onRefresh: () => void; onRemove: () => void;
}) => (
  <div className="rounded-[10px] border border-line bg-panel p-[18px] transition-shadow duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
    <div className="mb-3.5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-accent text-white">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </div>
        <span className="text-[13px] font-semibold">Google Drive</span>
        <span className="text-[11px] text-muted">{email}</span>
      </div>
      <div className="flex gap-1">
        <button className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-line bg-transparent text-muted transition-all duration-150 hover:border-accent hover:text-accent" onClick={onRefresh} title="Refresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
        <button className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-line bg-transparent text-video transition-all duration-150 hover:border-video hover:text-video" onClick={onRemove} title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    </div>

    <div className="mb-1.5 flex items-center justify-between text-[11px]">
      <span className="flex items-center gap-1.5 text-muted">
        <svg style={{ color }} width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
        storage
      </span>
      <span className="font-semibold text-ink">{percent}%</span>
    </div>
    <div className="mb-2.5 h-[5px] overflow-hidden rounded-[3px] bg-line">
      <div className="h-full rounded-[3px] transition-[width] duration-300" style={{ width: `${percent}%`, backgroundColor: color }} />
    </div>

    <div className="flex justify-between text-[11px] text-muted">
      <span>{used.toFixed(2)} GB / {total.toFixed(2)} GB</span>
      <span>Available {(total - used).toFixed(2)} GB</span>
    </div>
  </div>
);

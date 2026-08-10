import React, { useEffect, useState } from 'react';
import { AccountRow } from '../../shared/types';

const { ipcRenderer } = window.require('electron');

export const QuotaTracker: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);

  const loadAccounts = async () => {
    const res = await ipcRenderer.invoke('accounts:list');
    if (res.accounts) setAccounts(res.accounts);
  };

  useEffect(() => {
    loadAccounts();
    
    const onAccountAdded = (_: any, data: { account: AccountRow }) => {
      setAccounts(prev => [...prev, data.account]);
    };
    
    ipcRenderer.on('account:added', onAccountAdded);
    
    return () => {
      ipcRenderer.removeListener('account:added', onAccountAdded);
    };
  }, []);

  const handleConnectDrive = () => {
    ipcRenderer.invoke('account:add');
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
    <div className="quota-page">
      {/* Header */}
      <div className="quota-header">
        <div className="quota-header-info">
          <h2>Quota Tracker</h2>
          <p>Track and manage connected provider storage limits.</p>
        </div>
        <div className="quota-header-actions">
          <button className="btn-outline" onClick={loadAccounts}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Refresh
          </button>
          <button className="btn-primary" onClick={handleConnectDrive}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Connect Drive
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stat-cards">
        <StatCard title="Total Storage" value={formatGB(totalStorage)} />
        <StatCard title="Used Storage" value={formatGB(usedStorage)} />
        <StatCard title="Available" value={formatGB(totalStorage - usedStorage)} />
        <StatCard title="Accounts" value={String(accounts.length)} />
      </div>

      {/* Account cards */}
      <div className="account-grid">
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
          <div className="quota-empty">
            No accounts connected. Click "Connect Drive" to add one.
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
  <div className="stat-card">
    <div className="stat-card-label">{title}</div>
    <div className="stat-card-value">{value}</div>
  </div>
);

const AccountCard = ({ email, used, total, percent, color, onRefresh, onRemove }: {
  email: string; used: number; total: number; percent: number; color: string;
  onRefresh: () => void; onRemove: () => void;
}) => (
  <div className="account-card">
    <div className="account-card-header">
      <div className="account-card-identity">
        <div className="account-card-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </div>
        <span className="account-card-provider">Google Drive</span>
        <span className="account-card-email">{email}</span>
      </div>
      <div className="account-card-actions">
        <button className="account-card-btn" onClick={onRefresh} title="Refresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
        <button className="account-card-btn danger" onClick={onRemove} title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
    
    <div className="account-storage-label">
      <span className="account-storage-label-left">
        <svg style={{ color }} width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
        storage
      </span>
      <span className="account-storage-label-pct">{percent}%</span>
    </div>
    <div className="account-storage-track">
      <div className="account-storage-fill" style={{ width: `${percent}%`, backgroundColor: color }} />
    </div>
    
    <div className="account-storage-footer">
      <span>{used.toFixed(2)} GB / {total.toFixed(2)} GB</span>
      <span>Available {(total - used).toFixed(2)} GB</span>
    </div>
  </div>
);

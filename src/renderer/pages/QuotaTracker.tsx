import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccountRow } from '../../shared/types';
import { OAuthWaitingModal } from '../components/OAuthWaitingModal';
import { ConfirmDialog } from '../components/ConfirmDialog';

const { ipcRenderer } = window.require('electron');

export const QuotaTracker: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Auto-refresh preference now lives in Settings (app_state). Loaded on mount
  // so the 30s poll and the on-load token checks respect the saved value.
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<number | null>(null);
  const [testingIds, setTestingIds] = useState<number[]>([]);
  const [okFlash, setOkFlash] = useState<Record<number, number>>({});
  const [errorFlash, setErrorFlash] = useState<Record<number, string>>({});
  const flashTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Clean up any pending "Token OK" flash timers on unmount.
  useEffect(() => {
    return () => {
      Object.values(flashTimers.current).forEach(t => clearTimeout(t));
    };
  }, []);

  const loadAccounts = useCallback(async () => {
    const res = await ipcRenderer.invoke('accounts:list');
    if (res.accounts) setAccounts(res.accounts);
  }, []);

  // Test one account's refresh token via IPC. Definitive auth failures flip
  // the card to expired (persisted); healthy tokens show a brief "✓ OK" flash;
  // transient errors (network, missing credentials) show a short error note
  // WITHOUT touching the account's health.
  const testAccount = useCallback(async (id: number) => {
    setTestingIds(prev => (prev.includes(id) ? prev : [...prev, id]));
    try {
      const res = await ipcRenderer.invoke('account:test', { accountId: id });
      if (res.ok) {
        setAccounts(prev => prev.map(a => (a.id === id ? { ...a, token_ok: 1 } : a)));
        setOkFlash(prev => ({ ...prev, [id]: Date.now() }));
        if (flashTimers.current[id]) clearTimeout(flashTimers.current[id]);
        flashTimers.current[id] = setTimeout(() => {
          setOkFlash(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          delete flashTimers.current[id];
        }, 2000);
      } else if (res.expired) {
        setAccounts(prev => prev.map(a => (a.id === id ? { ...a, token_ok: 0 } : a)));
      } else {
        // Transient — show the real reason briefly, keep current health.
        setErrorFlash(prev => ({ ...prev, [id]: res.error || 'Token check failed.' }));
        if (flashTimers.current[id]) clearTimeout(flashTimers.current[id]);
        flashTimers.current[id] = setTimeout(() => {
          setErrorFlash(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          delete flashTimers.current[id];
        }, 3500);
      }
    } catch {
      // IPC failure — nothing to show; the finally below resets the spinner.
    } finally {
      setTestingIds(prev => prev.filter(x => x !== id));
    }
  }, []);

  // Load account list, then re-check every account's token health.
  const loadAndTest = useCallback(async () => {
    const res = await ipcRenderer.invoke('accounts:list');
    if (res.accounts) {
      setAccounts(res.accounts);
      for (const a of res.accounts) testAccount(a.id);
    }
  }, [testAccount]);

  // Read the auto-refresh preference from Settings. One-time migration from
  // the old localStorage key (set before this option moved into Settings) so
  // the user's existing choice survives the move.
  useEffect(() => {
    (async () => {
      // Resolve the preference without ever clobbering a saved choice: even if
      // a persist/migration write fails, the user's value still applies.
      let pref: boolean;
      try {
        const res = await ipcRenderer.invoke('settings:get');
        pref = res.autoRefreshQuota;
      } catch {
        pref = true;
      }

      // One-time migration from the old localStorage key (set before this
      // option moved into Settings) so the user's existing choice survives.
      const saved = localStorage.getItem('lizvault_quotaAutoRefresh');
      if (saved !== null && !localStorage.getItem('lizvault_quotaAutoRefreshMigrated')) {
        pref = saved !== '0';
        try {
          await ipcRenderer.invoke('settings:set', { autoRefreshQuota: pref });
          localStorage.removeItem('lizvault_quotaAutoRefresh');
          localStorage.setItem('lizvault_quotaAutoRefreshMigrated', '1');
        } catch {
          // Persist failed — keep the migrated value for this visit; the old
          // key stays so the migration retries next launch.
        }
      }

      setAutoRefresh(pref);
      setSettingsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;

    // Respect the preference: when auto-refresh is OFF, just show the stored
    // DB data with NO automatic token checks or reloads. Turning it ON (or the
    // manual Refresh button) does the full re-test.
    if (autoRefresh) loadAndTest();
    else loadAccounts();

    // Re-login upserts by email, so a repaired account REPLACES its card
    // instead of being appended as a duplicate.
    const onAccountAdded = (_: any, data: { account: AccountRow }) => {
      setAccounts(prev => {
        const idx = prev.findIndex(a => a.email === data.account.email);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = data.account;
          return next;
        }
        return [...prev, data.account];
      });
    };

    const onAccountRemoved = () => loadAccounts();
    ipcRenderer.on('account:added', onAccountAdded);
    ipcRenderer.on('account:removed', onAccountRemoved);

    return () => {
      ipcRenderer.removeListener('account:added', onAccountAdded);
      ipcRenderer.removeListener('account:removed', onAccountRemoved);
    };
  }, [loadAndTest, autoRefresh, loadAccounts, settingsLoaded]);

  // Auto-refresh: poll quota while enabled (token health is re-checked on page
  // load and via the Refresh / per-card buttons).
  useEffect(() => {
    if (!settingsLoaded || !autoRefresh) return;
    const interval = setInterval(() => { loadAccounts().catch(() => {}); }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, settingsLoaded]);

  const handleConnectDrive = async () => {
    setError(null);
    setConnecting(true);
    try {
      const res = await ipcRenderer.invoke('account:add');
      // A retry aborts the previous attempt — its response is `cancelled`,
      // which should never surface as an error (and must not linger after a
      // successful login either).
      if (res.cancelled) return;
      if (res.error) setError(res.error);
    } finally {
      setConnecting(false);
    }
  };

  // User pressed Cancel on the waiting modal — abort the pending flow via
  // IPC; the pending `account:add` invoke settles with `cancelled` and hides.
  // The state reset runs even if the IPC itself fails, so the modal can never
  // get stuck open.
  const handleCancelConnect = async () => {
    try {
      await ipcRenderer.invoke('oauth:cancel');
    } finally {
      setConnecting(false);
      setError(null);
    }
  };

  const handleRemoveAccount = (id: number) => setRemoveTarget(id);

  const handleConfirmRemove = async () => {
    if (removeTarget === null) return;
    try {
      await ipcRenderer.invoke('account:remove', { accountId: removeTarget });
      setAccounts(prev => prev.filter(a => a.id !== removeTarget));
      if (flashTimers.current[removeTarget]) clearTimeout(flashTimers.current[removeTarget]);
    } finally {
      setRemoveTarget(null);
    }
  };

  const totalStorage = accounts.reduce((sum, a) => sum + (a.total_bytes || 0), 0);
  const usedStorage = accounts.reduce((sum, a) => sum + (a.used_bytes || 0), 0);

  return (
    <div className="flex flex-col gap-7">
      {/* Header — wraps when the window is narrow (minimized/small) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold">Quota Tracker</h2>
        </div>
        <div className="flex flex-col items-end gap-2">
          {error && <div className="text-[12px] text-video">{error}</div>}
          <div className="flex flex-wrap items-center justify-end gap-2">
          <button className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={loadAndTest}>
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
          const expired = acc.token_ok === 0;
          return (
            <AccountCard
              key={acc.id}
              email={acc.email}
              used={u / (1024 ** 3)}
              total={t / (1024 ** 3)}
              percent={pct}
              color={barColor}
              expired={expired}
              testing={testingIds.includes(acc.id)}
              okFlash={!!okFlash[acc.id]}
              errorText={errorFlash[acc.id] || null}
              onTest={() => testAccount(acc.id)}
              onRelogin={handleConnectDrive}
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

      {/* Desktop-style OAuth waiting modal while the browser is open */}
      {connecting && (
        <OAuthWaitingModal
          title="Connect Google Drive"
          onCancel={handleCancelConnect}
        />
      )}

      {/* Custom in-app confirmation for removing an account (no native dialog) */}
      {removeTarget !== null && (
        <ConfirmDialog
          title="Remove Account"
          message={
            <>
              Are you sure you want to remove <strong>{accounts.find(a => a.id === removeTarget)?.email}</strong>?
              Files using chunks in this account will be corrupted if you haven't migrated them.
            </>
          }
          confirmLabel="Remove"
          onConfirm={handleConfirmRemove}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
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

const AccountCard = ({ email, used, total, percent, color, expired, testing, okFlash, errorText, onTest, onRelogin, onRemove }: {
  email: string; used: number; total: number; percent: number; color: string;
  expired: boolean; testing: boolean; okFlash: boolean; errorText: string | null;
  onTest: () => void; onRelogin: () => void; onRemove: () => void;
}) => (
  <div className={`rounded-[10px] border bg-panel p-[18px] transition-shadow duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] ${expired ? 'border-red-200' : 'border-line'}`}>
    <div className="mb-3.5 flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-white ${expired ? 'bg-red-400' : 'bg-accent'}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </div>          <div className="min-w-0">
            <div className="text-[13px] font-semibold leading-tight">Google Drive</div>
            <div className="truncate text-[11px] text-muted">{email}</div>
          </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {expired ? (
          <button
            className="inline-flex h-[26px] items-center gap-1 rounded-md bg-red-500 px-2.5 text-[11px] font-medium text-white transition-colors duration-150 hover:bg-red-600"
            onClick={onRelogin}
            title="Re-login to this Google account"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            Re-login
          </button>
        ) : (
          <button
            className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-line bg-transparent text-muted transition-all duration-150 hover:border-accent hover:text-accent"
            onClick={onTest}
            title={testing ? 'Testing token…' : 'Test token / refresh'}
          >
            {testing ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-line border-t-accent" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            )}
          </button>
        )}
        <button className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-line bg-transparent text-video transition-all duration-150 hover:border-video hover:text-video" onClick={onRemove} title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    </div>

    {expired ? (
      <>
        <div className="rounded-md bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
          Login expired — re-login to continue.
        </div>
        <div className="mt-2.5 flex justify-between text-[11px] text-muted">
          <span>{used.toFixed(2)} GB / {total.toFixed(2)} GB</span>
          <span className="opacity-60">Available {(total - used).toFixed(2)} GB</span>
        </div>
      </>
    ) : (
      <>
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 text-muted">
            <svg style={{ color }} width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
            storage
          </span>
          <span className="font-semibold text-ink">
            {percent}%
            {okFlash && <span className="ml-1.5 font-medium text-green-600">✓ OK</span>}
          </span>
        </div>
        <div className="mb-2.5 h-[5px] overflow-hidden rounded-[3px] bg-line">
          <div className="h-full rounded-[3px] transition-[width] duration-300" style={{ width: `${percent}%`, backgroundColor: color }} />
        </div>

        <div className="flex justify-between text-[11px] text-muted">
          <span>{used.toFixed(2)} GB / {total.toFixed(2)} GB</span>
          <span>Available {(total - used).toFixed(2)} GB</span>
        </div>
        {errorText && (
          <div className="mt-2.5 rounded-md bg-red-50 px-2.5 py-1.5 text-[11px] leading-snug text-video">
            {errorText}
          </div>
        )}
      </>
    )}
  </div>
);

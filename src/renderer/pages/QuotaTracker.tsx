import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountProvider, AccountRow } from '../../shared/types';
import { OAuthWaitingModal } from '../components/OAuthWaitingModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { AnimatePresence } from 'motion/react';

const { ipcRenderer } = window.require('electron');

export const QuotaTracker: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const { toastError, toastInfo } = useToast();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<number | null>(null);
  const [testingIds, setTestingIds] = useState<number[]>([]);
  const [okFlash, setOkFlash] = useState<Record<number, number>>({});
  const flashTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    return () => {
      Object.values(flashTimers.current).forEach(t => { clearTimeout(t); });
    };
  }, []);

  const loadAccounts = useCallback(async () => {
    const res = await ipcRenderer.invoke('accounts:list');
    if (res.accounts) setAccounts(res.accounts);
  }, []);

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
        toastError(res.error || 'Token check failed.');
      }
    } catch {
    } finally {
      setTestingIds(prev => prev.filter(x => x !== id));
    }
  }, [toastError]);

  const loadAndTest = useCallback(async () => {
    const res = await ipcRenderer.invoke('accounts:list');
    if (res.accounts) {
      setAccounts(res.accounts);
      for (const a of res.accounts) testAccount(a.id);
    }
  }, [testAccount]);

  useEffect(() => {
    (async () => {
      let pref: boolean;
      try {
        const res = await ipcRenderer.invoke('settings:get');
        pref = res.autoRefreshQuota;
      } catch {
        pref = true;
      }

      const saved = localStorage.getItem('lizvault_quotaAutoRefresh');
      if (saved !== null && !localStorage.getItem('lizvault_quotaAutoRefreshMigrated')) {
        pref = saved !== '0';
        try {
          await ipcRenderer.invoke('settings:set', { autoRefreshQuota: pref });
          localStorage.removeItem('lizvault_quotaAutoRefresh');
          localStorage.setItem('lizvault_quotaAutoRefreshMigrated', '1');
        } catch {
        }
      }

      setAutoRefresh(pref);
      setSettingsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;

    if (autoRefresh) loadAndTest();
    else loadAccounts();

    const onAccountAdded = (_event: unknown, data: { account: AccountRow }) => {
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

  useEffect(() => {
    if (!settingsLoaded || !autoRefresh) return;
    const interval = setInterval(() => { loadAccounts().catch(() => {}); }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, settingsLoaded, loadAccounts]);

  const handleConnectDrive = async () => {
    setConnecting(true);
    try {
      const res = await ipcRenderer.invoke('account:add');
      if (res.cancelled) return;
      if (res.error) {
        toastError(res.error);
      } else if (res.folderCreated) {
        toastInfo(
          res.account
            ? `LizVault created a “LizVault_Data” storage folder in ${res.account.email}'s Drive for your files.`
            : 'LizVault created its storage folder in this account\'s Drive.'
        );
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleCancelConnect = async () => {
    try {
      await ipcRenderer.invoke('oauth:cancel');
    } finally {
      setConnecting(false);
    }
  };

  const handleRemoveAccount = (id: number) => setRemoveTarget(id);

  const handleConfirmRemove = async () => {
    if (removeTarget === null) return;
    try {
      const res = await ipcRenderer.invoke('account:remove', { accountId: removeTarget });
      if (res?.error) {
        toastError(res.error);
      } else {
        setAccounts(prev => prev.filter(a => a.id !== removeTarget));
        if (flashTimers.current[removeTarget]) clearTimeout(flashTimers.current[removeTarget]);
      }
    } catch (e) {
      toastError(String(e));
    } finally {
      setRemoveTarget(null);
    }
  };

  const totalStorage = accounts.reduce((sum, a) => sum + (a.total_bytes || 0), 0);
  const usedStorage = accounts.reduce((sum, a) => sum + (a.used_bytes || 0), 0);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold">Quota Tracker</h2>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={loadAndTest}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Refresh
          </button>
          <button type="button" className="btn-primary" onClick={handleConnectDrive}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Connect Drive
          </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3.5">
        <StatCard title="Total Storage" value={formatGB(totalStorage)} />
        <StatCard title="Used Storage" value={formatGB(usedStorage)} />
        <StatCard title="Available" value={formatGB(totalStorage - usedStorage)} />
        <StatCard title="Accounts" value={String(accounts.length)} />
      </div>

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
              provider={acc.provider}
              email={acc.email}
              used={u / (1024 ** 3)}
              total={t / (1024 ** 3)}
              percent={pct}
              color={barColor}
              expired={expired}
              testing={testingIds.includes(acc.id)}
              okFlash={!!okFlash[acc.id]}
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

      <AnimatePresence>
        {connecting && (
          <OAuthWaitingModal
            title="Connect Google Drive"
            onCancel={handleCancelConnect}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
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
      </AnimatePresence>
    </div>
  );
};

function formatGB(bytes: number): string {
  return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
}

const PROVIDER_META: Record<AccountProvider, { name: string; logo: React.ReactNode }> = {
  google: {
    name: 'Google Drive',
    logo: (
      <svg aria-hidden="true" width="15" height="13" viewBox="0 0 87.3 78">
        <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 52h.07l9.6-16.65L22.75 14.7l-5.75 9.95-10.4 18a19.9 19.9 0 0 0 0 24.2Z" fill="#0066da"/>
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.7-13.35a19.9 19.9 0 0 0 0-24.2l-13.05-22.6A10.2 10.2 0 0 0 64.9 6.4H34.45a10.2 10.2 0 0 0-8.4 4.45l-3.3 5.85 9.9 17.15L51.6 52h8.3l13.65.05Z" fill="#00ac47"/>
        <path d="M34.45 6.4 27.05 6.4a10.2 10.2 0 0 0-8.4 4.45l-8.4 14.55L22.75 14.7l11.7 20.3h5.6l9.6-16.65L43.7 6.4h-9.25Z" fill="#ea4335"/>
        <path d="M30.15 52 27.5 52l-14.2 24.8c1.45.8 3.05 1.2 4.7 1.2h40.9a10.2 10.2 0 0 0 8.4-4.45l3.85-6.65-18.4.05h-13.6Z" fill="#00832d"/>
      </svg>
    ),
  },
  onedrive: {
    name: 'OneDrive',
    logo: (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24">
        <path fill="#0078d4" d="M21.446 14.86a3.33 3.33 0 0 0-.063-.024 4.118 4.118 0 0 0 .012-1.648 4.205 4.205 0 0 0-8.06-.865 3.75 3.75 0 0 0-.366.018 3.645 3.645 0 0 0-3.45 2.62 2.784 2.784 0 0 0-.114.003 3.018 3.018 0 0 0 .074 6.03h11.484a3.52 3.52 0 0 0 .483-6.975zM8.438 11.09a5.186 5.186 0 0 1 5.108-4.32c.167 0 .332.01.494.026a4.603 4.603 0 0 1 4.14-2.66c.18 0 .356.012.53.032a5.947 5.947 0 0 0-10.272 6.922zM6.214 6.48A3.343 3.343 0 0 1 8.74 3.587c.122 0 .245.008.364.02a2.966 2.966 0 0 1 2.656-1.71c.113 0 .228.008.34.02a3.833 3.833 0 0 0-3.886 4.563z"/>
      </svg>
    ),
  },
};

const StatCard = ({ title, value }: { title: string; value: string }) => (
  <div className="rounded-[10px] border border-line bg-panel p-[18px] transition-shadow duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
    <div className="mb-2 text-[11px] uppercase tracking-[0.04em] text-muted">{title}</div>
    <div className="text-[22px] font-bold">{value}</div>
  </div>
);

const AccountCard = ({ provider, email, used, total, percent, color, expired, testing, okFlash, onTest, onRelogin, onRemove }: {
  provider: AccountProvider; email: string; used: number; total: number; percent: number; color: string;
  expired: boolean; testing: boolean; okFlash: boolean;
  onTest: () => void; onRelogin: () => void; onRemove: () => void;
}) => {
  const meta = PROVIDER_META[provider];
  return (
  <div className={`rounded-[10px] border bg-panel p-[18px] transition-shadow duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] ${expired ? 'border-red-200' : 'border-line'}`}>
    <div className="mb-3.5 flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border ${expired ? 'border-red-200 bg-red-50' : 'border-line bg-white'}`}>
          {meta.logo}
        </div>          <div className="min-w-0">
            <div className="text-[13px] font-semibold leading-tight">{meta.name}</div>
            <div className="truncate text-[11px] text-muted">{email}</div>
          </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {expired ? (
          <button type="button"
            className="inline-flex h-[26px] items-center gap-1 rounded-md bg-red-500 px-2.5 text-[11px] font-medium text-white transition-colors duration-150 hover:bg-red-600"
            onClick={onRelogin}
            title="Re-login to this Google account"
          >
            <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            Re-login
          </button>
        ) : (
          <button type="button"
            className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-line bg-transparent text-muted transition-all duration-150 hover:border-accent hover:text-accent"
            onClick={onTest}
            title={testing ? 'Testing token…' : 'Test token / refresh'}
          >
            {testing ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-line border-t-accent" />
            ) : (
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            )}
          </button>
        )}
        <button type="button" className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-line bg-transparent text-video transition-all duration-150 hover:border-video hover:text-video" onClick={onRemove} title="Remove">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
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
            <svg aria-hidden="true" style={{ color }} width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
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
      </>
    )}
  </div>
  );
};

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDER_NAMES } from '../../shared/types';
import type { AccountProvider, AccountRow } from '../../shared/types';
import { OAuthWaitingModal } from '../components/OAuthWaitingModal';
import { KoofrConnectModal } from '../components/KoofrConnectModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { AnimatePresence } from 'motion/react';

const { ipcRenderer } = window.require('electron');

export const QuotaTracker: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const { toastError, toastInfo } = useToast();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<AccountProvider | null>(null);
  const [koofrModalOpen, setKoofrModalOpen] = useState(false);
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
        const idx = prev.findIndex(a => a.email === data.account.email && a.provider === data.account.provider);
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

  const handleConnectProvider = async (provider: AccountProvider) => {
    if (provider === 'koofr') {
      setKoofrModalOpen(true);
      return;
    }
    setConnectingProvider(provider);
    try {
      const channel = provider === 'dropbox' ? 'account:connect-dropbox' : 'account:add';
      const res = await ipcRenderer.invoke(channel);
      if (res.cancelled) return;
      if (res.error) {
        toastError(res.error);
      } else if (res.folderCreated) {
        toastInfo(
          res.account
            ? `LizVault created a “LizVault” storage folder in ${res.account.email}'s ${providerLabel(provider)} for your files.`
            : 'LizVault created its storage folder in this account.'
        );
      }
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleKoofrConnect = async (email: string, password: string) => {
    setKoofrModalOpen(false);
    setConnectingProvider('koofr');
    try {
      const res = await ipcRenderer.invoke('account:connect-koofr', { email, password });
      if (res.error) {
        toastError(res.error);
      } else if (res.folderCreated) {
        toastInfo(
          res.account
            ? `LizVault created a “LizVault” storage folder in ${res.account.email}'s Koofr for your files.`
            : 'LizVault created its storage folder in this account.'
        );
      }
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleCancelConnect = async () => {
    try {
      await ipcRenderer.invoke('oauth:cancel');
    } finally {
      setConnectingProvider(null);
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
        <button type="button" className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={loadAndTest}>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={() => handleConnectProvider('google')}>
          <img src={GDRIVE_LOGO} alt="" draggable={false} className="h-3 w-auto" />
          Connect Drive
        </button>
        <button type="button" className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={() => handleConnectProvider('dropbox')}>
          <img src={DROPBOX_LOGO} alt="" draggable={false} className="h-3 w-auto" />
          Connect Dropbox
        </button>
        <button type="button" className="btn-outline px-3.5 py-1.5 text-[12px]" onClick={() => handleConnectProvider('koofr')}>
          <img src={KOOFR_LOGO} alt="" draggable={false} className="h-3 w-auto" />
          Connect Koofr
        </button>
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
              onRelogin={() => handleConnectProvider(acc.provider)}
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
        {connectingProvider && connectingProvider !== 'koofr' && (
          <OAuthWaitingModal
            title={providerLabel(connectingProvider)}
            onCancel={handleCancelConnect}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {koofrModalOpen && (
          <KoofrConnectModal
            onCancel={() => setKoofrModalOpen(false)}
            onConnect={handleKoofrConnect}
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

const GDRIVE_LOGO = new URL('../../assets/icons/gdrive-logo.svg', window.location.href).href;
const DROPBOX_LOGO = new URL('../../assets/icons/dropbox-logo.svg', window.location.href).href;
const KOOFR_LOGO = new URL('../../assets/icons/koofr-logo.png', window.location.href).href;

function providerLabel(provider: AccountProvider): string {
  return PROVIDER_NAMES[provider];
}

const PROVIDER_META: Record<AccountProvider, { name: string; logo: string }> = {
  google: { name: PROVIDER_NAMES.google, logo: GDRIVE_LOGO },
  dropbox: { name: PROVIDER_NAMES.dropbox, logo: DROPBOX_LOGO },
  koofr: { name: PROVIDER_NAMES.koofr, logo: KOOFR_LOGO },
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
          <img src={meta.logo} alt="" draggable={false} className="h-3.5 w-auto" />
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
            title={`Re-login to this ${meta.name} account`}
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

import type React from 'react';
import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';

const { ipcRenderer } = window.require('electron');

export const Settings: React.FC = () => {
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [autoRenameDuplicates, setAutoRenameDuplicates] = useState(true);
  const [autoRefreshQuota, setAutoRefreshQuota] = useState(true);
  const [autoEmptyTrashDays, setAutoEmptyTrashDays] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const { toastError, toastSuccess } = useToast();

  const [googleCreds, setGoogleCreds] = useState({ clientId: '', clientSecret: '' });
  const [dropboxCreds, setDropboxCreds] = useState({ clientId: '', clientSecret: '' });
  const [credsLoaded, setCredsLoaded] = useState(false);

  useEffect(() => {
    ipcRenderer.invoke('settings:get').then((res: { confirmDelete: boolean; autoRenameDuplicates: boolean; autoRefreshQuota: boolean; autoEmptyTrashDays: number }) => {
      setConfirmDelete(res.confirmDelete);
      setAutoRenameDuplicates(res.autoRenameDuplicates);
      setAutoRefreshQuota(res.autoRefreshQuota);
      setAutoEmptyTrashDays(res.autoEmptyTrashDays || 0);
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
    });

    ipcRenderer.invoke('credentials:get').then((res: { clientId: string; clientSecret: string }) => {
      setGoogleCreds(res);
      setCredsLoaded(true);
    }).catch(() => setCredsLoaded(true));

    ipcRenderer.invoke('credentials:get', { provider: 'dropbox' }).then((res: { clientId: string; clientSecret: string }) => {
      setDropboxCreds(res);
      setCredsLoaded(true);
    }).catch(() => setCredsLoaded(true));
  }, []);

  const handleSaveCredentials = async (provider: 'google' | 'dropbox', creds: { clientId: string; clientSecret: string }) => {
    try {
      const res = await ipcRenderer.invoke('credentials:set', { provider, ...creds });
      if (res.error) {
        toastError(res.error);
      } else {
        toastSuccess(provider === 'google' ? 'Google API credentials saved.' : 'Dropbox API credentials saved.');
      }
    } catch (e) {
      toastError(String(e));
    }
  };

  const handleToggle = async (key: 'confirmDelete' | 'autoRenameDuplicates' | 'autoRefreshQuota', value: boolean) => {
    const prev = key === 'confirmDelete' ? confirmDelete : key === 'autoRenameDuplicates' ? autoRenameDuplicates : autoRefreshQuota;
    if (key === 'confirmDelete') setConfirmDelete(value);
    else if (key === 'autoRenameDuplicates') setAutoRenameDuplicates(value);
    else setAutoRefreshQuota(value);
    try {
      const res = await ipcRenderer.invoke('settings:set', { [key]: value });
      if (res.error) {
        toastError(res.error);
        if (key === 'confirmDelete') setConfirmDelete(prev);
        else if (key === 'autoRenameDuplicates') setAutoRenameDuplicates(prev);
        else setAutoRefreshQuota(prev);
      }
    } catch (e) {
      toastError(String(e));
      if (key === 'confirmDelete') setConfirmDelete(prev);
      else if (key === 'autoRenameDuplicates') setAutoRenameDuplicates(prev);
      else setAutoRefreshQuota(prev);
    }
  };

  const handleTrashDaysToggle = async (value: boolean) => {
    const prev = autoEmptyTrashDays;
    const days = value ? (prev > 0 ? prev : 30) : 0;
    setAutoEmptyTrashDays(days);
    try {
      const res = await ipcRenderer.invoke('settings:set', { autoEmptyTrashDays: days });
      if (res.error) {
        toastError(res.error);
        setAutoEmptyTrashDays(prev);
      }
    } catch (e) {
      toastError(String(e));
      setAutoEmptyTrashDays(prev);
    }
  };

  const handleTrashDaysChange = async (raw: string) => {
    const parsed = parseInt(raw, 10);
    const days = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const prev = autoEmptyTrashDays;
    setAutoEmptyTrashDays(days);
    try {
      const res = await ipcRenderer.invoke('settings:set', { autoEmptyTrashDays: days });
      if (res.error) {
        toastError(res.error);
        setAutoEmptyTrashDays(prev);
      }
    } catch (e) {
      toastError(String(e));
      setAutoEmptyTrashDays(prev);
    }
  };

  const Toggle = ({ checked, onToggle }: { checked: boolean; onToggle: () => void }) => (
    <button type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      disabled={!loaded}
      className={`relative h-[24px] w-[44px] flex-shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ${
        checked
          ? 'border-accent bg-accent'
          : 'border-line bg-surface'
      } ${loaded ? '' : 'opacity-50'}`}
    >
      <span
        className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all duration-200 ${
          checked ? 'left-[22px]' : 'left-[2px]'
        }`}
      />
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex min-h-[36px] items-center justify-between">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Settings</h1>
      </div>        <div className="flex max-w-[560px] flex-col gap-5">
        <ApiCredentialsCard
          title="Google API"
          info="Required for Google login and Drive access. Create credentials in Google Cloud Console (OAuth client ID — type Web application or Desktop app) and paste them here."
          idLabel="Client ID"
          idPlaceholder="1234567890-abcdef.apps.googleusercontent.com"
          secretLabel="Client Secret"
          secretPlaceholder="GOCSPX-…"
          creds={googleCreds}
          onChange={setGoogleCreds}
          onSave={() => handleSaveCredentials('google', googleCreds)}
          disabled={!credsLoaded}
        />

        <ApiCredentialsCard
          title="Dropbox API"
          info="Required to connect Dropbox accounts as storage. Create an app in the Dropbox App Console (Scoped access — App folder), then paste the App key and App secret here."
          idLabel="App key"
          idPlaceholder="abcdefghijklmnop"
          secretLabel="App secret"
          secretPlaceholder="~15-char secret"
          creds={dropboxCreds}
          onChange={setDropboxCreds}
          onSave={() => handleSaveCredentials('dropbox', dropboxCreds)}
          disabled={!credsLoaded}
        />

        <div className="rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between gap-4 border-b border-line p-5">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="text-[14px] font-semibold text-ink">Ask before deleting</div>
              <InfoTip
                text="Show a confirmation dialog before deleting files and folders. Turn this off to delete immediately without asking."
              />
            </div>
            <Toggle checked={confirmDelete} onToggle={() => handleToggle('confirmDelete', !confirmDelete)} />
          </div>

          <div className="flex items-center justify-between gap-4 border-b border-line p-5">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="text-[14px] font-semibold text-ink">Auto-rename duplicates</div>
              <InfoTip
                text="When you upload or create a file/folder whose name already exists here, save it as “name (2)” automatically. Turn this off to show a warning instead."
              />
            </div>
            <Toggle checked={autoRenameDuplicates} onToggle={() => handleToggle('autoRenameDuplicates', !autoRenameDuplicates)} />
          </div>

          <div className="flex items-center justify-between gap-4 border-b border-line p-5">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="text-[14px] font-semibold text-ink">Auto-refresh quota</div>
              <InfoTip
                text="Automatically refresh drive quota and check account tokens every 30 seconds on the Quota Tracker page. Turn this off to only update when you press Refresh."
              />
            </div>
            <Toggle checked={autoRefreshQuota} onToggle={() => handleToggle('autoRefreshQuota', !autoRefreshQuota)} />
          </div>

          <div className="flex items-center justify-between gap-4 p-5">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="text-[14px] font-semibold text-ink">Auto-empty trash</div>
              <InfoTip
                text="Permanently delete items from the trash after they've been there for this many days. Trash items older than the limit are removed automatically on startup, after login, and when you open the Trash page."
              />
            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              {autoEmptyTrashDays > 0 && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    value={autoEmptyTrashDays}
                    onChange={(e) => handleTrashDaysChange(e.target.value)}
                    aria-label="Days before auto-emptying trash"
                    className="w-[64px] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink transition-colors duration-150 focus:border-accent focus:shadow-[0_0_0_3px_rgba(51,102,255,0.08)] focus:outline-none"
                  />
                  <span className="text-[12px] text-muted">days</span>
                </div>
              )}
              <Toggle checked={autoEmptyTrashDays > 0} onToggle={() => handleTrashDaysToggle(autoEmptyTrashDays <= 0)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const InfoTip = ({ text }: { text: string }) => (
  <button
    type="button"
    aria-label="More information"
    className="group/tooltip relative flex h-[16px] w-[16px] flex-shrink-0 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-bold text-muted transition-colors duration-100 hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent focus-visible:outline-none"
  >
    i
    <span
      role="tooltip"
      className="pointer-events-none absolute left-1/2 top-full z-[100] mt-1.5 w-max max-w-[280px] -translate-x-1/2 rounded-md bg-[#333] px-2.5 py-1.5 text-[12px] font-medium leading-relaxed text-white opacity-0 shadow-lg transition-all delay-300 group-hover/tooltip:visible group-hover/tooltip:opacity-100 group-focus-visible/tooltip:visible group-focus-visible/tooltip:opacity-100"
    >
      {text}
    </span>
  </button>
);

const ApiCredentialsCard = ({ title, info, idLabel, idPlaceholder, secretLabel, secretPlaceholder, creds, onChange, onSave, disabled }: {
  title: string;
  info: string;
  idLabel: string;
  idPlaceholder: string;
  secretLabel: string;
  secretPlaceholder: string;
  creds: { clientId: string; clientSecret: string };
  onChange: (creds: { clientId: string; clientSecret: string }) => void;
  onSave: () => void;
  disabled: boolean;
}) => {
  const [showSecret, setShowSecret] = useState(false);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-line p-5 pb-4">
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        <InfoTip text={info} />
      </div>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <label htmlFor={`${slug}-client-id`} className="mb-1.5 block text-[12px] font-medium text-muted">{idLabel}</label>
          <input
            id={`${slug}-client-id`}
            type="text"
            value={creds.clientId}
            onChange={(e) => onChange({ ...creds, clientId: e.target.value })}
            placeholder={idPlaceholder}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-colors duration-150 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_rgba(51,102,255,0.08)] focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor={`${slug}-client-secret`} className="mb-1.5 block text-[12px] font-medium text-muted">{secretLabel}</label>
          <div className="flex items-center rounded-lg border border-line bg-surface transition-colors duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(51,102,255,0.08)]">
            <input
              id={`${slug}-client-secret`}
              type={showSecret ? 'text' : 'password'}
              value={creds.clientSecret}
              onChange={(e) => onChange({ ...creds, clientSecret: e.target.value })}
              placeholder={secretPlaceholder}
              className="w-full min-w-0 bg-transparent px-3 py-2 text-[13px] text-ink placeholder:text-muted focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowSecret(v => !v)}
              className="flex h-full cursor-pointer items-center px-3 text-muted transition-colors duration-100 hover:text-ink"
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
            >
              {showSecret ? (
                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
              ) : (
                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="btn-primary px-4 py-1.5 text-[12px]" onClick={onSave} disabled={disabled}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';

const { ipcRenderer } = window.require('electron');

/**
 * Settings page — confirm-before-delete toggle and the duplicate-name policy
 * (auto-rename vs. warn-with-modal). Reads/writes app_state via IPC.
 */
export const Settings: React.FC = () => {
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [autoRenameDuplicates, setAutoRenameDuplicates] = useState(true);
  const [autoRefreshQuota, setAutoRefreshQuota] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google API credentials
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [credsSaved, setCredsSaved] = useState(false);
  const [credsError, setCredsError] = useState<string | null>(null);
  const [credsLoaded, setCredsLoaded] = useState(false);

  useEffect(() => {
    ipcRenderer.invoke('settings:get').then((res: { confirmDelete: boolean; autoRenameDuplicates: boolean; autoRefreshQuota: boolean }) => {
      setConfirmDelete(res.confirmDelete);
      setAutoRenameDuplicates(res.autoRenameDuplicates);
      setAutoRefreshQuota(res.autoRefreshQuota);
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
    });

    ipcRenderer.invoke('credentials:get').then((res: { clientId: string; clientSecret: string }) => {
      setClientId(res.clientId);
      setClientSecret(res.clientSecret);
      setCredsLoaded(true);
    }).catch(() => setCredsLoaded(true));
  }, []);

  const handleSaveCredentials = async () => {
    setCredsError(null);
    setCredsSaved(false);
    try {
      const res = await ipcRenderer.invoke('credentials:set', { clientId, clientSecret });
      if (res.error) {
        setCredsError(res.error);
      } else {
        setCredsSaved(true);
        setTimeout(() => setCredsSaved(false), 2500);
      }
    } catch (e: any) {
      setCredsError(String(e));
    }
  };

  const handleToggle = async (key: 'confirmDelete' | 'autoRenameDuplicates' | 'autoRefreshQuota', value: boolean) => {
    const prev = key === 'confirmDelete' ? confirmDelete : key === 'autoRenameDuplicates' ? autoRenameDuplicates : autoRefreshQuota;
    if (key === 'confirmDelete') setConfirmDelete(value);
    else if (key === 'autoRenameDuplicates') setAutoRenameDuplicates(value);
    else setAutoRefreshQuota(value);
    setError(null);
    try {
      const res = await ipcRenderer.invoke('settings:set', { [key]: value });
      if (res.error) {
        setError(res.error);
        if (key === 'confirmDelete') setConfirmDelete(prev);
        else if (key === 'autoRenameDuplicates') setAutoRenameDuplicates(prev);
        else setAutoRefreshQuota(prev); // roll back on failure
      }
    } catch (e: any) {
      setError(String(e));
      if (key === 'confirmDelete') setConfirmDelete(prev);
      else if (key === 'autoRenameDuplicates') setAutoRenameDuplicates(prev);
      else setAutoRefreshQuota(prev); // roll back on failure
    }
  };

  const Toggle = ({ checked, onToggle }: { checked: boolean; onToggle: () => void }) => (
    <button
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

  // Info icon (i) after a setting title — shows the detail on hover/focus.
  // Styling matches the custom tooltips used on file cards/rows.
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

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="mb-6 flex min-h-[36px] items-center justify-between">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Settings</h1>
      </div>        <div className="flex max-w-[560px] flex-col gap-5">
        {/* Google API credentials */}
        <div className="rounded-xl border border-line bg-panel">
          <div className="flex min-w-0 items-center gap-1.5 border-b border-line p-5 pb-4">
            <div className="text-[14px] font-semibold text-ink">Google API</div>
            <InfoTip
              text="Required for Google login and Drive access. Create credentials in Google Cloud Console (OAuth client ID — type Web application or Desktop app) and paste them here."
            />
          </div>
          <div className="flex flex-col gap-4 p-5">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-muted">Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => { setClientId(e.target.value); setCredsError(null); }}
                placeholder="1234567890-abcdef.apps.googleusercontent.com"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-colors duration-150 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_rgba(51,102,255,0.08)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-muted">Client Secret</label>
              <div className="flex items-center rounded-lg border border-line bg-surface transition-colors duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(51,102,255,0.08)]">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={clientSecret}
                  onChange={(e) => { setClientSecret(e.target.value); setCredsError(null); }}
                  placeholder="GOCSPX-…"
                  className="w-full min-w-0 bg-transparent px-3 py-2 text-[13px] text-ink placeholder:text-muted focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(v => !v)}
                  className="flex h-full cursor-pointer items-center px-3 text-muted transition-colors duration-100 hover:text-ink"
                  aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                >
                  {showSecret ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                className="btn-primary px-4 py-1.5 text-[12px]"
                onClick={handleSaveCredentials}
                disabled={!credsLoaded}
              >
                Save
              </button>
              {credsSaved && <span className="text-[12px] font-medium text-emerald-600">Saved ✓</span>}
              {credsError && <span className="text-[12px] text-video">{credsError}</span>}
            </div>
          </div>
        </div>

        {/* Behavior toggles */}
        <div className="rounded-xl border border-line bg-panel">
          {/* Delete confirmation */}
          <div className="flex items-center justify-between gap-4 border-b border-line p-5">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="text-[14px] font-semibold text-ink">Ask before deleting</div>
              <InfoTip
                text="Show a confirmation dialog before deleting files and folders. Turn this off to delete immediately without asking."
              />
            </div>
            <Toggle checked={confirmDelete} onToggle={() => handleToggle('confirmDelete', !confirmDelete)} />
          </div>

          {/* Duplicate names */}
          <div className="flex items-center justify-between gap-4 border-b border-line p-5">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="text-[14px] font-semibold text-ink">Auto-rename duplicates</div>
              <InfoTip
                text="When you upload or create a file/folder whose name already exists here, save it as “name (2)” automatically. Turn this off to show a warning instead."
              />
            </div>
            <Toggle checked={autoRenameDuplicates} onToggle={() => handleToggle('autoRenameDuplicates', !autoRenameDuplicates)} />
          </div>

          {/* Quota auto-refresh */}
          <div className="flex items-center justify-between gap-4 p-5">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="text-[14px] font-semibold text-ink">Auto-refresh quota</div>
              <InfoTip
                text="Automatically refresh drive quota and check account tokens every 30 seconds on the Quota Tracker page. Turn this off to only update when you press Refresh."
              />
            </div>
            <Toggle checked={autoRefreshQuota} onToggle={() => handleToggle('autoRefreshQuota', !autoRefreshQuota)} />
          </div>
        </div>

        {error && <div className="mt-3 text-[12px] text-video">{error}</div>}
      </div>
    </div>
  );
};

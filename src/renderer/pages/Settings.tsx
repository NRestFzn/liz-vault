import React, { useEffect, useState } from 'react';

const { ipcRenderer } = window.require('electron');

/**
 * Settings page — confirm-before-delete toggle and the duplicate-name policy
 * (auto-rename vs. warn-with-modal). Reads/writes app_state via IPC.
 */
export const Settings: React.FC = () => {
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [autoRenameDuplicates, setAutoRenameDuplicates] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ipcRenderer.invoke('settings:get').then((res: { confirmDelete: boolean; autoRenameDuplicates: boolean }) => {
      setConfirmDelete(res.confirmDelete);
      setAutoRenameDuplicates(res.autoRenameDuplicates);
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
    });
  }, []);

  const handleToggle = async (key: 'confirmDelete' | 'autoRenameDuplicates', value: boolean) => {
    const prev = key === 'confirmDelete' ? confirmDelete : autoRenameDuplicates;
    if (key === 'confirmDelete') setConfirmDelete(value);
    else setAutoRenameDuplicates(value);
    setError(null);
    try {
      const res = await ipcRenderer.invoke('settings:set', { [key]: value });
      if (res.error) {
        setError(res.error);
        if (key === 'confirmDelete') setConfirmDelete(prev);
        else setAutoRenameDuplicates(prev); // roll back on failure
      }
    } catch (e: any) {
      setError(String(e));
      if (key === 'confirmDelete') setConfirmDelete(prev);
      else setAutoRenameDuplicates(prev); // roll back on failure
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

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="mb-6 flex min-h-[36px] items-center justify-between">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Settings</h1>
      </div>

      <div className="max-w-[560px]">
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          {/* Delete confirmation */}
          <div className="flex items-center justify-between gap-4 border-b border-line p-5">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-ink">Ask before deleting</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-muted">
                Show a confirmation dialog before deleting files and folders. Turn this off to
                delete immediately without asking.
              </div>
            </div>
            <Toggle checked={confirmDelete} onToggle={() => handleToggle('confirmDelete', !confirmDelete)} />
          </div>

          {/* Duplicate names */}
          <div className="flex items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-ink">Auto-rename duplicates</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-muted">
                When you upload or create a file/folder whose name already exists here, save it
                as “name (2)” automatically. Turn this off to show a warning instead.
              </div>
            </div>
            <Toggle checked={autoRenameDuplicates} onToggle={() => handleToggle('autoRenameDuplicates', !autoRenameDuplicates)} />
          </div>
        </div>

        {error && <div className="mt-3 text-[12px] text-video">{error}</div>}

        <p className="mt-4 text-[12px] text-muted">
          Deleting a folder permanently removes it and everything inside it from all connected
          drives. This cannot be undone.
        </p>
      </div>
    </div>
  );
};

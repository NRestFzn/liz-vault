import React, { useEffect, useRef, useState } from 'react';

interface RenameModalProps {
  title: string;
  /** Base name shown in the input (for files: WITHOUT the extension). */
  initialName: string;
  /** Muted suffix appended on confirm — for files this is the extension (e.g. ".zip"). Folders pass ''. */
  suffix?: string;
  error?: string | null;
  confirmLabel?: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

/**
 * Small rename modal — same style as the New Folder modal. For files the
 * extension is split off into a muted suffix so it can never be lost while
 * editing the base name (Enter confirms, Esc cancels). The full name
 * (base + suffix) is what onConfirm receives.
 */
export const RenameModal: React.FC<RenameModalProps> = ({ title, initialName, suffix = '', error, confirmLabel = 'Rename', onConfirm, onCancel }) => {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  // Keep the latest name readable from the (mount-only) keydown listener
  // without re-registering it on every keystroke.
  const nameRef = useRef(name);
  nameRef.current = name;

  const fullName = () => name.trim() + suffix;

  // Autofocus + select-all — mount only, so typing never re-selects.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Enter confirms / Esc cancels — registered once, reads the live name via ref.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && nameRef.current.trim() !== '') onConfirm(nameRef.current.trim() + suffix);
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onConfirm, onCancel, suffix]);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        className="w-[400px] max-w-[90vw] rounded-xl border border-line bg-panel p-6 shadow-[0_10px_30px_rgba(0,0,0,0.1)]"
      >
        <h3 className="mb-4 text-[18px] font-semibold text-ink">{title}</h3>
        <div className="mb-6 flex items-center rounded-lg border border-line bg-panel px-3 py-2 transition-colors duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(51,102,255,0.08)]">
          <input
            ref={inputRef}
            type="text"
            className="w-full min-w-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {suffix && (
            <span className="flex-shrink-0 select-none text-[13px] text-muted">{suffix}</span>
          )}
        </div>
        {error && <div className="-mt-4 mb-4 text-[12px] text-red-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="btn-primary"
            disabled={name.trim() === ''}
            onClick={() => onConfirm(fullName())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

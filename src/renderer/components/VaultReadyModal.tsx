import type React from 'react';
import {useEffect, useRef} from 'react';
import { motion } from 'motion/react';

interface VaultReadyModalProps {
  email: string | null;
  onClose: () => void;
}

export const VaultReadyModal: React.FC<VaultReadyModalProps> = ({
  email,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    okRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  const rows = [
    {
      id: 'folder',
      icon: (
        <svg aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </svg>
      ),
      text: (
        <>
          A folder named{' '}
          <strong className="font-semibold text-ink">“LizVault”</strong> was
          created in the Google Drive of the account you just logged in with
          {email ? ` (${email})` : ''}.
        </>
      ),
    },
    {
      id: 'manifest',
      icon: (
        <svg aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      ),
      text: (
        <>
          Inside it,{' '}
          <strong className="font-semibold text-ink">manifest.json</strong>{' '}
          keeps the vault's index. your files and folders, stars, and where each
          file's pieces (“chunks”) are stored.
        </>
      ),
    },
    {
      id: 'chunks',
      icon: (
        <svg aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      ),
      text: (
        <>
          Your actual file content lives as chunks in the Google Drive accounts
          you connect with{' '}
          <strong className="font-semibold text-ink">“Connect Drive”</strong>.
        </>
      ),
    },
    {
      id: 'warning',
      icon: (
        <svg aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ),
      text: (
        <>
          Don't delete or rename the{' '}
          <strong className="font-semibold text-ink">LizVault</strong> folder or{' '}
          <strong className="font-semibold text-ink">manifest.json</strong>.
          that's how the app finds your vault, even when you sign in with this
          account on another device.
        </>
      ),
    },
  ];

  return (
      <motion.div
        className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
        onMouseDown={handleBackdropClick}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Vault created"
        className="w-[460px] max-w-[92vw] rounded-xl border border-line bg-panel p-6 shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
            <svg aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h3 className="text-[17px] font-semibold text-ink">
            Your vault is ready
          </h3>
        </div>

        <div className="mb-6 flex flex-col gap-3.5">
          {rows.map(row => (
            <div key={row.id} className="flex items-start gap-3">
              <span className="mt-px flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                {row.icon}
              </span>
              <p className="text-[12.5px] leading-relaxed text-muted">
                {row.text}
              </p>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button type="button" ref={okRef} className="btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

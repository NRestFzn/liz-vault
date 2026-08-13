import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  checkboxLabel?: string;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: (dontAskAgain: boolean) => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, message, confirmLabel = 'Delete', checkboxLabel, onConfirm, onCancel }) => {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel(dontAskAgain);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, dontAskAgain]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
      onCancel(dontAskAgain);
    }
  };

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
        className="w-[400px] max-w-[90vw] rounded-xl border border-line bg-panel p-6 shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
        role="alertdialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <h3 className="mb-4 text-[18px] font-semibold text-ink">{title}</h3>
        <div className="mb-6 text-[13px] leading-relaxed text-muted">{message}</div>

        {checkboxLabel && (
          <label className="mb-6 flex cursor-pointer items-center gap-2.5 text-[12px] text-ink select-none">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer rounded border-[1.5px] border-line accent-accent"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
            />
            {checkboxLabel}
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={() => onCancel(dontAskAgain)}>Cancel</button>
          <button type="button"
            ref={confirmRef}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-red-700"
            onClick={() => onConfirm(dontAskAgain)}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

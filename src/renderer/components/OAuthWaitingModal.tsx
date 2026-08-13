import type React from 'react';
import { motion } from 'motion/react';

interface OAuthWaitingModalProps {
  title: string;
  onCancel: () => void;
}

export const OAuthWaitingModal: React.FC<OAuthWaitingModalProps> = ({ title, onCancel }) => {
  return (
    <motion.div
      className="fixed inset-0 z-[20001] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="flex w-[380px] max-w-[90vw] flex-col items-center rounded-xl border border-line bg-panel p-8 shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface">
          <GoogleG />
        </div>

        <h3 className="mb-2 text-[16px] font-semibold text-ink">{title}</h3>
        <p className="mb-6 text-center text-[12.5px] leading-relaxed text-muted">
          Continue signing in with your browser.
        </p>

        <div className="mb-6 flex items-center gap-2.5 text-[12px] text-muted">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
          Waiting for authorization…
        </div>

        <button type="button" className="btn-outline w-full justify-center" onClick={onCancel}>
          Cancel
        </button>
      </motion.div>
    </motion.div>
  );
};

const GoogleG = () => (
  <svg aria-hidden="true" width="34" height="34" viewBox="0 0 48 48">
    <path
      fill="#FFC107"
      d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"
    />
    <path
      fill="#FF3D00"
      d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
    />
    <path
      fill="#4CAF50"
      d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
    />
    <path
      fill="#1976D2"
      d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"
    />
  </svg>
);

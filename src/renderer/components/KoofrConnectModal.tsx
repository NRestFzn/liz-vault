import type React from 'react';
import { useState } from 'react';
import { motion } from 'motion/react';

interface KoofrConnectModalProps {
  onCancel: () => void;
  onConnect: (email: string, password: string) => void;
}

const KOOFR_LOGO = new URL('../../assets/icons/koofr-logo.png', window.location.href).href;

export const KoofrConnectModal: React.FC<KoofrConnectModalProps> = ({ onCancel, onConnect }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConnect(email, password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[20001] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="w-[400px] max-w-[90vw] rounded-xl border border-line bg-panel p-7 shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface">
            <img src={KOOFR_LOGO} alt="" draggable={false} className="h-5 w-auto" />
          </div>
          <div>
            <h3 className="text-[16px] font-semibold text-ink">Connect Koofr</h3>
            <p className="text-[12px] text-muted">Koofr connects with an app password — no browser login.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="koofr-email" className="mb-1.5 block text-[12px] font-medium text-muted">Koofr email</label>
            <input
              id="koofr-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-colors duration-150 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_rgba(51,102,255,0.08)] focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="koofr-password" className="mb-1.5 block text-[12px] font-medium text-muted">App password</label>
            <div className="flex items-center rounded-lg border border-line bg-surface transition-colors duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(51,102,255,0.08)]">
              <input
                id="koofr-password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Generate one in Koofr settings"
                className="w-full min-w-0 bg-transparent px-3 py-2 text-[13px] text-ink placeholder:text-muted focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="flex h-full cursor-pointer items-center px-3 text-muted transition-colors duration-100 hover:text-ink"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                ) : (
                  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Find it in Koofr at Settings → App passwords. The password is stored encrypted on this device.
            </p>
          </div>

          <div className="mt-1 flex items-center gap-2.5">
            <button
              type="submit"
              className="btn-primary px-4 py-1.5 text-[12px]"
              disabled={submitting || !email || !password}
            >
              {submitting ? 'Connecting…' : 'Connect'}
            </button>
            <button type="button" className="btn-outline px-4 py-1.5 text-[12px]" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

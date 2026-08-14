import type React from 'react';
import { useEffect, useRef } from 'react';

interface UploadMenuProps {
  x: number;
  y: number;
  onUploadFile: () => void;
  onUploadFolder: () => void;
  onClose: () => void;
}

export const UploadMenu: React.FC<UploadMenuProps> = ({ x, y, onUploadFile, onUploadFolder, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && !(e.target as Element).closest('[role="alertdialog"]')) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  let safeX = x;
  let safeY = y;
  const menuWidth = 160;
  const menuHeight = 100;

  if (typeof window !== 'undefined') {
    if (x + menuWidth > window.innerWidth) safeX = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) safeY = window.innerHeight - menuHeight - 10;
  }

  return (
    <div
      ref={menuRef}
      style={{ top: safeY, left: safeX }}
      className="fixed z-[10000] min-w-[160px] rounded-lg border border-line bg-surface p-1.5 shadow-xl outline-none select-none flex flex-col gap-0.5"
    >
      <button type="button"
        onClick={() => { onUploadFile(); onClose(); }}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-accent/[0.08] hover:text-accent cursor-pointer"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Upload File
      </button>
      <button type="button"
        onClick={() => { onUploadFolder(); onClose(); }}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-accent/[0.08] hover:text-accent cursor-pointer"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg>
        Upload Folder
      </button>
    </div>
  );
};

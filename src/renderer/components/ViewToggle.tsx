import React from 'react';

interface ViewToggleProps {
  viewMode: 'list' | 'grid';
  onViewChange: (mode: 'list' | 'grid') => void;
}

export const ViewToggle: React.FC<ViewToggleProps> = ({ viewMode, onViewChange }) => {
  return (
    <div className="flex gap-1">
      <button
        className={`flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-md border text-[16px] transition-all duration-150 ${
          viewMode === 'grid'
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line bg-panel text-muted hover:border-[#d1d5db]'
        }`}
        onClick={() => onViewChange('grid')}
        title="Grid View"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
      </button>
      <button
        className={`flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-md border text-[16px] transition-all duration-150 ${
          viewMode === 'list'
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line bg-panel text-muted hover:border-[#d1d5db]'
        }`}
        onClick={() => onViewChange('list')}
        title="List View"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>
    </div>
  );
};

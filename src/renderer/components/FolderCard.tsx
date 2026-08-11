import React from 'react';

interface FolderCardProps {
  name: string;
  updated: string;
  color: 'orange' | 'green' | 'blue';
  itemCount?: number;
  isStarred?: boolean;
  /** Multi-select mode — card renders a check badge and selection highlight. */
  isSelected?: boolean;
  /** Fired when the corner check badge is clicked (card already stops propagation). */
  onSelect?: (e: React.MouseEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

const FOLDER_COLORS = {
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6',
};

const FolderSVG: React.FC<{ color: string }> = ({ color }) => (
  // shrink-0 + explicit width/height: the icon must never be compressed by
  // flexbox when the card content is tight (tall mono line-heights, wrapped
  // meta lines) — its size is now independent of grid width / state.
  <svg
    className="mb-3 h-10 w-12 shrink-0"
    width="48"
    height="40"
    viewBox="0 0 48 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M4 6C4 3.79086 5.79086 2 8 2H18L22 8H40C42.2091 8 44 9.79086 44 12V34C44 36.2091 42.2091 38 40 38H8C5.79086 38 4 36.2091 4 34V6Z" fill={color} />
    <path d="M4 14H44V34C44 36.2091 42.2091 38 40 38H8C5.79086 38 4 36.2091 4 34V14Z" fill={color} opacity="0.85" />
  </svg>
);

/**
 * Folder card for the auto-fill grid. Uniform fixed height so rows stay even
 * no matter how many folders exist; long names truncate with a tooltip.
 */
export const FolderCard: React.FC<FolderCardProps> = ({ name, updated, color, itemCount, isStarred, isSelected, onSelect, onClick, onContextMenu }) => (
  <div
    onClick={onClick}
    onContextMenu={onContextMenu}
    className={`group/folder relative flex h-[128px] flex-col justify-between rounded-xl border bg-panel p-4 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:z-10 hover:border-[#c9d2e0] hover:shadow-[0_4px_14px_rgba(0,0,0,0.08)] ${onClick ? 'cursor-pointer' : ''} ${isSelected ? 'border-accent bg-accent-soft' : 'border-line'}`}
  >
    {/* Selection badge — appears on hover, stays visible once selected */}
    {onSelect && (
      <button
        className={`absolute left-3 top-3 z-20 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-[5px] border transition-all duration-150 ${
          isSelected
            ? 'border-accent bg-accent text-white opacity-100'
            : 'border-[#c3ccda] bg-white opacity-0 group-hover/folder:opacity-100 hover:border-accent'
        }`}
        onClick={(e) => { e.stopPropagation(); onSelect(e); }}
        aria-label={isSelected ? 'Deselect folder' : 'Select folder'}
      >
        {isSelected && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        )}
      </button>
    )}
    {isStarred && (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute right-3 top-3 z-10 text-amber-400"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    )}
    <FolderSVG color={FOLDER_COLORS[color]} />

    <div className="min-w-0">
      <div className="truncate text-[13px] font-semibold text-ink">{name}</div>
      {/* Custom tooltip for truncated names (CSS title attr is banned) */}
      <div className="pointer-events-none absolute left-4 top-full z-[100] mt-1.5 invisible w-max max-w-[200px] -translate-y-1 break-words rounded bg-[#333] px-2.5 py-1.5 text-[12px] font-medium leading-relaxed text-white opacity-0 shadow-lg transition-all delay-300 group-hover/folder:visible group-hover/folder:translate-y-0 group-hover/folder:opacity-100">
        {name}
      </div>
      <div className="mt-1 flex items-center justify-between whitespace-nowrap text-[11px] text-muted">
        <span className="truncate">Updated {updated}</span>
        {itemCount !== undefined && (
          <span className="flex-shrink-0 pl-2">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
        )}
      </div>
    </div>
  </div>
);

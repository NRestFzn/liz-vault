import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchResultRow } from '../../shared/types';
import { formatBytes } from '../../shared/format';
import { FileTypeIcon } from './FileTypeIcon';

const { ipcRenderer } = window.require('electron');

interface GlobalSearchProps {
  onNavigate: (result: SearchResultRow) => void;
  onFileSelect: (result: SearchResultRow) => void;
}

const FOLDER_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
  </svg>
);

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-accent">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ onNavigate, onFileSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  const folders = useMemo(() => results.filter(r => r.is_folder === 1), [results]);
  const files = useMemo(() => results.filter(r => r.is_folder === 0), [results]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }
    const seq = ++seqRef.current;
    setOpen(true);
    setLoading(true);
    setResults([]);
    setActiveIndex(-1);
    const timer = setTimeout(async () => {
      try {
        const res = await ipcRenderer.invoke('files:search-all', { query: q });
        if (seqRef.current !== seq) return;
        setResults(res.results ?? []);
      } catch {
        if (seqRef.current === seq) setResults([]);
      } finally {
        if (seqRef.current === seq) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = containerRef.current?.querySelector(`[data-result-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectResult = useCallback((result: SearchResultRow) => {
    if (result.is_folder === 1) {
      onNavigate(result);
    } else {
      onFileSelect(result);
    }
    setQuery('');
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  }, [onNavigate, onFileSelect]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const total = folders.length + files.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (total === 0 ? -1 : (i + 1) % total));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (total === 0 ? -1 : (i - 1 + total) % total));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const flat = [...folders, ...files];
      const target = activeIndex >= 0 ? flat[activeIndex] : flat[0];
      if (target) selectResult(target);
    } else if (e.key === 'Escape') {
      if (open) {
        setOpen(false);
      } else {
        setQuery('');
        inputRef.current?.blur();
      }
    }
  };

  const showDropdown = open && query.trim().length > 0;
  const noResults = showDropdown && folders.length === 0 && files.length === 0;

  return (
    <header className="no-drag flex h-[72px] flex-shrink-0 items-center gap-3 border-b border-line bg-panel px-7">
      <div ref={containerRef} className="relative w-[380px]">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </span>
        <input
          ref={inputRef}
          className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-9 text-[13px] text-ink transition-colors duration-150 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_rgba(51,102,255,0.08)]"
          type="text"
          placeholder="Search files and folders"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.trim()) setOpen(true); }}
        />
        {query && (
          <button type="button"
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer border-0 bg-transparent p-1 text-muted transition-colors hover:text-ink"
            aria-label="Clear search"
          >
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}

        {showDropdown && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[340px] overflow-y-auto rounded-lg border border-line bg-panel py-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.12)]">
            {noResults ? (
              <div className="px-4 py-6 text-center text-[13px] text-muted">
                {loading ? (
                  'Searching…'
                ) : (
                  <>No files or folders found for <span className="text-ink">“{query.trim()}”</span></>
                )}
              </div>
            ) : (
              <>
                {folders.length > 0 && (
                  <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Folders</div>
                )}
                {folders.map((result, i) => (
                  <SearchResultRowItem
                    key={result.id}
                    result={result}
                    query={query.trim()}
                    active={activeIndex === i}
                    index={i}
                    onHover={() => setActiveIndex(i)}
                    onSelect={() => selectResult(result)}
                  />
                ))}
                {files.length > 0 && (
                  <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Files</div>
                )}
                {files.map((result, i) => (
                  <SearchResultRowItem
                    key={result.id}
                    result={result}
                    query={query.trim()}
                    active={activeIndex === folders.length + i}
                    index={folders.length + i}
                    onHover={() => setActiveIndex(folders.length + i)}
                    onSelect={() => selectResult(result)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

    </header>
  );
};

interface SearchResultRowItemProps {
  result: SearchResultRow;
  query: string;
  active: boolean;
  index: number;
  onHover: () => void;
  onSelect: () => void;
}

const SearchResultRowItem: React.FC<SearchResultRowItemProps> = ({ result, query, active, index, onHover, onSelect }) => {
  const isFolder = result.is_folder === 1;
  const location =
    result.parent_path && result.parent_path.length > 0
      ? `All Files / ${result.parent_path.join(' / ')}`
      : 'All Files';

  return (
    <button
      type="button"
      data-result-index={index}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors duration-100 ${
        active ? 'bg-accent-soft' : 'hover:bg-surface'
      }`}
    >
      <div
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${
          isFolder ? 'text-folder-blue' : 'bg-[#f1f3f7]'
        }`}
        style={isFolder ? { backgroundColor: 'var(--color-folder-blue)1A' } : undefined}
      >
        {isFolder ? FOLDER_ICON : <FileTypeIcon name={result.name} size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink">
          <HighlightMatch text={result.name} query={query} />
        </div>
        <div className="truncate text-[11px] text-muted">
          {isFolder ? location : `in ${location}`}
        </div>
      </div>
      {!isFolder && (
        <span className="flex-shrink-0 text-[11px] text-muted">{formatBytes(result.size_bytes)}</span>
      )}
    </button>
  );
};

import React from 'react';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ searchQuery, onSearchChange }) => {
  return (
    <div className="top-bar no-drag">
      <div className="search-wrapper">
        <span className="search-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </span>
        <input 
          className="search-input"
          type="text" 
          placeholder="Search Folder, Document, Etc" 
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <button className="search-filter-btn" title="Filter">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
        </button>
      </div>
    </div>
  );
};

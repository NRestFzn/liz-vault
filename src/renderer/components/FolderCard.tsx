import React from 'react';

interface FolderCardProps {
  name: string;
  updated: string;
  color: 'orange' | 'green' | 'blue';
  onClick?: () => void;
}

const FOLDER_COLORS = {
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6',
};

const FolderSVG: React.FC<{ color: string }> = ({ color }) => (
  <svg className="folder-icon-svg" viewBox="0 0 48 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 6C4 3.79086 5.79086 2 8 2H18L22 8H40C42.2091 8 44 9.79086 44 12V34C44 36.2091 42.2091 38 40 38H8C5.79086 38 4 36.2091 4 34V6Z" fill={color} />
    <path d="M4 14H44V34C44 36.2091 42.2091 38 40 38H8C5.79086 38 4 36.2091 4 34V14Z" fill={color} opacity="0.85" />
  </svg>
);

export const FolderCard: React.FC<FolderCardProps> = ({ name, updated, color, onClick }) => (
  <div className="folder-card" onClick={onClick}>
    <button className="folder-card-kebab">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
    </button>
    <FolderSVG color={FOLDER_COLORS[color]} />
    <div className="folder-card-name">{name}</div>
    <div className="folder-card-date">Updated {updated}</div>
  </div>
);

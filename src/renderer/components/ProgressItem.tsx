import React from 'react';

interface ProgressItemProps {
  fileName: string;
  progress: number;
  speedMBps?: number;
  type: 'upload' | 'download';
  onCancel: () => void;
}

export const ProgressItem: React.FC<ProgressItemProps> = ({ fileName, progress, speedMBps, type, onCancel }) => {
  const isComplete = progress >= 100;

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-panel p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between">
        <span className="max-w-[240px] truncate text-[13px] font-medium">
          {type === 'upload' ? '↑' : '↓'} {fileName}
        </span>
        <button className="cursor-pointer border-0 bg-transparent p-0.5 text-[16px] text-muted" onClick={onCancel}>×</button>
      </div>
      <div className="h-1 overflow-hidden rounded-[2px] bg-line">
        <div className={`h-full rounded-[2px] transition-[width] duration-200 ease-in-out ${isComplete ? 'bg-audio' : 'bg-accent'}`} style={{ width: `${progress}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-muted">
        <span>{isComplete ? 'Complete' : `${progress.toFixed(1)}%`}</span>
        {!isComplete && speedMBps !== undefined && <span>{speedMBps.toFixed(1)} MB/s</span>}
      </div>
    </div>
  );
};

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
    <div className="transfer-item">
      <div className="transfer-item-header">
        <span className="transfer-item-name">
          {type === 'upload' ? '↑' : '↓'} {fileName}
        </span>
        <button className="transfer-item-close" onClick={onCancel}>×</button>
      </div>
      <div className="transfer-progress-track">
        <div className={`transfer-progress-bar ${isComplete ? 'complete' : ''}`} style={{ width: `${progress}%` }} />
      </div>
      <div className="transfer-item-footer">
        <span>{isComplete ? 'Complete' : `${progress.toFixed(1)}%`}</span>
        {!isComplete && speedMBps !== undefined && <span>{speedMBps.toFixed(1)} MB/s</span>}
      </div>
    </div>
  );
};

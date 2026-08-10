import React, { useEffect, useState } from 'react';
import { ProgressItem } from './ProgressItem';

const { ipcRenderer } = window.require('electron');

interface Transfer {
  id: string;
  fileName: string;
  progress: number;
  type: 'upload' | 'download';
  speedMBps?: number;
}

export const TransferQueue: React.FC = () => {
  const [transfers, setTransfers] = useState<Record<string, Transfer>>({});

  useEffect(() => {
    const onUploadProgress = (_: any, data: { fileId: number, bytesUploaded: number, totalBytes: number }) => {
      const progress = data.totalBytes > 0 ? (data.bytesUploaded / data.totalBytes) * 100 : 0;
      setTransfers(prev => ({
        ...prev,
        [`upload-${data.fileId}`]: { ...prev[`upload-${data.fileId}`], id: `upload-${data.fileId}`, progress, type: 'upload' }
      }));
    };

    const onUploadComplete = (_: any, data: { fileId: number }) => {
      setTransfers(prev => {
        const next = { ...prev };
        if (next[`upload-${data.fileId}`]) next[`upload-${data.fileId}`].progress = 100;
        return next;
      });
      setTimeout(() => {
        setTransfers(prev => { const next = { ...prev }; delete next[`upload-${data.fileId}`]; return next; });
      }, 3000);
    };

    const onDownloadProgress = (_: any, data: { fileId: number, bytesDownloaded: number, totalBytes: number }) => {
      const progress = data.totalBytes > 0 ? (data.bytesDownloaded / data.totalBytes) * 100 : 0;
      setTransfers(prev => ({
        ...prev,
        [`download-${data.fileId}`]: { ...prev[`download-${data.fileId}`], id: `download-${data.fileId}`, progress, type: 'download' }
      }));
    };

    const onDownloadComplete = (_: any, data: { fileId: number }) => {
      setTransfers(prev => {
        const next = { ...prev };
        if (next[`download-${data.fileId}`]) next[`download-${data.fileId}`].progress = 100;
        return next;
      });
      setTimeout(() => {
        setTransfers(prev => { const next = { ...prev }; delete next[`download-${data.fileId}`]; return next; });
      }, 3000);
    };

    ipcRenderer.on('upload:progress', onUploadProgress);
    ipcRenderer.on('upload:complete', onUploadComplete);
    ipcRenderer.on('download:progress', onDownloadProgress);
    ipcRenderer.on('download:complete', onDownloadComplete);

    return () => {
      ipcRenderer.removeListener('upload:progress', onUploadProgress);
      ipcRenderer.removeListener('upload:complete', onUploadComplete);
      ipcRenderer.removeListener('download:progress', onDownloadProgress);
      ipcRenderer.removeListener('download:complete', onDownloadComplete);
    };
  }, []);

  const transferList = Object.values(transfers);
  if (transferList.length === 0) return null;

  return (
    <div className="transfer-queue">
      {transferList.map(t => (
        <ProgressItem
          key={t.id}
          type={t.type}
          fileName={t.fileName || `File ${t.id.split('-')[1]}`}
          progress={t.progress}
          speedMBps={t.speedMBps}
          onCancel={() => {
            setTransfers(prev => { const next = { ...prev }; delete next[t.id]; return next; });
          }}
        />
      ))}
    </div>
  );
};

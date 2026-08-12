import React, { useCallback, useEffect, useState } from 'react';
import { ProgressItem } from './ProgressItem';
import { useToast } from './Toast';

const { ipcRenderer } = window.require('electron');

interface Transfer {
  id: string;
  fileName: string;
  progress: number;
  type: 'upload' | 'download';
  speedMBps?: number;
}

/**
 * Transfer progress items. Renders ONLY the items (no positioning): the
 * ToastProvider owns the top-right column and renders this queueSlot below
 * the toast stack, so toasts and progress never overlap.
 */
export const TransferQueue: React.FC = () => {
  const [transfers, setTransfers] = useState<Record<string, Transfer>>({});
  const { toastError } = useToast();

  // Only touches setTransfers (stable), so it can be memoized once and safely
  // referenced from the IPC listener effect below.
  const removeTransfer = useCallback((id: string) => {
    setTransfers(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    const onUploadProgress = (_: any, data: { fileId: number, fileName: string, bytesUploaded: number, totalBytes: number }) => {
      const progress = data.totalBytes > 0 ? (data.bytesUploaded / data.totalBytes) * 100 : 0;
      setTransfers(prev => ({
        ...prev,
        [`upload-${data.fileId}`]: { ...prev[`upload-${data.fileId}`], id: `upload-${data.fileId}`, fileName: data.fileName, progress, type: 'upload' }
      }));
    };

    const onUploadComplete = (_: any, data: { fileId: number }) => {
      setTransfers(prev => {
        const next = { ...prev };
        if (next[`upload-${data.fileId}`]) next[`upload-${data.fileId}`].progress = 100;
        return next;
      });
      setTimeout(() => removeTransfer(`upload-${data.fileId}`), 3000);
    };

    const onUploadError = (_: any, data: { fileId: number, error: string }) => {
      toastError(`Upload failed: ${data.error}`);
      removeTransfer(`upload-${data.fileId}`);
    };

    const onDownloadProgress = (_: any, data: { fileId: number, fileName: string, bytesDownloaded: number, totalBytes: number }) => {
      const progress = data.totalBytes > 0 ? (data.bytesDownloaded / data.totalBytes) * 100 : 0;
      setTransfers(prev => ({
        ...prev,
        [`download-${data.fileId}`]: { ...prev[`download-${data.fileId}`], id: `download-${data.fileId}`, fileName: data.fileName, progress, type: 'download' }
      }));
    };

    const onDownloadComplete = (_: any, data: { fileId: number }) => {
      setTransfers(prev => {
        const next = { ...prev };
        if (next[`download-${data.fileId}`]) next[`download-${data.fileId}`].progress = 100;
        return next;
      });
      setTimeout(() => removeTransfer(`download-${data.fileId}`), 3000);
    };

    const onDownloadError = (_: any, data: { fileId: number, error: string }) => {
      toastError(`Download failed: ${data.error}`);
      removeTransfer(`download-${data.fileId}`);
    };

    ipcRenderer.on('upload:progress', onUploadProgress);
    ipcRenderer.on('upload:complete', onUploadComplete);
    ipcRenderer.on('upload:error', onUploadError);
    ipcRenderer.on('download:progress', onDownloadProgress);
    ipcRenderer.on('download:complete', onDownloadComplete);
    ipcRenderer.on('download:error', onDownloadError);

    return () => {
      ipcRenderer.removeListener('upload:progress', onUploadProgress);
      ipcRenderer.removeListener('upload:complete', onUploadComplete);
      ipcRenderer.removeListener('upload:error', onUploadError);
      ipcRenderer.removeListener('download:progress', onDownloadProgress);
      ipcRenderer.removeListener('download:complete', onDownloadComplete);
      ipcRenderer.removeListener('download:error', onDownloadError);
    };
  }, [removeTransfer, toastError]);

  const transferList = Object.values(transfers);
  if (transferList.length === 0) return null;

  return (
    // The provider's column is pointer-events-none; items opt back in so the
    // cancel buttons stay clickable.
    <div className="pointer-events-auto flex max-h-[400px] flex-col gap-2 overflow-y-auto">
      {transferList.map(t => (
        <ProgressItem
          key={t.id}
          type={t.type}
          fileName={t.fileName || `File ${t.id.split('-')[1]}`}
          progress={t.progress}
          speedMBps={t.speedMBps}
          onCancel={() => removeTransfer(t.id)}
        />
      ))}
    </div>
  );
};

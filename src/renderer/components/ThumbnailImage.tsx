import React, { useEffect, useRef, useState } from 'react';
import { FileRow } from '../../shared/types';
import { isBrowserDecodableImage } from '../../shared/fileCategory';
import { FileTypeIcon } from './FileTypeIcon';

const { ipcRenderer } = window.require('electron');

// fileId -> data URL. Shared across pages so navigating away and back is instant.
const thumbnailCache = new Map<number, string>();

interface ThumbnailImageProps {
  file: FileRow;
  /** Size of the fallback icon (when no preview is available). */
  iconSize?: number;
  /** Class for the rendered <img> (defaults to object-cover fill). */
  imgClassName?: string;
}

/**
 * Grid-view preview. Shows the actual image for browser-decodable photos
 * (downloaded from Drive chunk 0, lazily when scrolled into view) and a
 * color-coded per-extension icon for everything else.
 */
export const ThumbnailImage: React.FC<ThumbnailImageProps> = ({ file, iconSize = 48, imgClassName }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(thumbnailCache.get(file.id) ?? null);
  const [started, setStarted] = useState<boolean>(() => thumbnailCache.has(file.id));
  const [failed, setFailed] = useState(false);

  const canThumbnail = isBrowserDecodableImage(file.name);

  useEffect(() => {
    if (src) return; // already have the preview
    if (!isBrowserDecodableImage(file.name)) return;
    if (started) return;

    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(e => e.isIntersecting)) return;
        observer.disconnect();
        setStarted(true);
        ipcRenderer
          .invoke('file:thumbnail', { fileId: file.id })
          .then((res: { dataUrl: string | null }) => {
            if (cancelled) return;
            if (res.dataUrl) {
              thumbnailCache.set(file.id, res.dataUrl);
              setSrc(res.dataUrl);
            } else {
              setFailed(true);
            }
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [file.id, file.name, src, started]);

  const showImage = canThumbnail && src !== null && !failed;

  return (
    <div ref={containerRef} className="flex h-full w-full items-center justify-center overflow-hidden">
      {showImage ? (
        <img
          src={src!}
          alt={file.name}
          draggable={false}
          className={imgClassName ?? 'h-full w-full object-cover'}
          onError={() => setFailed(true)}
        />
      ) : canThumbnail && started && !failed ? (
        // Loading skeleton
        <div className="h-7 w-7 animate-pulse rounded-full bg-[#e3e6ea]" />
      ) : (
        // Non-decodable image (heic/raw/tiff) or fetch failure -> icon
        <FileTypeIcon name={file.name} size={iconSize} />
      )}
    </div>
  );
};

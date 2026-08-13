const SIZES = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Human-readable byte size, e.g. `3.25 GB`. (binary units, 1024-based) */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), SIZES.length - 1);
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${SIZES[i]}`;
}

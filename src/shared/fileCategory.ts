// Single source of truth for file-type categorization, shared by the renderer
// (file icons, thumbnails) and the main process (storage stats). Keeps the two in sync.

/** Broad buckets used by the sidebar storage legend + storage stats. */
export type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'other';

/** Fine-grained buckets used for per-extension file icons. */
export type ExtendedCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'code'
  | 'executable'
  | 'database'
  | 'font'
  | 'other';

export interface FileTypeInfo {
  category: ExtendedCategory;
  /** Human label, e.g. "ZIP Archive" */
  label: string;
  /** Icon color (hex) — keep consistent with the sidebar storage legend colors. */
  color: string;
  /** Lowercase extensions (no leading dot). First match wins. */
  extensions: string[];
}

// Ordered — the first entry whose extension list matches wins, so keep the
// extension sets disjoint.
const FILE_TYPES: FileTypeInfo[] = [
  {
    category: 'image',
    label: 'Image',
    color: '#f59e0b',
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic', 'heif', 'tif', 'tiff', 'raw', 'cr2', 'nef', 'psd', 'ai'],
  },
  {
    category: 'video',
    label: 'Video',
    color: '#ef4444',
    extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'm2ts', 'ogv', 'rm', 'rmvb'],
  },
  {
    category: 'audio',
    label: 'Audio',
    color: '#10b981',
    extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'wma', 'aiff', 'amr', 'mid', 'midi'],
  },
  {
    category: 'archive',
    label: 'Archive',
    color: '#d97706',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2', 'iso', 'jar', 'war', 'ear', 'cab', 'deb', 'rpm', 'zst', 'lz', 'lzma', 'arj', 'ace'],
  },
  {
    category: 'document',
    label: 'Document',
    color: '#3b82f6',
    extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'markdown', 'tex', 'epub', 'mobi', 'pages'],
  },
  {
    category: 'spreadsheet',
    label: 'Spreadsheet',
    color: '#22c55e',
    extensions: ['xls', 'xlsx', 'csv', 'ods', 'numbers', 'tsv'],
  },
  {
    category: 'presentation',
    label: 'Presentation',
    color: '#f97316',
    extensions: ['ppt', 'pptx', 'odp', 'key'],
  },
  {
    category: 'code',
    label: 'Code',
    color: '#6366f1',
    extensions: ['js', 'jsx', 'ts', 'tsx', 'py', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'json', 'xml', 'yml', 'yaml', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'kts', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'vue', 'svelte', 'dart', 'lua', 'r', 'pl', 'pm', 'hs', 'ex', 'exs', 'erl', 'clj', 'scala', 'groovy', 'toml', 'ini', 'cfg', 'conf'],
  },
  {
    category: 'executable',
    label: 'Executable',
    color: '#64748b',
    extensions: ['exe', 'msi', 'app', 'apk', 'dmg', 'pkg', 'bin', 'com', 'elf', 'appimage'],
  },
  {
    category: 'database',
    label: 'Database',
    color: '#14b8a6',
    extensions: ['db', 'sqlite', 'sqlite3', 'sql', 'dbf', 'mdb', 'accdb', 'mdf', 'bak'],
  },
  {
    category: 'font',
    label: 'Font',
    color: '#ec4899',
    extensions: ['ttf', 'otf', 'woff', 'woff2', 'eot', 'fon', 'fnt'],
  },
  {
    category: 'other',
    label: 'File',
    color: '#94a3b8',
    extensions: [],
  },
];

export function getFileTypeInfo(name: string): FileTypeInfo {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (!ext) return FILE_TYPES[FILE_TYPES.length - 1];
  for (const type of FILE_TYPES) {
    if (type.extensions.includes(ext)) return type;
  }
  return FILE_TYPES[FILE_TYPES.length - 1];
}

function getExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() || '';
}

/**
 * Split a filename into its base and its LAST extension (e.g. photo.png →
 * { base: 'photo', ext: '.png' }; archive.tar.gz → { base: 'archive.tar', ext: '.gz' }).
 * Files with no extension return ext: ''. Used by the rename modal so the
 * extension is preserved while the user edits only the base name.
 */
export function splitFileName(name: string): { base: string; ext: string } {
  const m = name.match(/^(.*)(\.[^.\\/]*)$/);
  // No extension, or a hidden file like ".gitignore" (empty base) — keep the
  // whole name as the editable base so the rename modal never opens empty.
  if (!m || !m[1]) return { base: name, ext: '' };
  return { base: m[1], ext: m[2] };
}

/** Broad category — used by the sidebar legend and storage stats. */
export function getFileCategory(name: string): FileCategory {
  switch (getFileTypeInfo(name).category) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'document':
    case 'spreadsheet':
    case 'presentation': return 'document';
    default: return 'other'; // archive, code, executable, database, font, other
  }
}

export function isImageFile(name: string): boolean {
  return getFileTypeInfo(name).category === 'image';
}

/** Extensions the browser <img> tag can actually decode (heic/raw/tiff can't). */
const BROWSER_DECODABLE_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];

export function isBrowserDecodableImage(name: string): boolean {
  return BROWSER_DECODABLE_IMAGE_EXTS.includes(getExtension(name));
}

const IMAGE_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

/** MIME type for a browser-decodable image, or null. */
export function getImageMime(name: string): string | null {
  return IMAGE_MIME_MAP[getExtension(name)] ?? null;
}

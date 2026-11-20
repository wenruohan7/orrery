export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p: string) => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i).toLowerCase();
};
export const stripMd = (n: string) => n.replace(/\.md$/i, '');
export const noteTitle = (p: string) => stripMd(basename(p));
export const isNote = (p: string) => /\.md$/i.test(p);
export const isImage = (p: string) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p);
export const isAudio = (p: string) => /\.(mp3|m4a|wav|ogg|flac)$/i.test(p);
export const isVideo = (p: string) => /\.(mp4|webm|mov)$/i.test(p);
export const isPdf = (p: string) => /\.pdf$/i.test(p);

export const ATTACHMENT_EXT = /\.(png|jpe?g|gif|webp|svg|avif|mp3|m4a|wav|ogg|flac|mp4|webm|mov|pdf|txt|csv|json)$/i;

export function joinPath(...parts: string[]) {
  return normalizePath(parts.filter(Boolean).join('/'));
}

/** Clean a user-entered path: forward slashes, no empty, dot or hidden segments. */
export function normalizePath(p: string) {
  return p
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.replace(/[:*?"<>|]/g, '').trim())
    .filter((s) => s && s !== '.' && s !== '..' && !s.startsWith('.'))
    .join('/');
}

export function ensureMd(p: string) {
  return isNote(p) ? p : p + '.md';
}

export function uniquePath(path: string, exists: (p: string) => boolean) {
  if (!exists(path)) return path;
  const ext = extname(path);
  const stem = ext ? path.slice(0, -ext.length) : path;
  for (let i = 1; ; i++) {
    const candidate = `${stem} ${i}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}

/** Vault-wide solar system settings; synced, but hidden from the file list. */
export const CONFIG_PATH = 'orrery.json';

export const topFolder = (p: string) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '');

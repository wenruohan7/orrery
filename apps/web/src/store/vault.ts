import { create } from 'zustand';
import { db } from './db';
import type { Settings, VaultFile } from './types';
import { hashBlob, hashText } from '../lib/hash';
import { applyTemplate, formatDate } from '../lib/dates';
import { rewriteLinks } from '../lib/markdown';
import { basename, dirname, ensureMd, isNote, joinPath, normalizePath, noteTitle, uniquePath } from '../lib/paths';
import { makeResolver } from './vaultIndex';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const DEFAULT_SETTINGS: Settings = {
  syncUrl: !isTauri && /^https?:$/.test(location.protocol) ? location.origin : '',
  token: '',
  dailyFolder: 'Daily',
  dailyTemplate: 'Templates/Daily note.md',
  templateFolder: 'Templates',
  attachmentFolder: 'Attachments',
  editorMode: 'edit',
};

interface VaultState {
  ready: boolean;
  files: Record<string, VaultFile>;
  settings: Settings;
  bookmarks: string[];
  activePath: string | null;
  back: string[];
  forward: string[];

  load(): Promise<void>;
  open(path: string | null): void;
  goBack(): void;
  goForward(): void;
  createNote(path: string, content?: string, open?: boolean): string;
  saveNote(path: string, content: string): void;
  saveAttachment(name: string, blob: Blob): Promise<string>;
  /** Create or replace a non-note file at an exact path. */
  saveFile(path: string, blob: Blob): Promise<void>;
  rename(oldPath: string, newPath: string): string | null;
  renameFolder(oldFolder: string, newFolder: string): void;
  remove(path: string): void;
  removeFolder(folder: string): void;
  openDaily(date?: Date): string;
  toggleBookmark(path: string): void;
  updateSettings(patch: Partial<Settings>): void;
  /** Used by sync: replace a file with the server copy (or delete it with null). */
  putSynced(path: string, file: VaultFile | null): void;
  resetVault(): Promise<void>;
}

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function persist(path: string, delay = 400) {
  clearTimeout(pendingWrites.get(path));
  pendingWrites.set(
    path,
    setTimeout(() => {
      pendingWrites.delete(path);
      const f = useVault.getState().files[path];
      void (f ? db.putFile(f) : db.deleteFile(path));
    }, delay),
  );
}

export function flushWrites() {
  for (const [path, t] of pendingWrites) {
    clearTimeout(t);
    pendingWrites.delete(path);
    const f = useVault.getState().files[path];
    void (f ? db.putFile(f) : db.deleteFile(path));
  }
}

export const useVault = create<VaultState>((set, get) => {
  const exists = (p: string) => {
    const f = get().files[p];
    return !!f && !f.deleted;
  };

  const write = (file: VaultFile | null, path = file!.path) => {
    set((s) => {
      const files = { ...s.files };
      if (file) files[path] = file;
      else delete files[path];
      return { files };
    });
    persist(path, 0);
  };

  /** Create or overwrite a file, reusing a tombstone's baseRev so the server sees an update. */
  const putNew = (path: string, data: Omit<VaultFile, 'path' | 'baseRev' | 'dirty' | 'deleted'>) => {
    const prev = get().files[path];
    write({ ...data, path, baseRev: prev?.baseRev ?? 0, dirty: true, deleted: false });
  };

  const saveKv = () => {
    const { settings, bookmarks } = get();
    void db.set('settings', settings);
    void db.set('bookmarks', bookmarks);
  };

  return {
    ready: false,
    files: {},
    settings: DEFAULT_SETTINGS,
    bookmarks: [],
    activePath: null,
    back: [],
    forward: [],

    async load() {
      const [list, settings, bookmarks, active] = await Promise.all([
        db.allFiles(),
        db.get<Partial<Settings>>('settings'),
        db.get<string[]>('bookmarks'),
        db.get<string>('activePath'),
      ]);
      const files = Object.fromEntries(list.map((f) => [f.path, f]));
      set({
        files,
        settings: { ...DEFAULT_SETTINGS, ...settings },
        bookmarks: bookmarks ?? [],
        activePath: active && files[active] && !files[active].deleted ? active : null,
        ready: true,
      });
      void navigator.storage?.persist?.();
    },

    open(path) {
      const { activePath, back } = get();
      if (path === activePath) return;
      set({ activePath: path, back: activePath ? [...back.slice(-50), activePath] : back, forward: [] });
      void db.set('activePath', path);
    },
    goBack() {
      const { back, activePath, forward } = get();
      const prev = [...back];
      let target: string | undefined;
      while ((target = prev.pop()) && !exists(target));
      if (!target) return;
      set({ activePath: target, back: prev, forward: activePath ? [activePath, ...forward] : forward });
    },
    goForward() {
      const { back, activePath, forward } = get();
      const next = [...forward];
      let target: string | undefined;
      while ((target = next.shift()) && !exists(target));
      if (!target) return;
      set({ activePath: target, forward: next, back: activePath ? [...back, activePath] : back });
    },

    createNote(path, content = '', open = true) {
      const target = uniquePath(ensureMd(normalizePath(path) || 'Untitled'), exists);
      putNew(target, { kind: 'note', content, hash: hashText(content), mtime: Date.now() });
      if (open) get().open(target);
      return target;
    },

    saveNote(path, content) {
      const f = get().files[path];
      if (!f || f.deleted || f.content === content) return;
      set((s) => ({
        files: { ...s.files, [path]: { ...f, content, hash: hashText(content), mtime: Date.now(), dirty: true } },
      }));
      persist(path);
    },

    async saveAttachment(name, blob) {
      const path = uniquePath(joinPath(get().settings.attachmentFolder, normalizePath(basename(name)) || 'file'), exists);
      putNew(path, { kind: 'binary', content: '', blob, hash: await hashBlob(blob), mtime: Date.now() });
      return path;
    },

    async saveFile(path, blob) {
      putNew(path, { kind: 'binary', content: '', blob, hash: await hashBlob(blob), mtime: Date.now() });
    },

    rename(oldPath, newPath) {
      const f = get().files[oldPath];
      let target = normalizePath(newPath);
      if (!f || !target) return null;
      if (f.kind === 'note') target = ensureMd(target);
      if (target === oldPath) return oldPath;
      if (exists(target)) throw new Error(`"${target}" already exists`);

      // Point links at the new name before the old one disappears.
      const before = Object.values(get().files).filter((x) => !x.deleted);
      const oldResolver = makeResolver(before.map((x) => x.path));
      const after = makeResolver(before.map((x) => (x.path === oldPath ? target : x.path)));
      const linkText = after.linkText(target);
      for (const n of before) {
        if (n.kind !== 'note') continue;
        const updated = rewriteLinks(n.content, (t) => (oldResolver.resolve(t) === oldPath ? linkText : null));
        if (updated !== n.content) get().saveNote(n.path, updated);
      }

      const current = get().files[oldPath];
      const { activePath, bookmarks } = get();
      putNew(target, { kind: current.kind, content: current.content, blob: current.blob, hash: current.hash, mtime: Date.now() });
      get().remove(oldPath);
      set((s) => ({
        bookmarks: bookmarks.map((b) => (b === oldPath ? target : b)),
        activePath: activePath === oldPath ? target : s.activePath,
        back: s.back.map((b) => (b === oldPath ? target : b)),
      }));
      saveKv();
      return target;
    },

    renameFolder(oldFolder, newFolder) {
      const to = normalizePath(newFolder);
      if (!to || to === oldFolder) return;
      const inside = Object.values(get().files).filter((f) => !f.deleted && f.path.startsWith(oldFolder + '/'));
      for (const f of inside) get().rename(f.path, to + f.path.slice(oldFolder.length));
    },

    remove(path) {
      const f = get().files[path];
      if (!f) return;
      if (f.baseRev === 0) write(null, path);
      else write({ ...f, content: '', blob: undefined, deleted: true, dirty: true, mtime: Date.now() });
      set((s) => ({
        bookmarks: s.bookmarks.filter((b) => b !== path),
        activePath: s.activePath === path ? null : s.activePath,
      }));
    },

    removeFolder(folder) {
      for (const f of Object.values(get().files)) if (!f.deleted && f.path.startsWith(folder + '/')) get().remove(f.path);
    },

    openDaily(date = new Date()) {
      const { settings, files } = get();
      const title = formatDate(date);
      const path = joinPath(settings.dailyFolder, title + '.md');
      if (exists(path)) {
        get().open(path);
        return path;
      }
      const tpl = files[settings.dailyTemplate];
      const content = tpl && !tpl.deleted ? applyTemplate(tpl.content, title, date) : `# ${title}\n\n`;
      return get().createNote(path, content);
    },

    toggleBookmark(path) {
      set((s) => ({ bookmarks: s.bookmarks.includes(path) ? s.bookmarks.filter((b) => b !== path) : [...s.bookmarks, path] }));
      saveKv();
    },

    updateSettings(patch) {
      set((s) => ({ settings: { ...s.settings, ...patch } }));
      saveKv();
    },

    putSynced(path, file) {
      write(file, path);
      if (!file && get().activePath === path) set({ activePath: null });
    },

    async resetVault() {
      await db.clearFiles();
      await db.set('lastRev', 0);
      set({ files: {}, activePath: null, back: [], forward: [], bookmarks: [] });
      saveKv();
    },
  };
});

export const titleOf = (path: string) => (isNote(path) ? noteTitle(path) : basename(path));
export const folderOf = dirname;

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushWrites);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushWrites());
}

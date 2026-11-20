import { create } from 'zustand';
import { db } from '../store/db';
import { useVault } from '../store/vault';
import type { VaultFile } from '../store/types';
import { hashText } from '../lib/hash';
import { formatDate } from '../lib/dates';
import { extname, uniquePath } from '../lib/paths';

type Status = 'off' | 'idle' | 'syncing' | 'error' | 'offline';

export const useSync = create<{ status: Status; message: string; lastSync: number }>(() => ({
  status: 'off',
  message: '',
  lastSync: 0,
}));

interface RemoteEntry {
  path: string;
  rev: number;
  hash: string;
  deleted: boolean;
  kind: 'note' | 'binary';
  content?: string;
}

class SyncError extends Error {}

const vault = () => useVault.getState();
const enabled = () => !!(vault().settings.syncUrl && vault().settings.token);

async function api(path: string, init: RequestInit = {}) {
  const { syncUrl, token } = vault().settings;
  const res = await fetch(syncUrl.replace(/\/+$/, '') + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (res.status === 401) throw new SyncError('Wrong sync token');
  if (!res.ok && res.status !== 409) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new SyncError(body?.error ?? `Server error ${res.status}`);
  }
  return res;
}

export interface Version {
  id: string;
  time: number;
}

/** Snapshots the server kept of a file, newest first. */
export async function fetchHistory(path: string): Promise<Version[]> {
  if (!enabled()) throw new SyncError('Version history needs the sync server. Set it up in Settings → Sync.');
  const res = await api(`/api/history?path=${encodeURIComponent(path)}`).catch((e) => {
    throw e instanceof TypeError ? new SyncError('Can’t reach the sync server') : e;
  });
  return ((await res.json()) as { versions: Version[] }).versions;
}

export async function fetchVersion(path: string, id: string) {
  return (await api(`/api/version?path=${encodeURIComponent(path)}&id=${id}`)).text();
}

export async function testConnection(url: string, token: string) {
  const res = await fetch(url.replace(/\/+$/, '') + '/api/ping', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error('The server rejected the token');
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return (await res.json()) as { name: string; rev: number; files: number };
}

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function fetchRemoteFile(entry: RemoteEntry): Promise<VaultFile> {
  const base = { path: entry.path, kind: entry.kind, baseRev: entry.rev, hash: entry.hash, mtime: Date.now(), dirty: false, deleted: false };
  if (entry.kind === 'note') {
    const content =
      entry.content ?? (await (await api(`/api/raw?path=${encodeURIComponent(entry.path)}`)).text());
    return { ...base, content };
  }
  const blob = await (await api(`/api/raw?path=${encodeURIComponent(entry.path)}`)).blob();
  return { ...base, content: '', blob };
}

/** Keep the local edit next to the server's version instead of losing either. */
function saveConflictCopy(local: VaultFile) {
  const ext = extname(local.path);
  const stem = local.path.slice(0, local.path.length - ext.length);
  const stamp = formatDate(new Date(), 'YYYY-MM-DD HHmm');
  const path = uniquePath(`${stem} (conflict ${stamp})${ext}`, (p) => !!vault().files[p] && !vault().files[p].deleted);
  vault().putSynced(path, { ...local, path, baseRev: 0, dirty: true, deleted: false, mtime: Date.now() });
}

async function push() {
  const dirty = Object.values(vault().files).filter((f) => f.dirty);
  for (const f of dirty) {
    if (f.deleted) {
      if (f.baseRev === 0) {
        vault().putSynced(f.path, null);
        continue;
      }
      const res = await api(`/api/file?path=${encodeURIComponent(f.path)}&baseRev=${f.baseRev}`, { method: 'DELETE' });
      if (res.status === 409) {
        // Changed on another device after we last saw it: keep their version.
        const body = (await res.json()) as { entry: RemoteEntry };
        vault().putSynced(f.path, await fetchRemoteFile(body.entry));
      } else if (vault().files[f.path]?.deleted) vault().putSynced(f.path, null);
      continue;
    }

    const payload =
      f.kind === 'note'
        ? { path: f.path, baseRev: f.baseRev, kind: f.kind, encoding: 'utf8', content: f.content }
        : { path: f.path, baseRev: f.baseRev, kind: f.kind, encoding: 'base64', content: await blobToBase64(f.blob ?? new Blob()) };
    const res = await api('/api/file', { method: 'PUT', body: JSON.stringify(payload) });
    const body = await res.json();

    if (res.status === 409) {
      const remote = await fetchRemoteFile(body.entry as RemoteEntry);
      const latest = vault().files[f.path] ?? f;
      saveConflictCopy(latest);
      vault().putSynced(f.path, remote);
      continue;
    }
    const latest = vault().files[f.path];
    if (!latest || latest.deleted) continue;
    // If the note was edited while uploading, it stays dirty for the next round.
    vault().putSynced(f.path, { ...latest, baseRev: body.rev, dirty: latest.hash !== payloadHash(f, payload.content) });
  }
}

const payloadHash = (f: VaultFile, sent: string) => (f.kind === 'note' ? hashText(sent) : f.hash);

async function pull() {
  const since = (await db.get<number>('lastRev')) ?? 0;
  const res = await api(`/api/changes?since=${since}`);
  const { rev, changes } = (await res.json()) as { rev: number; changes: RemoteEntry[] };

  for (const entry of changes) {
    const local = vault().files[entry.path];
    // This device already has that revision, usually because it just uploaded it. Anything typed
    // since is newer, not a conflict, so leave it alone for the next upload.
    if (local && local.baseRev >= entry.rev) continue;
    if (entry.deleted) {
      if (!local) continue;
      if (local.dirty && !local.deleted) vault().putSynced(entry.path, { ...local, baseRev: 0 });
      else vault().putSynced(entry.path, null);
      continue;
    }
    if (local && !local.deleted && local.hash === entry.hash) {
      if (local.baseRev !== entry.rev || local.dirty) vault().putSynced(entry.path, { ...local, baseRev: entry.rev, dirty: false });
      continue;
    }
    const remote = await fetchRemoteFile(entry);
    const now = vault().files[entry.path];
    if (now && now.dirty && !now.deleted && now.hash !== remote.hash) saveConflictCopy(now);
    vault().putSynced(entry.path, remote);
  }
  await db.set('lastRev', rev);
}

let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (!enabled()) {
    useSync.setState({ status: 'off', message: '' });
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    useSync.setState({ status: 'syncing', message: '' });
    try {
      do {
        again = false;
        await push();
        await pull();
        if (Object.values(vault().files).some((f) => f.dirty)) await push();
      } while (again);
      useSync.setState({ status: 'idle', lastSync: Date.now(), message: '' });
    } catch (e) {
      const offline = !navigator.onLine || e instanceof TypeError;
      useSync.setState({
        status: offline ? 'offline' : 'error',
        message: offline ? 'Can’t reach the sync server' : (e as Error).message,
      });
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Forget sync history, e.g. after switching servers; every file is uploaded again. */
export async function resetSyncState() {
  await db.set('lastRev', 0);
  const files = vault().files;
  for (const f of Object.values(files)) {
    if (f.deleted) vault().putSynced(f.path, null);
    else vault().putSynced(f.path, { ...f, baseRev: 0, dirty: true });
  }
}

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  let debounce: ReturnType<typeof setTimeout>;
  useVault.subscribe((s, prev) => {
    if (s.files !== prev.files && enabled() && Object.values(s.files).some((f) => f.dirty)) {
      clearTimeout(debounce);
      debounce = setTimeout(syncNow, 2500);
    }
    if (s.settings.syncUrl !== prev.settings.syncUrl || s.settings.token !== prev.settings.token) void syncNow();
  });
  setInterval(() => document.visibilityState === 'visible' && syncNow(), 30_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  window.addEventListener('online', () => syncNow());
  void syncNow();
}

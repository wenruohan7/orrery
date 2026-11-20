import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useVault } from '../store/vault';
import { useUI, confirmDialog } from '../store/ui';
import { resetSyncState, syncNow, testConnection, useSync } from '../sync/sync';
import { relativeTime } from '../lib/dates';
import { hashBlob } from '../lib/hash';
import type { EditorMode } from '../store/types';
import { ATTACHMENT_EXT, isNote, isTrashed, normalizePath } from '../lib/paths';

export function SettingsModal() {
  const open = useUI((s) => s.settingsOpen);
  const set = useUI((s) => s.set);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={() => set({ settingsOpen: false })}>
      <div className="dialog settings" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="settings-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={() => set({ settingsOpen: false })} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>
        <SyncSettings />
        <VaultSettings />
        <ImportExport />
      </div>
    </div>
  );
}

function SyncSettings() {
  const settings = useVault((s) => s.settings);
  const update = useVault((s) => s.updateSettings);
  const { status, message, lastSync } = useSync();
  const [url, setUrl] = useState(settings.syncUrl);
  const [token, setToken] = useState(settings.token);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setResult('');
    try {
      const info = await testConnection(url, token);
      if (url.replace(/\/+$/, '') !== settings.syncUrl.replace(/\/+$/, '') && settings.syncUrl) await resetSyncState();
      update({ syncUrl: url.replace(/\/+$/, ''), token: token.trim() });
      setResult(`Connected. The server has ${info.files} file${info.files === 1 ? '' : 's'}.`);
      void syncNow();
    } catch (e) {
      setResult(e instanceof TypeError ? 'Can’t reach that address. Is the server running?' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>Sync</h3>
      <p className="muted small">
        Run the Orrery server on your Linux machine (<code>bun run start</code>) and paste the address and token it prints.
      </p>
      <label>
        Server address
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.5:8787" inputMode="url" autoCapitalize="off" autoCorrect="off" />
      </label>
      <label>
        Token
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="From the server's startup message" autoCapitalize="off" autoCorrect="off" type="password" />
      </label>
      <div className="row">
        <button className="btn primary" disabled={busy || !url || !token} onClick={save}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        {settings.token && (
          <button className="btn" onClick={() => syncNow()}>
            Sync now
          </button>
        )}
        {settings.token && (
          <button
            className="btn"
            onClick={() => {
              update({ token: '' });
              setToken('');
              setResult('Sync turned off. Your notes stay on this device.');
            }}
          >
            Turn off
          </button>
        )}
      </div>
      {result && <p className="small">{result}</p>}
      {settings.token && (
        <p className="muted small">
          Status: {status === 'syncing' ? 'syncing…' : status === 'idle' ? `synced ${lastSync ? relativeTime(lastSync) : ''}` : message || status}
        </p>
      )}
    </section>
  );
}

function VaultSettings() {
  const settings = useVault((s) => s.settings);
  const update = useVault((s) => s.updateSettings);
  const field = (key: 'dailyFolder' | 'dailyTemplate' | 'templateFolder' | 'attachmentFolder', label: string) => (
    <label>
      {label}
      <input value={settings[key]} onChange={(e) => update({ [key]: e.target.value })} autoCapitalize="off" />
    </label>
  );
  return (
    <section className="settings-section">
      <h3>Notes</h3>
      <div className="grid-2">
        {field('dailyFolder', 'Daily notes folder')}
        {field('dailyTemplate', 'Daily note template')}
        {field('templateFolder', 'Templates folder')}
        {field('attachmentFolder', 'Attachments folder')}
      </div>
      <label>
        Default view for notes
        <select value={settings.editorMode} onChange={(e) => update({ editorMode: e.target.value as EditorMode })}>
          <option value="live">Live preview</option>
          <option value="source">Source (raw markdown)</option>
          <option value="preview">Reading</option>
          <option value="split">Side by side (wide screens)</option>
        </select>
      </label>
    </section>
  );
}

function ImportExport() {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    folder.current?.setAttribute('webkitdirectory', '');
  }, []);

  const importFiles = async (list: FileList | null) => {
    const { createNote, files: existing, saveNote, putSynced } = useVault.getState();
    let count = 0;
    for (const file of list ?? []) {
      // Drop the picked folder's own name so "MyVault/Ideas/x.md" lands at "Ideas/x.md".
      const rel = normalizePath((file.webkitRelativePath || file.name).split('/').slice(file.webkitRelativePath ? 1 : 0).join('/'));
      if (!rel) continue;
      if (isNote(rel)) {
        const text = await file.text();
        if (existing[rel] && !existing[rel].deleted) saveNote(rel, text);
        else createNote(rel, text, false);
        count++;
      } else if (ATTACHMENT_EXT.test(rel)) {
        const prev = existing[rel];
        putSynced(rel, { path: rel, kind: 'binary', content: '', blob: file, hash: await hashBlob(file), mtime: Date.now(), baseRev: prev?.baseRev ?? 0, dirty: true, deleted: false });
        count++;
      }
    }
    setMsg(`Imported ${count} file${count === 1 ? '' : 's'}.`);
  };

  const exportVault = () => {
    const notes = Object.values(useVault.getState().files)
      .filter((f) => !f.deleted && f.kind === 'note' && !isTrashed(f.path))
      .map((f) => ({ path: f.path, content: f.content }));
    const blob = new Blob([JSON.stringify({ app: 'orrery', exported: new Date().toISOString(), notes }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orrery-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importBackup = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as { notes: { path: string; content: string }[] };
      const { createNote, files: existing, saveNote } = useVault.getState();
      for (const n of data.notes) {
        if (existing[n.path] && !existing[n.path].deleted) saveNote(n.path, n.content);
        else createNote(n.path, n.content, false);
      }
      setMsg(`Restored ${data.notes.length} notes.`);
    } catch {
      setMsg('That file is not an Orrery backup.');
    }
  };

  const backup = useRef<HTMLInputElement>(null);

  return (
    <section className="settings-section">
      <h3>Import and export</h3>
      <p className="muted small">Bring in an Obsidian vault or any markdown files. Folders are kept.</p>
      <div className="row wrap">
        <button className="btn" onClick={() => folder.current?.click()}>Import folder</button>
        <button className="btn" onClick={() => files.current?.click()}>Import files</button>
        <button className="btn" onClick={exportVault}>Export backup</button>
        <button className="btn" onClick={() => backup.current?.click()}>Restore backup</button>
      </div>
      <input ref={folder} type="file" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
      <input ref={files} type="file" multiple hidden accept=".md,image/*,audio/*,video/*,.pdf" onChange={(e) => void importFiles(e.target.files)} />
      <input ref={backup} type="file" hidden accept=".json,application/json" onChange={(e) => void importBackup(e.target.files)} />
      {msg && <p className="small">{msg}</p>}
      <h3 className="danger-title">Danger zone</h3>
      <button
        className="btn danger"
        onClick={async () => {
          if (await confirmDialog('Clear this device?', 'Removes every note stored on this device. Notes already on your sync server stay there and download again when you reconnect.', 'Clear device'))
            await useVault.getState().resetVault();
        }}
      >
        Clear notes on this device
      </button>
    </section>
  );
}

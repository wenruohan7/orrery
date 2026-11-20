import { useEffect, useMemo, useState } from 'react';
import { ArchiveRestore, History, Trash2, X } from 'lucide-react';
import { useVault, titleOf } from '../store/vault';
import { confirmDialog, useUI } from '../store/ui';
import { TRASH_DAYS, dirname, isNote, parseTrash } from '../lib/paths';
import { relativeTime } from '../lib/dates';
import { openNote } from '../lib/actions';
import { fetchHistory, fetchVersion, type Version } from '../sync/sync';
import { Preview } from './Preview';

function Modal({ title, icon, onClose, children, wide }: { title: string; icon: React.ReactNode; onClose(): void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className={`dialog sheet ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="settings-head">
          <h2>
            {icon} {title}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TrashModal() {
  const open = useUI((s) => s.trashOpen);
  const files = useVault((s) => s.files);
  const items = useMemo(
    () =>
      Object.values(files)
        .filter((f) => !f.deleted)
        .map((f) => ({ path: f.path, info: parseTrash(f.path) }))
        .filter((x): x is { path: string; info: { deletedAt: number; original: string } } => !!x.info)
        .sort((a, b) => b.info.deletedAt - a.info.deletedAt),
    [files],
  );
  if (!open) return null;
  const close = () => useUI.getState().set({ trashOpen: false });
  const { restore, remove, emptyTrash } = useVault.getState();

  return (
    <Modal title="Trash" icon={<Trash2 size={18} />} onClose={close}>
      <p className="muted small">Deleted notes and files stay here for {TRASH_DAYS} days on every synced device, then they’re removed for good.</p>
      {items.length === 0 && <p className="muted pad">The trash is empty.</p>}
      <div className="trash-list">
        {items.map(({ path, info }) => {
          const daysLeft = Math.max(0, Math.ceil(TRASH_DAYS - (Date.now() - info.deletedAt) / 86_400_000));
          return (
            <div key={path} className="trash-item">
              <div className="trash-text">
                <div className="hit-title">{titleOf(info.original)}</div>
                <div className="hit-path">
                  {dirname(info.original) || 'Vault root'} · deleted {relativeTime(info.deletedAt)} · {daysLeft} day{daysLeft === 1 ? '' : 's'} left
                </div>
              </div>
              <button
                className="btn small"
                onClick={() => {
                  const back = restore(path);
                  if (back && isNote(back)) {
                    close();
                    openNote(back);
                  }
                }}
              >
                <ArchiveRestore size={14} /> Restore
              </button>
              <button
                className="icon-btn small danger"
                title="Delete for good"
                aria-label="Delete for good"
                onClick={async () => {
                  if (await confirmDialog(`Delete "${titleOf(info.original)}" for good?`, 'This can’t be undone from the app.', 'Delete')) remove(path);
                }}
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
      {items.length > 0 && (
        <div className="dialog-actions">
          <button
            className="btn danger"
            onClick={async () => {
              if (await confirmDialog('Empty the trash?', `Deletes ${items.length} item${items.length === 1 ? '' : 's'} for good on every synced device.`, 'Empty trash'))
                emptyTrash();
            }}
          >
            Empty trash
          </button>
        </div>
      )}
    </Modal>
  );
}

export function HistoryModal() {
  const path = useUI((s) => s.historyPath);
  const current = useVault((s) => (path ? s.files[path]?.content ?? '' : ''));
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Version | null>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setVersions(null);
    setError('');
    setPicked(null);
    setText(null);
    if (!path) return;
    fetchHistory(path)
      .then(setVersions)
      .catch((e: Error) => setError(e.message));
  }, [path]);

  useEffect(() => {
    if (!path || !picked) return;
    setText(null);
    fetchVersion(path, picked.id)
      .then(setText)
      .catch((e: Error) => setError(e.message));
  }, [path, picked]);

  if (!path) return null;
  const close = () => useUI.getState().set({ historyPath: null });

  return (
    <Modal title={`History: ${titleOf(path)}`} icon={<History size={18} />} onClose={close} wide>
      {error && <p className="small">{error}</p>}
      {!error && versions === null && <p className="muted small">Loading versions…</p>}
      {versions && versions.length === 0 && (
        <p className="muted small">No saved versions yet. The server saves a snapshot about 20 seconds after changes sync.</p>
      )}
      {versions && versions.length > 0 && (
        <div className="history">
          <div className="history-list">
            {versions.map((v) => (
              <button key={v.id} className={`list-row ${picked?.id === v.id ? 'active' : ''}`} onClick={() => setPicked(v)}>
                <span className="name">{relativeTime(v.time)}</span>
                <span className="count">{new Date(v.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </button>
            ))}
          </div>
          <div className="history-preview">
            {!picked && <p className="muted small">Pick a version to see it.</p>}
            {picked && text === null && <p className="muted small">Loading…</p>}
            {picked && text !== null && (
              <>
                <div className="row wrap history-actions">
                  <span className="muted small">{text === current ? 'Same as the current note.' : text ? 'Saved ' + relativeTime(picked.time) : 'The note was deleted in this version.'}</span>
                  <span className="spacer" />
                  {text && text !== current && (
                    <button
                      className="btn primary small"
                      onClick={() => {
                        useVault.getState().saveNote(path, text);
                        close();
                      }}
                    >
                      Restore this version
                    </button>
                  )}
                </div>
                <Preview path={path} content={text} compact />
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

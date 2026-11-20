import { useEffect, useRef, useState } from 'react';
import {
  Bold, CalendarDays, CheckSquare, Code, Heading, Highlighter, History, ImagePlus, Italic, Link2, List, Orbit, Quote, Sparkles,
  SquarePen, Stamp,
} from 'lucide-react';
import { useVault } from '../store/vault';
import { useIndex } from '../store/vaultIndex';
import { useUI } from '../store/ui';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { resourceUrl } from './resources';
import { editorBridge, insertAtCursor, toggleLinePrefix, wrapSelection } from '../lib/editorBridge';
import { flyTo, newNote, openNote } from '../lib/actions';
import { createSampleVault } from '../lib/sample';
import { basename, dirname, isAudio, isImage, isNote, isPdf, isVideo, noteTitle } from '../lib/paths';
import { getIndex } from '../store/vaultIndex';
import { KIND_LABEL, useHierarchy } from '../lib/hierarchy';
import { KindDot } from './SpaceDialogs';

export function NoteView() {
  const path = useVault((s) => s.activePath);
  const file = useVault((s) => (path ? s.files[path] : undefined));
  if (!path || !file || file.deleted) return <EmptyState />;
  if (!isNote(path)) return <FileViewer path={path} />;
  return <NoteEditor key="editor" path={path} />;
}

function NoteEditor({ path }: { path: string }) {
  const mode = useVault((s) => s.settings.editorMode);
  const content = useVault((s) => s.files[path]?.content ?? '');
  const narrow = useNarrow();
  const effective = narrow && mode === 'split' ? 'live' : mode;
  const editing = effective !== 'preview';
  const previewing = effective === 'preview' || effective === 'split';

  return (
    <div className="note-view">
      <TitleBar path={path} />
      {editing && <EditorToolbar />}
      <div className={`note-body mode-${effective}`}>
        {editing && <Editor path={path} live={effective === 'live'} />}
        {previewing && (
          <div className="preview-scroll">
            <Preview path={path} content={content} />
          </div>
        )}
      </div>
      <StatusBar path={path} />
    </div>
  );
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

function TitleBar({ path }: { path: string }) {
  const [title, setTitle] = useState(noteTitle(path));
  const [error, setError] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setTitle(noteTitle(path));
    setError('');
  }, [path]);

  const commit = () => {
    const clean = title.trim();
    if (!clean || clean === noteTitle(path)) return setTitle(noteTitle(path));
    try {
      useVault.getState().rename(path, (dirname(path) ? dirname(path) + '/' : '') + clean);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="title-bar">
      {dirname(path) && <div className="breadcrumb">{dirname(path).split('/').join(' / ')}</div>}
      <input
        ref={ref}
        className="note-title"
        value={title}
        onChange={(e) => setTitle(e.target.value.replace(/[/\\:*?"<>|]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            editorBridge.view?.focus();
          }
          if (e.key === 'Escape') setTitle(noteTitle(path));
        }}
        aria-label="Note title"
      />
      {error && <div className="title-error">{error}</div>}
      <SpaceChip path={path} />
    </div>
  );
}

/** One-line summary of where the note sits in space; tap to change its orbit. */
function SpaceChip({ path }: { path: string }) {
  const node = useHierarchy().nodes.get(path);
  if (!node) return null;
  const label = KIND_LABEL[node.kind];
  const target = node.parent ?? node.orbitParent;
  return (
    <button
      className="space-chip"
      onClick={() => useUI.getState().set({ orbitPicker: node.kind === 'blackhole' ? null : path })}
      title={node.kind === 'blackhole' ? 'This note is a black hole' : 'Change what this note orbits'}
    >
      <KindDot kind={node.kind} />
      {label[0].toUpperCase() + label.slice(1)}
      {node.kind === 'blackhole' ? ' · heart of its galaxy' : target ? ` · orbits ${noteTitle(target)}` : ''}
      {node.kind === 'asteroid' && ' · tap to put it in orbit'}
    </button>
  );
}

function EditorToolbar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the editor's selection

  const attach = async (files: FileList | null) => {
    for (const file of files ?? []) {
      const path = await useVault.getState().saveAttachment(file.name, file);
      insertAtCursor(`![[${getIndex().linkText(path)}]]\n`);
    }
  };

  const tools = [
    { icon: Heading, label: 'Heading', run: () => toggleLinePrefix('## ', /^#{1,6} /) },
    { icon: Bold, label: 'Bold', run: () => wrapSelection('**') },
    { icon: Italic, label: 'Italic', run: () => wrapSelection('*') },
    { icon: Highlighter, label: 'Highlight', run: () => wrapSelection('==') },
    { icon: Link2, label: 'Link a note', run: () => wrapSelection('[[', ']]') },
    { icon: CheckSquare, label: 'Task', run: () => toggleLinePrefix('- [ ] ', /^\s*- \[[ xX]\] /) },
    { icon: List, label: 'List', run: () => toggleLinePrefix('- ', /^\s*- (?!\[)/) },
    { icon: Quote, label: 'Quote', run: () => toggleLinePrefix('> ', /^> ?/) },
    { icon: Code, label: 'Code', run: () => wrapSelection('`') },
    { icon: ImagePlus, label: 'Attach image or file', run: () => fileInput.current?.click() },
    { icon: Stamp, label: 'Insert template', run: () => useUI.getState().set({ palette: 'templates' }) },
  ];

  return (
    <div className="editor-toolbar" onMouseDown={keep}>
      {tools.map(({ icon: Icon, label, run }) => (
        <button key={label} className="icon-btn" title={label} aria-label={label} onClick={run}>
          <Icon size={17} />
        </button>
      ))}
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => void attach(e.target.files)} />
    </div>
  );
}

function StatusBar({ path }: { path: string }) {
  const index = useIndex();
  const info = index.byPath.get(path);
  if (!info) return null;
  const backlinks = index.backlinks.get(path)?.length ?? 0;
  const { words, tasks } = info.parsed;
  return (
    <div className="status-bar">
      <span>{words} words</span>
      <span>{backlinks} backlinks</span>
      {tasks.total > 0 && (
        <span>
          {tasks.done}/{tasks.total} tasks
        </span>
      )}
      <button className="link-btn" onClick={() => useUI.getState().set({ historyPath: path })}>
        <History size={13} /> History
      </button>
      <button className="link-btn" onClick={() => flyTo(path)}>
        <Orbit size={13} /> Find in space
      </button>
    </div>
  );
}

function FileViewer({ path }: { path: string }) {
  const url = resourceUrl(path);
  const backlinks = useIndex().backlinks.get(path) ?? [];
  return (
    <div className="note-view file-viewer">
      <div className="title-bar">
        <div className="breadcrumb">{dirname(path)}</div>
        <div className="note-title static">{basename(path)}</div>
      </div>
      <div className="file-body">
        {!url ? (
          <p className="muted">This file hasn't been downloaded yet. It will appear after the next sync.</p>
        ) : isImage(path) ? (
          <img src={url} alt={basename(path)} />
        ) : isAudio(path) ? (
          <audio controls src={url} />
        ) : isVideo(path) ? (
          <video controls playsInline src={url} />
        ) : isPdf(path) ? (
          <iframe src={url} title={basename(path)} />
        ) : (
          <a href={url} download={basename(path)}>
            Download {basename(path)}
          </a>
        )}
        {backlinks.length > 0 && (
          <div className="muted small">
            Used in:{' '}
            {backlinks.map((b) => (
              <button key={b} className="link-btn" onClick={() => openNote(b)}>
                {noteTitle(b)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  const hasNotes = useIndex().notes.length > 0;
  const openDaily = useVault((s) => s.openDaily);
  const setView = useUI((s) => s.setView);
  return (
    <div className="empty-state">
      <div className="empty-orbit" aria-hidden>
        <span className="sun" />
        <span className="ring r1"><i /></span>
        <span className="ring r2"><i /></span>
      </div>
      <h1>{hasNotes ? 'No note open' : 'Your vault is empty'}</h1>
      <p className="muted">{hasNotes ? 'Pick a note, or start a new one.' : 'Start writing, or explore a sample vault first.'}</p>
      <div className="empty-actions">
        <button className="btn primary" onClick={() => newNote()}>
          <SquarePen size={16} /> New note
        </button>
        <button className="btn" onClick={() => openNote(openDaily())}>
          <CalendarDays size={16} /> Today's note
        </button>
        {hasNotes ? (
          <button className="btn" onClick={() => setView('solar')}>
            <Orbit size={16} /> Solar system
          </button>
        ) : (
          <button className="btn" onClick={createSampleVault}>
            <Sparkles size={16} /> Create sample vault
          </button>
        )}
      </div>
    </div>
  );
}

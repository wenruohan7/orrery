import { useEffect, useMemo, useRef, useState } from 'react';
import { useVault } from '../store/vault';
import { getIndex, useIndex } from '../store/vaultIndex';
import { useUI } from '../store/ui';
import { fuzzyScore } from '../lib/fuzzy';
import { deleteFile, flyTo, insertTemplate, newFolder, newNote, openNote, openRandom, renameFile, templates } from '../lib/actions';
import { syncNow } from '../sync/sync';
import { createSampleVault } from '../lib/sample';
import type { EditorMode } from '../store/types';

export interface Command {
  id: string;
  name: string;
  keys?: string;
  /** Only shown when a note is open. */
  needsNote?: boolean;
  run(): void;
}

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const active = () => useVault.getState().activePath;

export function cycleEditorMode() {
  const { settings, updateSettings } = useVault.getState();
  const next: Record<EditorMode, EditorMode> = { live: 'preview', source: 'preview', preview: 'live', split: 'live' };
  updateSettings({ editorMode: next[settings.editorMode] });
}

export const COMMANDS: Command[] = [
  { id: 'new', name: 'New note', keys: `${mod} Alt N`, run: () => newNote() },
  { id: 'folder', name: 'New folder', run: () => newFolder() },
  { id: 'daily', name: "Open today's note", keys: `${mod} Shift D`, run: () => openNote(useVault.getState().openDaily()) },
  { id: 'switch', name: 'Quick switcher: open a note', keys: `${mod} O`, run: () => useUI.getState().set({ palette: 'switcher' }) },
  { id: 'template', name: 'Insert template', needsNote: true, run: () => useUI.getState().set({ palette: 'templates' }) },
  { id: 'mode', name: 'Toggle edit / reading view', keys: `${mod} E`, needsNote: true, run: cycleEditorMode },
  { id: 'source', name: 'Toggle source mode (raw markdown)', needsNote: true, run: () => { const { settings, updateSettings } = useVault.getState(); updateSettings({ editorMode: settings.editorMode === 'source' ? 'live' : 'source' }); } },
  { id: 'split', name: 'Split editor and preview', needsNote: true, run: () => useVault.getState().updateSettings({ editorMode: 'split' }) },
  { id: 'solar', name: 'Open solar system', keys: `${mod} Shift S`, run: () => useUI.getState().setView('solar') },
  { id: 'fly', name: 'Find this note in the solar system', needsNote: true, run: () => flyTo(active()!) },
  { id: 'graph', name: 'Open graph view', keys: `${mod} G`, run: () => useUI.getState().setView('graph') },
  { id: 'search', name: 'Search all notes', keys: `${mod} Shift F`, run: () => useUI.getState().set({ leftOpen: true, leftTab: 'search' }) },
  { id: 'star', name: 'Star / unstar this note', needsNote: true, run: () => useVault.getState().toggleBookmark(active()!) },
  { id: 'rename', name: 'Rename or move this note', needsNote: true, run: () => renameFile(active()!) },
  { id: 'delete', name: 'Delete this note', needsNote: true, run: () => deleteFile(active()!) },
  { id: 'history', name: 'Version history of this note', needsNote: true, run: () => useUI.getState().set({ historyPath: active() }) },
  { id: 'trash', name: 'Open trash', run: () => useUI.getState().set({ trashOpen: true }) },
  { id: 'random', name: 'Open a random note', run: openRandom },
  { id: 'back', name: 'Go back', keys: 'Alt ←', run: () => useVault.getState().goBack() },
  { id: 'forward', name: 'Go forward', keys: 'Alt →', run: () => useVault.getState().goForward() },
  { id: 'left', name: 'Toggle left sidebar', keys: `${mod} \\`, run: () => useUI.getState().set({ leftOpen: !useUI.getState().leftOpen }) },
  { id: 'right', name: 'Toggle right sidebar', run: () => useUI.getState().set({ rightOpen: !useUI.getState().rightOpen }) },
  { id: 'sync', name: 'Sync now', run: () => void syncNow() },
  { id: 'sample', name: 'Add sample notes', run: createSampleVault },
  { id: 'settings', name: 'Open settings', keys: `${mod} ,`, run: () => useUI.getState().set({ settingsOpen: true }) },
];

interface Item {
  key: string;
  label: string;
  detail?: string;
  run(): void;
}

export function CommandPalette() {
  const mode = useUI((s) => s.palette);
  const set = useUI((s) => s.set);
  const index = useIndex();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery('');
    setSelected(0);
    if (mode) setTimeout(() => input.current?.focus(), 0);
  }, [mode]);

  const items = useMemo<Item[]>(() => {
    if (!mode) return [];
    const close = (fn: () => void) => () => {
      set({ palette: null });
      fn();
    };
    let base: (Item & { text: string })[];
    if (mode === 'commands') {
      base = COMMANDS.filter((c) => !c.needsNote || active()).map((c) => ({ key: c.id, label: c.name, detail: c.keys, text: c.name, run: close(c.run) }));
    } else if (mode === 'templates') {
      base = templates().map((n) => ({ key: n.path, label: n.title, detail: n.folder, text: n.title, run: close(() => insertTemplate(n.path)) }));
    } else {
      base = [...index.notes]
        .sort((a, b) => b.mtime - a.mtime)
        .map((n) => ({ key: n.path, label: n.title, detail: n.folder, text: n.path.replace(/\.md$/, ''), run: close(() => openNote(n.path)) }));
    }
    const q = query.trim();
    const scored = q
      ? base
          .map((it) => ({ it, s: fuzzyScore(q, it.text) }))
          .filter((x) => x.s !== null)
          .sort((a, b) => b.s! - a.s!)
          .map((x) => x.it)
      : base;
    const result: Item[] = scored.slice(0, 80);
    if (mode === 'switcher' && q && !getIndex().resolve(q)) {
      result.push({ key: '__create', label: `Create "${q}"`, detail: 'Shift ↵', run: close(() => openNote(useVault.getState().createNote(q))) });
    }
    return result;
  }, [mode, query, index, set]);

  useEffect(() => {
    list.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!mode) return null;
  const placeholder = { commands: 'Type a command…', switcher: 'Find or create a note…', templates: 'Pick a template…' }[mode];

  return (
    <div className="overlay" onMouseDown={() => set({ palette: null })}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const create = items.find((i) => i.key === '__create');
              (e.shiftKey && create ? create : items[selected])?.run();
            } else if (e.key === 'Escape') set({ palette: null });
          }}
        />
        <div className="palette-list" ref={list}>
          {items.length === 0 && (
            <div className="muted pad small">
              {mode === 'templates' ? `No templates. Add notes to the "${useVault.getState().settings.templateFolder}" folder.` : 'Nothing found.'}
            </div>
          )}
          {items.map((it, i) => (
            <button
              key={it.key}
              className={`palette-item ${i === selected ? 'selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={it.run}
            >
              <span>{it.label}</span>
              {it.detail && <span className="detail">{it.detail}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

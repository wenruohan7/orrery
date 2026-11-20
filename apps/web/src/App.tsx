import { Suspense, lazy, useEffect } from 'react';
import {
  ArrowLeft, ArrowRight, BookOpen, Columns2, Command, Network, NotebookPen, Orbit, PanelLeft, PanelRight, PencilLine,
} from 'lucide-react';
import { useVault } from './store/vault';
import { useUI, type View } from './store/ui';
import { Sidebar } from './components/Sidebar';
import { NoteView } from './components/NoteView';
import { RightPanel } from './components/RightPanel';
import { COMMANDS, CommandPalette, cycleEditorMode } from './components/CommandPalette';
import { DialogHost } from './components/Dialogs';
import { SettingsModal } from './components/SettingsModal';
import { startSync } from './sync/sync';
import { titleOf } from './store/vault';

const SolarView = lazy(() => import('./components/solar/SolarView'));
const GraphView = lazy(() => import('./components/GraphView'));

export default function App() {
  const ready = useVault((s) => s.ready);
  const { view, leftOpen, rightOpen } = useUI();

  useEffect(() => {
    void useVault.getState().load().then(startSync);
  }, []);
  useShortcuts();

  if (!ready) return <div className="splash"><span className="brand-mark big" /></div>;

  return (
    <div className={`app view-${view} ${leftOpen ? 'left-open' : ''} ${rightOpen && view === 'note' ? 'right-open' : ''}`}>
      <Sidebar />
      <main className="main">
        <TopBar />
        <div className="main-body">
          {view === 'note' && <NoteView />}
          <Suspense fallback={<div className="loading">Loading…</div>}>
            {view === 'solar' && <SolarView />}
            {view === 'graph' && <GraphView />}
          </Suspense>
        </div>
      </main>
      {view === 'note' && <RightPanel />}
      <div className="scrim" onClick={() => useUI.getState().set({ leftOpen: false, rightOpen: false })} />
      <CommandPalette />
      <DialogHost />
      <SettingsModal />
    </div>
  );
}

const VIEWS: { id: View; icon: typeof Orbit; label: string }[] = [
  { id: 'note', icon: NotebookPen, label: 'Notes' },
  { id: 'solar', icon: Orbit, label: 'Solar system' },
  { id: 'graph', icon: Network, label: 'Graph' },
];

function TopBar() {
  const { view, setView, set, leftOpen, rightOpen } = useUI();
  const active = useVault((s) => s.activePath);
  const mode = useVault((s) => s.settings.editorMode);
  const { goBack, goForward, back, forward } = useVault();

  return (
    <header className="top-bar">
      <button className="icon-btn" onClick={() => set({ leftOpen: !leftOpen })} aria-label="Toggle sidebar" title="Sidebar">
        <PanelLeft size={18} />
      </button>
      {view === 'note' && (
        <div className="nav-arrows">
          <button className="icon-btn" disabled={!back.length} onClick={goBack} aria-label="Back" title="Back">
            <ArrowLeft size={17} />
          </button>
          <button className="icon-btn" disabled={!forward.length} onClick={goForward} aria-label="Forward" title="Forward">
            <ArrowRight size={17} />
          </button>
        </div>
      )}
      <div className="top-title">{view === 'note' ? (active ? titleOf(active) : '') : view === 'solar' ? 'Solar system' : 'Graph'}</div>
      <div className="segmented" role="tablist">
        {VIEWS.map(({ id, icon: Icon, label }) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)} title={label} aria-label={label}>
            <Icon size={16} />
          </button>
        ))}
      </div>
      {view === 'note' && active && (
        <>
          <button className="icon-btn" onClick={cycleEditorMode} title={mode === 'preview' ? 'Edit' : 'Read'} aria-label="Toggle reading view">
            {mode === 'preview' ? <PencilLine size={18} /> : <BookOpen size={18} />}
          </button>
          <button
            className={`icon-btn hide-narrow ${mode === 'split' ? 'on' : ''}`}
            onClick={() => useVault.getState().updateSettings({ editorMode: mode === 'split' ? 'edit' : 'split' })}
            title="Side by side"
            aria-label="Side by side"
          >
            <Columns2 size={18} />
          </button>
        </>
      )}
      <button className="icon-btn hide-narrow" onClick={() => set({ palette: 'commands' })} title="Command palette" aria-label="Command palette">
        <Command size={17} />
      </button>
      {view === 'note' && (
        <button className="icon-btn" onClick={() => set({ rightOpen: !rightOpen })} aria-label="Toggle links panel" title="Links panel">
          <PanelRight size={18} />
        </button>
      )}
    </header>
  );
}

function useShortcuts() {
  useEffect(() => {
    const run = (id: string) => COMMANDS.find((c) => c.id === id)?.run();
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === 'Escape' && useUI.getState().palette) return useUI.getState().set({ palette: null });
      if (e.altKey && !mod && e.key === 'ArrowLeft') return run('back');
      if (e.altKey && !mod && e.key === 'ArrowRight') return run('forward');
      if (!mod) return;
      const combo = `${e.shiftKey ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${key}`;
      const map: Record<string, () => void> = {
        p: () => useUI.getState().set({ palette: 'commands' }),
        o: () => useUI.getState().set({ palette: 'switcher' }),
        'alt+n': () => run('new'),
        'alt+˜': () => run('new'),
        e: cycleEditorMode,
        'shift+d': () => run('daily'),
        'shift+s': () => run('solar'),
        g: () => run('graph'),
        'shift+f': () => run('search'),
        '\\': () => run('left'),
        ',': () => run('settings'),
      };
      const action = map[combo];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

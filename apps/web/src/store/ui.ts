import { create } from 'zustand';

export type View = 'note' | 'solar' | 'graph';
export type LeftTab = 'files' | 'search' | 'tags' | 'starred';
export type PaletteMode = 'commands' | 'switcher' | 'templates';

export interface MenuItem {
  label: string;
  danger?: boolean;
}

type Dialog =
  | { kind: 'prompt'; title: string; value: string; placeholder?: string; confirm: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; confirm: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'menu'; title: string; items: MenuItem[]; resolve: (v: number | null) => void };

interface UIState {
  view: View;
  leftOpen: boolean;
  rightOpen: boolean;
  leftTab: LeftTab;
  search: string;
  palette: PaletteMode | null;
  settingsOpen: boolean;
  dialog: Dialog | null;
  collapsed: string[];
  /** Note the solar view should fly to when it opens. */
  solarFocus: string | null;
  setView(view: View): void;
  set(patch: Partial<Omit<UIState, 'set' | 'setView' | 'toggleCollapsed'>>): void;
  toggleCollapsed(folder: string): void;
}

export const isNarrow = () => window.matchMedia('(max-width: 820px)').matches;

const stored = (() => {
  try {
    return JSON.parse(localStorage.getItem('orrery-ui') ?? '{}');
  } catch {
    return {};
  }
})();

export const useUI = create<UIState>((set, get) => ({
  view: stored.view === 'graph' || stored.view === 'solar' ? stored.view : 'note',
  leftOpen: !isNarrow() && stored.leftOpen !== false,
  rightOpen: !isNarrow() && stored.rightOpen !== false,
  leftTab: 'files',
  search: '',
  palette: null,
  settingsOpen: false,
  dialog: null,
  collapsed: Array.isArray(stored.collapsed) ? stored.collapsed : [],
  solarFocus: null,
  setView(view) {
    set({ view, ...(isNarrow() ? { leftOpen: false, rightOpen: false } : {}) });
  },
  set(patch) {
    set(patch);
  },
  toggleCollapsed(folder) {
    const c = get().collapsed;
    set({ collapsed: c.includes(folder) ? c.filter((f) => f !== folder) : [...c, folder] });
  },
}));

useUI.subscribe((s) => {
  try {
    localStorage.setItem(
      'orrery-ui',
      JSON.stringify({ view: s.view, leftOpen: s.leftOpen, rightOpen: s.rightOpen, collapsed: s.collapsed }),
    );
  } catch {
    /* storage unavailable */
  }
});

export function ask(title: string, value = '', confirm = 'OK', placeholder?: string) {
  return new Promise<string | null>((resolve) =>
    useUI.getState().set({ dialog: { kind: 'prompt', title, value, confirm, placeholder, resolve } }),
  );
}

export function confirmDialog(title: string, message: string, confirm = 'Delete', danger = true) {
  return new Promise<boolean>((resolve) =>
    useUI.getState().set({ dialog: { kind: 'confirm', title, message, confirm, danger, resolve } }),
  );
}

export function menu(title: string, items: MenuItem[]) {
  return new Promise<number | null>((resolve) => useUI.getState().set({ dialog: { kind: 'menu', title, items, resolve } }));
}

/** Close drawers after navigating on phones. */
export function closeDrawersOnNarrow() {
  if (isNarrow()) useUI.getState().set({ leftOpen: false, rightOpen: false });
}

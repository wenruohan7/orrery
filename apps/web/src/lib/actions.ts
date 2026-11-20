import { useVault, titleOf } from '../store/vault';
import { getIndex } from '../store/vaultIndex';
import { ask, closeDrawersOnNarrow, confirmDialog, menu, useUI } from '../store/ui';
import { basename, dirname, isNote, joinPath, noteTitle } from './paths';
import { applyTemplate } from './dates';
import { setProperties } from './markdown';
import { CHILD_KIND, KIND_LABEL, ORBITS_PROP, computeHierarchy } from './hierarchy';
import { insertAtCursor } from './editorBridge';

const vault = () => useVault.getState();

export function openNote(path: string) {
  vault().open(path);
  useUI.getState().setView('note');
  closeDrawersOnNarrow();
}

/** Follow a [[link]]: open it, or create the note if it doesn't exist yet. */
export function openOrCreate(target: string) {
  const existing = getIndex().resolve(target);
  openNote(existing ?? vault().createNote(target, '', false));
}

/** Opens the New note dialog, which also asks what the note should orbit. */
export function newNote(folder = '', orbit?: string) {
  useUI.getState().set({ newNote: { folder, orbit } });
}

/** Put a note in orbit around `target` (null: let links decide again). */
export function setOrbit(path: string, target: string | null) {
  const file = vault().files[path];
  if (!file) return;
  const value = target ? `"[[${getIndex().linkText(target)}]]"` : null;
  vault().saveNote(path, setProperties(file.content, { [ORBITS_PROP]: value }));
}

/** Create a note already orbiting `parent`, in the parent's folder so it joins the same galaxy. */
export function createInOrbit(name: string, parent: string | null, folder = '') {
  const clean = name.trim() || 'Untitled';
  if (!parent) return vault().createNote(joinPath(folder, clean), `# ${basename(clean)}\n\n`, false);
  const content = `---\n${ORBITS_PROP}: "[[${getIndex().linkText(parent)}]]"\n---\n# ${basename(clean)}\n\n`;
  return vault().createNote(joinPath(dirname(parent), basename(clean)), content, false);
}

export async function newFolder(parent = '') {
  const name = (await ask('New folder', '', 'Create', 'Folder name'))?.trim();
  if (!name) return;
  // A folder note shares the folder's name and becomes that star system's sun.
  openNote(vault().createNote(joinPath(parent, name, name), `# ${name}\n\n`));
}

export async function renameFile(path: string) {
  const isMd = isNote(path);
  const current = isMd ? path.replace(/\.md$/i, '') : path;
  const next = await ask('Rename or move', current, 'Rename');
  if (next == null || next === current) return;
  try {
    vault().rename(path, next);
  } catch (e) {
    await confirmDialog('Could not rename', (e as Error).message, 'OK', false);
  }
}

export async function deleteFile(path: string) {
  if (await confirmDialog(`Delete "${titleOf(path)}"?`, 'It moves to the trash on every synced device. You can restore it for 30 days.', 'Move to trash'))
    vault().remove(path);
}

export async function renameFolder(folder: string) {
  const next = await ask('Rename folder', folder, 'Rename');
  if (next && next !== folder) vault().renameFolder(folder, next);
}

export async function fileMenu(path: string) {
  const starred = vault().bookmarks.includes(path);
  const items = [
    { label: 'Open' },
    { label: 'Show in solar system' },
    { label: starred ? 'Unstar' : 'Star' },
    { label: 'Rename or move…' },
    { label: 'Version history' },
    { label: 'Delete', danger: true },
  ];
  switch (await menu(titleOf(path), items)) {
    case 0: return openNote(path);
    case 1: return flyTo(path);
    case 2: return vault().toggleBookmark(path);
    case 3: return renameFile(path);
    case 4: return useUI.getState().set({ historyPath: path });
    case 5: return deleteFile(path);
  }
}

export async function folderMenu(folder: string) {
  const items = [{ label: 'New note here' }, { label: 'New subfolder' }, { label: 'Rename folder…' }, { label: 'Delete folder', danger: true }];
  switch (await menu(basename(folder), items)) {
    case 0: return newNote(folder);
    case 1: return newFolder(folder);
    case 2: return renameFolder(folder);
    case 3:
      if (await confirmDialog(`Delete folder "${folder}"?`, 'Everything inside moves to the trash on every synced device. You can restore it for 30 days.', 'Move to trash'))
        vault().removeFolder(folder);
  }
}

export function flyTo(path: string) {
  useUI.getState().set({ solarFocus: path });
  useUI.getState().setView('solar');
  closeDrawersOnNarrow();
}

export function searchFor(query: string) {
  useUI.getState().set({ search: query, leftTab: 'search', leftOpen: true });
}

export function templates() {
  const folder = vault().settings.templateFolder;
  return getIndex().notes.filter((n) => n.folder === folder || n.folder.startsWith(folder + '/'));
}

export function insertTemplate(path: string) {
  const tpl = vault().files[path];
  const active = vault().activePath;
  if (!tpl || !active) return;
  const text = applyTemplate(tpl.content, noteTitle(active));
  if (!insertAtCursor(text)) {
    const cur = vault().files[active]?.content ?? '';
    vault().saveNote(active, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + text);
  }
}

/** Create a new star, planet or moon orbiting `from`. Returns its path, or null if cancelled. */
export async function addLinkedNote(from: string) {
  const kind = computeHierarchy(getIndex()).nodes.get(from)?.kind;
  const child = (kind && CHILD_KIND[kind]) ?? 'moon';
  const name = (await ask(`New ${KIND_LABEL[child]} orbiting "${titleOf(from)}"`, '', 'Create', 'Note name'))?.trim();
  if (!name) return null;
  return createInOrbit(name, from);
}

export function openRandom() {
  const notes = getIndex().notes;
  if (notes.length) openNote(notes[Math.floor(Math.random() * notes.length)].path);
}

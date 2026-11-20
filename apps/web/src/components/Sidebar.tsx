import { useMemo, useState, type DragEvent } from 'react';
import {
  CalendarDays, ChevronDown, ChevronRight, File, FileText, Files, FolderClosed, FolderOpen, FolderPlus, Hash,
  MoreHorizontal, Search, Settings, SquarePen, Star,
} from 'lucide-react';
import { useVault } from '../store/vault';
import { useIndex } from '../store/vaultIndex';
import { useUI, type LeftTab } from '../store/ui';
import { fileMenu, folderMenu, newFolder, newNote, openNote, searchFor } from '../lib/actions';
import { basename, dirname, isNote, noteTitle } from '../lib/paths';
import { SyncBadge } from './SyncBadge';
import { SearchPanel } from './SearchPanel';

interface TreeNode {
  name: string;
  path: string;
  folder: boolean;
  children: TreeNode[];
}

function buildTree(paths: string[], folders: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', folder: true, children: [] };
  const lookup = new Map<string, TreeNode>([['', root]]);
  const ensureFolder = (path: string): TreeNode => {
    const hit = lookup.get(path);
    if (hit) return hit;
    const node: TreeNode = { name: basename(path), path, folder: true, children: [] };
    ensureFolder(dirname(path)).children.push(node);
    lookup.set(path, node);
    return node;
  };
  folders.forEach(ensureFolder);
  for (const p of paths) ensureFolder(dirname(p)).children.push({ name: basename(p), path: p, folder: false, children: [] });
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

const TABS: { id: LeftTab; icon: typeof Files; label: string }[] = [
  { id: 'files', icon: Files, label: 'Files' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'tags', icon: Hash, label: 'Tags' },
  { id: 'starred', icon: Star, label: 'Starred' },
];

export function Sidebar() {
  const tab = useUI((s) => s.leftTab);
  const set = useUI((s) => s.set);
  const openDaily = useVault((s) => s.openDaily);

  return (
    <aside className="sidebar left">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark" />
          Orrery
        </div>
        <SyncBadge />
      </div>
      <div className="sidebar-actions">
        <button className="icon-btn" title="New note" onClick={() => newNote()}>
          <SquarePen size={18} />
        </button>
        <button className="icon-btn" title="New folder" onClick={() => newFolder()}>
          <FolderPlus size={18} />
        </button>
        <button
          className="icon-btn"
          title="Today's note"
          onClick={() => openNote(openDaily())}
        >
          <CalendarDays size={18} />
        </button>
        <span className="spacer" />
        <button className="icon-btn" title="Settings" onClick={() => set({ settingsOpen: true })}>
          <Settings size={18} />
        </button>
      </div>
      <nav className="tabs">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => set({ leftTab: id })} title={label}>
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-body">
        {tab === 'files' && <FileTree />}
        {tab === 'search' && <SearchPanel />}
        {tab === 'tags' && <TagsPanel />}
        {tab === 'starred' && <StarredPanel />}
      </div>
    </aside>
  );
}

function FileTree() {
  const files = useVault((s) => s.files);
  const index = useIndex();
  const tree = useMemo(
    () => buildTree(Object.values(files).filter((f) => !f.deleted).map((f) => f.path), index.folders),
    [files, index.folders],
  );
  if (!tree.children.length) return <p className="muted pad">No notes yet.</p>;
  return (
    <div
      className="tree"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => dropInto(e, '')}
    >
      {tree.children.map((n) => (
        <TreeItem key={n.path} node={n} depth={0} />
      ))}
    </div>
  );
}

function dropInto(e: DragEvent, folder: string) {
  const path = e.dataTransfer.getData('text/x-orrery-path');
  if (!path) return;
  e.preventDefault();
  e.stopPropagation();
  const target = folder ? `${folder}/${basename(path)}` : basename(path);
  if (target === path || target.startsWith(path + '/')) return;
  const { rename, renameFolder, files } = useVault.getState();
  try {
    if (files[path]) rename(path, target);
    else renameFolder(path, target);
  } catch (err) {
    alert((err as Error).message);
  }
}

function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const active = useVault((s) => s.activePath === node.path);
  const collapsed = useUI((s) => s.collapsed.includes(node.path));
  const toggle = useUI((s) => s.toggleCollapsed);
  const [over, setOver] = useState(false);
  const pad = { paddingLeft: 10 + depth * 14 };

  const drag = {
    draggable: true,
    onDragStart: (e: DragEvent) => e.dataTransfer.setData('text/x-orrery-path', node.path),
  };

  if (node.folder) {
    return (
      <div>
        <div
          className={`tree-row folder ${over ? 'drop' : ''}`}
          style={pad}
          onClick={() => toggle(node.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            void folderMenu(node.path);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            setOver(false);
            dropInto(e, node.path);
          }}
          {...drag}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          {collapsed ? <FolderClosed size={15} /> : <FolderOpen size={15} />}
          <span className="name">{node.name}</span>
          <button
            className="row-more"
            onClick={(e) => {
              e.stopPropagation();
              void folderMenu(node.path);
            }}
            aria-label="Folder actions"
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
        {!collapsed && node.children.map((c) => <TreeItem key={c.path} node={c} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <div
      className={`tree-row ${active ? 'active' : ''}`}
      style={pad}
      onClick={() => openNote(node.path)}
      onContextMenu={(e) => {
        e.preventDefault();
        void fileMenu(node.path);
      }}
      {...drag}
    >
      <span className="chev-space" />
      {isNote(node.path) ? <FileText size={15} /> : <File size={15} />}
      <span className="name">{isNote(node.path) ? noteTitle(node.path) : node.name}</span>
      <button
        className="row-more"
        onClick={(e) => {
          e.stopPropagation();
          void fileMenu(node.path);
        }}
        aria-label="Note actions"
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}

function TagsPanel() {
  const index = useIndex();
  const tags = [...index.tags.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (!tags.length) return <p className="muted pad">No tags yet. Type #tag in a note.</p>;
  return (
    <div className="list">
      {tags.map(([tag, paths]) => (
        <button key={tag} className="list-row" onClick={() => searchFor(`#${tag}`)}>
          <Hash size={14} />
          <span className="name">{tag}</span>
          <span className="count">{paths.length}</span>
        </button>
      ))}
    </div>
  );
}

function StarredPanel() {
  const bookmarks = useVault((s) => s.bookmarks);
  if (!bookmarks.length) return <p className="muted pad">Star notes from their ⋯ menu to keep them here.</p>;
  return (
    <div className="list">
      {bookmarks.map((p) => (
        <button key={p} className="list-row" onClick={() => openNote(p)}>
          <Star size={14} />
          <span className="name">{noteTitle(p)}</span>
          <span className="count">{dirname(p)}</span>
        </button>
      ))}
    </div>
  );
}

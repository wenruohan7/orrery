import { useMemo } from 'react';
import { parseNote, type ParsedNote } from '../lib/markdown';
import { CONFIG_PATH, basename, dirname, isNote, isTrashed, noteTitle, stripMd } from '../lib/paths';
import type { VaultFile } from './types';
import { useVault } from './vault';

export interface NoteInfo {
  path: string;
  title: string;
  folder: string;
  content: string;
  mtime: number;
  parsed: ParsedNote;
  /** Resolved, de-duplicated paths this note links or embeds. */
  outLinks: string[];
  /** Link targets that don't exist yet. */
  unresolved: string[];
}

export interface VaultIndex {
  notes: NoteInfo[];
  byPath: Map<string, NoteInfo>;
  attachments: string[];
  backlinks: Map<string, string[]>;
  tags: Map<string, string[]>;
  folders: string[];
  resolve(target: string): string | null;
  /** Shortest unambiguous link text for a path. */
  linkText(path: string): string;
}

const parseCache = new Map<string, { content: string; parsed: ParsedNote }>();

function parsed(file: VaultFile) {
  const hit = parseCache.get(file.path);
  if (hit && hit.content === file.content) return hit.parsed;
  const p = parseNote(file.content);
  parseCache.set(file.path, { content: file.content, parsed: p });
  return p;
}

export function makeResolver(paths: string[]) {
  const exact = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of paths) {
    const lower = p.toLowerCase();
    exact.set(lower, p);
    if (isNote(p)) exact.set(stripMd(lower), p);
    const name = (isNote(p) ? noteTitle(p) : basename(p)).toLowerCase();
    const list = byName.get(name) ?? [];
    list.push(p);
    byName.set(name, list);
  }
  for (const list of byName.values()) list.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

  const resolve = (target: string) => {
    const t = target.trim().replace(/^\/+/, '').toLowerCase();
    if (!t) return null;
    return exact.get(t) ?? byName.get(t)?.[0] ?? byName.get(stripMd(t))?.[0] ?? null;
  };
  const linkText = (path: string) => {
    const name = isNote(path) ? noteTitle(path) : basename(path);
    return (byName.get(name.toLowerCase())?.length ?? 0) > 1 ? (isNote(path) ? stripMd(path) : path) : name;
  };
  return { resolve, linkText };
}

export function buildIndex(files: Record<string, VaultFile>): VaultIndex {
  const live = Object.values(files).filter((f) => !f.deleted && !isTrashed(f.path));
  const { resolve, linkText } = makeResolver(live.map((f) => f.path));

  const notes: NoteInfo[] = [];
  const attachments: string[] = [];
  const backlinks = new Map<string, string[]>();
  const tags = new Map<string, string[]>();
  const folders = new Set<string>();

  for (const f of live) {
    for (let d = dirname(f.path); d; d = dirname(d)) folders.add(d);
    if (f.kind !== 'note') {
      if (f.path !== CONFIG_PATH) attachments.push(f.path);
      continue;
    }
    const p = parsed(f);
    const out = new Set<string>();
    const unresolved = new Set<string>();
    for (const l of p.links) {
      const r = resolve(l.target);
      if (r) {
        if (r !== f.path) out.add(r);
      } else unresolved.add(l.target);
    }
    for (const target of out) {
      const list = backlinks.get(target) ?? [];
      list.push(f.path);
      backlinks.set(target, list);
    }
    for (const t of p.tags) {
      const list = tags.get(t) ?? [];
      list.push(f.path);
      tags.set(t, list);
    }
    notes.push({
      path: f.path,
      title: noteTitle(f.path),
      folder: dirname(f.path),
      content: f.content,
      mtime: f.mtime,
      parsed: p,
      outLinks: [...out],
      unresolved: [...unresolved],
    });
  }
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return {
    notes,
    byPath: new Map(notes.map((n) => [n.path, n])),
    attachments: attachments.sort(),
    backlinks,
    tags,
    folders: [...folders].sort(),
    resolve,
    linkText,
  };
}

let lastFiles: Record<string, VaultFile> | null = null;
let lastIndex: VaultIndex | null = null;

/** Index for the current store state; shared between all callers. */
export function getIndex(files = useVault.getState().files) {
  if (files !== lastFiles || !lastIndex) {
    lastIndex = buildIndex(files);
    lastFiles = files;
  }
  return lastIndex;
}

export function useIndex() {
  const files = useVault((s) => s.files);
  return useMemo(() => getIndex(files), [files]);
}

/** Changes only when notes, folders or links change, not on every keystroke. */
export function structureKey(index: VaultIndex) {
  return index.notes
    .map((n) => `${n.path}>${n.outLinks.join(',')}#${n.parsed.tags[0] ?? ''}@${String(n.parsed.frontmatter['orrery-orbits'] ?? '')}`)
    .join('\n');
}

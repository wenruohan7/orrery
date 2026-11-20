import { useMemo } from 'react';
import { structureKey, useIndex, type NoteInfo, type VaultIndex } from '../store/vaultIndex';
import { topFolder } from './paths';

/**
 * Who orbits whom. Kept free of three.js so the note view can show a note's place
 * in space without loading the 3D engine.
 *
 * Each top-level folder is a galaxy. Its core (black hole) is the folder note, or the
 * most linked note. A note's "Orbits" property (orrery-orbits) puts it around a chosen
 * body; otherwise links decide: linked from the core = star, from a star = planet,
 * from a planet = moon.
 */

export type SpaceKind = 'blackhole' | 'star' | 'planet' | 'moon' | 'asteroid';

export interface SpaceNode {
  path: string;
  kind: SpaceKind;
  galaxy: number;
  /** The body this note was attached to (by its Orbits property or a link). */
  parent: string | null;
  /** The body it physically circles: moons circle their planet even when attached to another moon. */
  orbitParent: string | null;
  /** The star (or black hole, for rogue planets) that lights it. */
  light: string | null;
  /** True when placed by the Orbits property rather than links. */
  explicit: boolean;
  /** Bodies circling this one. */
  satellites: string[];
}

export interface GalaxyInfo {
  id: number;
  name: string;
  core: string;
  folder: string;
}

export interface Hierarchy {
  galaxies: GalaxyInfo[];
  nodes: Map<string, SpaceNode>;
  /** Undirected note links, used for sizes and light beams. */
  adjacency: Map<string, Set<string>>;
  /** Paths in tree order: core, then each star followed by its planets and moons. */
  order: string[];
}

export const ORBITS_PROP = 'orrery-orbits';

/** Child body for each kind, as shown on "Add …" buttons. */
export const CHILD_KIND: Partial<Record<SpaceKind, SpaceKind>> = { blackhole: 'star', star: 'planet', planet: 'moon' };

export const KIND_LABEL: Record<SpaceKind, string> = {
  blackhole: 'black hole', star: 'star', planet: 'planet', moon: 'moon', asteroid: 'asteroid',
};

/** The note an Orbits property points at, if it exists. */
export function explicitOrbit(note: NoteInfo, resolve: (t: string) => string | null) {
  const raw = note.parsed.frontmatter[ORBITS_PROP];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const target = raw.trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
  return target ? resolve(target) : null;
}

export function computeHierarchy(index: VaultIndex): Hierarchy {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const n of index.notes) {
    for (const t of n.outLinks) {
      if (!index.byPath.has(t)) continue;
      link(n.path, t);
      link(t, n.path);
    }
  }
  const degree = (p: string) => adjacency.get(p)?.size ?? 0;
  const words = (p: string) => index.byPath.get(p)?.parsed.words ?? 0;

  const groups = new Map<string, NoteInfo[]>();
  for (const n of index.notes) {
    const key = topFolder(n.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  const nodes = new Map<string, SpaceNode>();
  const galaxies: GalaxyInfo[] = [];
  const order: string[] = [];

  keys.forEach((key, gid) => {
    const notes = groups.get(key)!;
    const members = new Set(notes.map((n) => n.path));
    const local = (p: string) => [...(adjacency.get(p) ?? [])].filter((q) => members.has(q));
    const rank = (a: string, b: string) => local(b).length - local(a).length || degree(b) - degree(a) || words(b) - words(a) || a.localeCompare(b);

    const folderNote = key ? notes.find((n) => n.path === `${key}/${key}.md`) : notes.find((n) => /^(welcome|home|index|readme)\.md$/i.test(n.path));
    const core = folderNote?.path ?? notes.map((n) => n.path).sort(rank)[0];
    galaxies.push({ id: gid, name: key || 'Home', core, folder: key });

    // Explicit orbits only count inside the same galaxy, and never in a loop.
    const wanted = new Map<string, string>();
    for (const n of notes) {
      if (n.path === core) continue;
      const target = explicitOrbit(n, index.resolve);
      if (target && target !== n.path && members.has(target)) wanted.set(n.path, target);
    }
    for (const child of [...wanted.keys()]) {
      const seen = new Set([child]);
      for (let p = wanted.get(child); p; p = wanted.get(p)) {
        if (seen.has(p)) {
          wanted.delete(child);
          break;
        }
        seen.add(p);
      }
    }
    const explicitKids = new Map<string, string[]>();
    for (const [child, parent] of wanted) {
      if (!explicitKids.has(parent)) explicitKids.set(parent, []);
      explicitKids.get(parent)!.push(child);
    }

    const level = new Map<string, number>();
    const parentOf = new Map<string, string | null>();
    const asteroids = new Set<string>();
    const placed: string[] = [];
    const assign = (p: string, parent: string | null, lv: number) => {
      level.set(p, lv);
      parentOf.set(p, parent);
      placed.push(p);
    };
    const spread = (start: string) => {
      const queue = [start];
      while (queue.length) {
        const u = queue.shift()!;
        const lv = level.get(u)!;
        for (const c of (explicitKids.get(u) ?? []).sort(rank)) {
          if (level.has(c)) continue;
          assign(c, u, lv + 1);
          queue.push(c);
        }
        for (const v of local(u).sort(rank)) {
          if (level.has(v) || wanted.has(v)) continue;
          assign(v, u, lv + 1);
          queue.push(v);
        }
      }
    };

    assign(core, null, 0);
    spread(core);

    // Clusters not connected to the core become stars with their own planets.
    for (;;) {
      const free = notes.map((n) => n.path).filter((p) => !level.has(p) && !wanted.has(p)).sort(rank);
      const hub = free.find((p) => local(p).some((q) => !level.has(q) && !wanted.has(q)) || explicitKids.has(p));
      if (!hub) break;
      assign(hub, core, 1);
      spread(hub);
    }
    // Unlinked notes: a few drift as rogue planets, many form an asteroid belt.
    const loose = notes.map((n) => n.path).filter((p) => !level.has(p) && !wanted.has(p));
    if (loose.length > 8) loose.forEach((p) => asteroids.add(p));
    for (const p of loose) {
      assign(p, core, 2);
      if (!asteroids.has(p)) spread(p);
    }
    // Anything left was attached to a body that never got placed: treat as loose.
    for (const n of notes) if (!level.has(n.path)) assign(n.path, core, 2);

    for (const p of placed) {
      const lv = level.get(p)!;
      const parent = parentOf.get(p) ?? null;
      const kind: SpaceKind = lv === 0 ? 'blackhole' : asteroids.has(p) ? 'asteroid' : lv === 1 ? 'star' : lv === 2 ? 'planet' : 'moon';
      let orbitParent = parent;
      if (kind === 'moon') {
        // Climb to the planet this moon belongs to.
        let a = parent;
        while (a && (level.get(a) ?? 0) > 2) a = parentOf.get(a) ?? null;
        orbitParent = a;
      }
      nodes.set(p, { path: p, kind, galaxy: gid, parent, orbitParent, light: null, explicit: wanted.get(p) === parent && !!parent, satellites: [] });
    }
    for (const p of placed) {
      const n = nodes.get(p)!;
      if (n.orbitParent) nodes.get(n.orbitParent)!.satellites.push(p);
    }
    for (const p of placed) {
      const n = nodes.get(p)!;
      if (n.kind === 'planet' || n.kind === 'asteroid') n.light = n.orbitParent;
      if (n.kind === 'moon') n.light = n.orbitParent ? nodes.get(n.orbitParent)!.light : core;
    }
    order.push(...placed);
  });

  return { galaxies, nodes, adjacency, order };
}

/** Bodies `path` could be put in orbit around: same galaxy, not itself or anything circling it. */
export function orbitCandidates(h: Hierarchy, path: string) {
  const self = h.nodes.get(path);
  if (!self) return [];
  const below = new Set<string>([path]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of h.nodes.values()) {
      if (n.parent && below.has(n.parent) && !below.has(n.path)) {
        below.add(n.path);
        grew = true;
      }
    }
  }
  return h.order.map((p) => h.nodes.get(p)!).filter((n) => n.galaxy === self.galaxy && !below.has(n.path) && n.kind !== 'asteroid');
}

/** Hierarchy for the current vault, recomputed only when notes, links or orbits change. */
export function useHierarchy() {
  const index = useIndex();
  const key = structureKey(index);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => computeHierarchy(index), [key]);
}

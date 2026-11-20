import { Euler, Quaternion, Vector3 } from 'three';
import type { VaultIndex, NoteInfo } from '../../store/vaultIndex';
import { seeded } from '../../lib/hash';
import { topFolder } from '../../lib/paths';

export type BodyKind = 'sun' | 'planet' | 'moon' | 'asteroid';

export interface Body {
  path: string;
  title: string;
  kind: BodyKind;
  system: number;
  /** Body this one orbits; null for suns (they sit at the system centre). */
  parent: string | null;
  orbit: number;
  phase: number;
  /** Radians per simulated second. */
  speed: number;
  tilt: Quaternion;
  size: number;
  color: string;
  degree: number;
  moons: number;
}

export interface StarSystem {
  id: number;
  name: string;
  center: Vector3;
  extent: number;
  sun: string;
  color: string;
}

export interface SolarLayout {
  systems: StarSystem[];
  bodies: Body[];
  byPath: Map<string, Body>;
  /** Links between bodies that don't already orbit each other. */
  beams: [string, string][];
  radius: number;
}

const STAR_COLORS = ['#ffcf6e', '#8ec5ff', '#ff9a6b', '#fff0c2', '#c6a3ff', '#7dffd6', '#ff7fb3', '#ffe08a'];
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function hueOf(s: string) {
  return Math.floor(seeded(s) * 360);
}

function tiltFor(key: string, amount: number) {
  return new Quaternion().setFromEuler(new Euler((seeded(key + 'x') - 0.5) * amount, 0, (seeded(key + 'z') - 0.5) * amount, 'ZYX'));
}

/** Kepler-ish: outer orbits are slower. */
const orbitalSpeed = (r: number, k: number) => k / Math.pow(Math.max(r, 1), 1.5);

export function computeLayout(index: VaultIndex): SolarLayout {
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

  const groups = new Map<string, NoteInfo[]>();
  for (const n of index.notes) {
    const key = topFolder(n.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  const bodies: Body[] = [];
  const systems: StarSystem[] = [];

  keys.forEach((key, sysId) => {
    const notes = groups.get(key)!;
    const inSystem = new Set(notes.map((n) => n.path));
    const local = (p: string) => [...(adjacency.get(p) ?? [])].filter((q) => inSystem.has(q));
    const words = (p: string) => index.byPath.get(p)?.parsed.words ?? 0;
    const rank = (a: string, b: string) => local(b).length - local(a).length || degree(b) - degree(a) || words(b) - words(a) || a.localeCompare(b);

    // The sun is the folder note when there is one, otherwise the most linked note.
    const folderNote = key ? notes.find((n) => n.path === `${key}/${key}.md`) : notes.find((n) => /^(welcome|home|index|readme)\.md$/i.test(n.path));
    const sun = folderNote?.path ?? notes.map((n) => n.path).sort(rank)[0];
    const color = STAR_COLORS[sysId % STAR_COLORS.length];
    const sysHue = hueOf(key || 'home');

    const assigned = new Set([sun]);
    const planets: string[] = [];
    const moonsOf = new Map<string, string[]>();

    /** Breadth-first from `root`; direct neighbours become planets (or moons), deeper ones moons of their branch. */
    const claim = (root: string, rootIsSun: boolean) => {
      const owner = new Map<string, string>();
      const queue: string[] = [root];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const next of local(cur).sort(rank)) {
          if (assigned.has(next)) continue;
          assigned.add(next);
          queue.push(next);
          if (rootIsSun && cur === root) {
            planets.push(next);
            owner.set(next, next);
          } else {
            const o = rootIsSun ? owner.get(cur)! : root;
            owner.set(next, o);
            if (!moonsOf.has(o)) moonsOf.set(o, []);
            moonsOf.get(o)!.push(next);
          }
        }
      }
    };
    claim(sun, true);

    // Clusters not connected to the sun orbit as planets with their own moons.
    const rest = notes.map((n) => n.path).filter((p) => !assigned.has(p)).sort(rank);
    const loose: string[] = [];
    for (const p of rest) {
      if (assigned.has(p)) continue;
      if (local(p).some((q) => !assigned.has(q))) {
        assigned.add(p);
        planets.push(p);
        claim(p, false);
      } else loose.push(p);
    }
    // A handful of unlinked notes stay clickable as small planets; many become an asteroid belt.
    const asteroids = loose.length > 8 ? loose : [];
    if (!asteroids.length) planets.push(...loose);

    const sunSize = clamp(2.4 + 0.35 * Math.sqrt(degree(sun)) + 0.25 * Math.log10(1 + words(sun)), 2.4, 5.5);
    const sysBodies: Body[] = [];
    sysBodies.push({
      path: sun, title: index.byPath.get(sun)!.title, kind: 'sun', system: sysId, parent: null, orbit: 0, phase: 0, speed: 0,
      tilt: new Quaternion(), size: sunSize, color, degree: degree(sun), moons: planets.length,
    });

    let r = sunSize * 2.2 + 5;
    planets.forEach((p, i) => {
      const deg = degree(p);
      const size = clamp(0.65 + 0.22 * Math.sqrt(deg) + 0.14 * Math.log10(1 + words(p)), 0.65, 2.3);
      const moons = moonsOf.get(p) ?? [];
      let mr = size * 1.7 + 0.9;
      const moonBodies = moons.map((m, j) => {
        const msize = clamp(0.28 + 0.07 * Math.sqrt(degree(m)) + 0.05 * Math.log10(1 + words(m)), 0.28, 0.7);
        const orbit = mr + msize;
        mr = orbit + msize + 0.55;
        const tag = index.byPath.get(m)?.parsed.tags[0];
        return {
          path: m, title: index.byPath.get(m)!.title, kind: 'moon' as const, system: sysId, parent: p, orbit,
          phase: seeded(m) * Math.PI * 2 + j, speed: orbitalSpeed(orbit, 2.2), tilt: tiltFor(m, 0.9), size: msize,
          color: tag ? `hsl(${hueOf(tag)}, 35%, 72%)` : `hsl(${sysHue}, 14%, 70%)`, degree: degree(m), moons: 0,
        };
      });
      const extent = Math.max(size * 1.4, mr);
      r += extent;
      const tag = index.byPath.get(p)?.parsed.tags[0];
      const hue = tag ? hueOf(tag) : (sysHue + (seeded(p) - 0.5) * 80 + 360) % 360;
      sysBodies.push({
        path: p, title: index.byPath.get(p)!.title, kind: 'planet', system: sysId, parent: sun, orbit: r,
        phase: seeded(p) * Math.PI * 2 + i * GOLDEN, speed: orbitalSpeed(r, 9), tilt: tiltFor(p, 0.22), size,
        color: `hsl(${Math.round(hue)}, 62%, 60%)`, degree: deg, moons: moons.length,
      });
      sysBodies.push(...moonBodies);
      r += extent + 2.5;
    });

    const belt = r + 2;
    asteroids.forEach((a) => {
      const orbit = belt + seeded(a + 'r') * 5;
      sysBodies.push({
        path: a, title: index.byPath.get(a)!.title, kind: 'asteroid', system: sysId, parent: sun, orbit,
        phase: seeded(a) * Math.PI * 2, speed: orbitalSpeed(orbit, 9), tilt: tiltFor(a, 0.18),
        size: 0.22 + seeded(a + 's') * 0.18, color: '#9a95a8', degree: 0, moons: 0,
      });
    });
    const extent = asteroids.length ? belt + 6 : r;

    bodies.push(...sysBodies);
    systems.push({ id: sysId, name: key || 'Home', center: new Vector3(), extent, sun, color });
  });

  // Spread systems on a golden-angle spiral, spaced by the largest system.
  const maxExtent = Math.max(10, ...systems.map((s) => s.extent));
  const spacing = (maxExtent * 2 + 30) / 0.8;
  systems.forEach((s, i) => {
    if (i === 0) return;
    const angle = i * GOLDEN * 2.4;
    const dist = spacing * Math.sqrt(i);
    s.center.set(Math.cos(angle) * dist, (seeded(s.name) - 0.5) * maxExtent * 0.5, Math.sin(angle) * dist);
  });
  const radius = Math.max(...systems.map((s) => s.center.length() + s.extent), 20);

  const byPath = new Map(bodies.map((b) => [b.path, b]));
  const beams: [string, string][] = [];
  const seen = new Set<string>();
  for (const [a, set] of adjacency) {
    for (const b of set) {
      const key = a < b ? `${a}\n${b}` : `${b}\n${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const A = byPath.get(a);
      const B = byPath.get(b);
      if (!A || !B || A.parent === b || B.parent === a) continue;
      beams.push([a, b]);
    }
  }
  return { systems, bodies, byPath, beams, radius };
}

const tmp = new Vector3();

/** World position of a body at simulated time `t`. */
export function bodyPosition(layout: SolarLayout, body: Body, t: number, out: Vector3): Vector3 {
  if (!body.parent) return out.copy(layout.systems[body.system].center);
  bodyPosition(layout, layout.byPath.get(body.parent)!, t, out);
  const a = body.phase + t * body.speed;
  tmp.set(Math.cos(a) * body.orbit, 0, Math.sin(a) * body.orbit).applyQuaternion(body.tilt);
  return out.add(tmp);
}

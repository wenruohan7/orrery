import { Euler, Quaternion, Vector3 } from 'three';
import type { VaultIndex, NoteInfo } from '../../store/vaultIndex';
import { seeded } from '../../lib/hash';
import { topFolder } from '../../lib/paths';

export type BodyKind = 'blackhole' | 'star' | 'planet' | 'moon' | 'asteroid';

export interface Body {
  path: string;
  title: string;
  kind: BodyKind;
  galaxy: number;
  /** Body this one orbits; null for black holes (they sit at the galaxy centre). */
  parent: string | null;
  /** Star (or black hole, for rogue planets) that lights this body. */
  light: string | null;
  orbit: number;
  phase: number;
  /** Radians per simulated second. */
  speed: number;
  tilt: Quaternion;
  /** Radius; for black holes the event horizon. */
  size: number;
  degree: number;
  /** Bodies orbiting this one. */
  satellites: number;
  /** 0..1, stable per note; drives default looks. */
  seed: number;
}

export interface Galaxy {
  id: number;
  name: string;
  center: Vector3;
  extent: number;
  core: string;
}

export interface SolarLayout {
  galaxies: Galaxy[];
  bodies: Body[];
  byPath: Map<string, Body>;
  /** Links between bodies that don't already orbit each other. */
  beams: [string, string][];
  radius: number;
}

/** Accretion disk edges, in event-horizon radii. Shared with the black hole shader. */
export const DISK_INNER = 2.6;
export const DISK_OUTER = 7.5;

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
  const words = (p: string) => index.byPath.get(p)?.parsed.words ?? 0;
  const title = (p: string) => index.byPath.get(p)!.title;

  const groups = new Map<string, NoteInfo[]>();
  for (const n of index.notes) {
    const key = topFolder(n.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  const bodies: Body[] = [];
  const galaxies: Galaxy[] = [];

  keys.forEach((key, gid) => {
    const notes = groups.get(key)!;
    const inGalaxy = new Set(notes.map((n) => n.path));
    const local = (p: string) => [...(adjacency.get(p) ?? [])].filter((q) => inGalaxy.has(q));
    const rank = (a: string, b: string) => local(b).length - local(a).length || degree(b) - degree(a) || words(b) - words(a) || a.localeCompare(b);

    // The black hole is the folder note when there is one, otherwise the most linked note.
    const folderNote = key ? notes.find((n) => n.path === `${key}/${key}.md`) : notes.find((n) => /^(welcome|home|index|readme)\.md$/i.test(n.path));
    const core = folderNote?.path ?? notes.map((n) => n.path).sort(rank)[0];

    const assigned = new Set([core]);
    const stars: string[] = [];
    const planetsOf = new Map<string, string[]>();
    const moonsOf = new Map<string, string[]>();
    const push = (map: Map<string, string[]>, k: string, v: string) => {
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(v);
    };

    /**
     * Breadth-first from `root`. Depth decides the role: for the black hole, depth 1 = star,
     * 2 = planet, 3+ = moon; for a stray cluster's star, depth 1 = planet, 2+ = moon.
     */
    const claim = (root: string, rootDepth: number) => {
      const depth = new Map([[root, rootDepth]]);
      const planetOf = new Map<string, string>();
      const queue = [root];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const next of local(cur).sort(rank)) {
          if (assigned.has(next)) continue;
          assigned.add(next);
          queue.push(next);
          const d = depth.get(cur)! + 1;
          depth.set(next, d);
          if (d === 1) stars.push(next);
          else if (d === 2) {
            push(planetsOf, cur, next);
            planetOf.set(next, next);
          } else {
            const planet = planetOf.get(cur)!;
            planetOf.set(next, planet);
            push(moonsOf, planet, next);
          }
        }
      }
    };
    claim(core, 0);

    // Clusters not connected to the black hole become stars with their own planets.
    const loose: string[] = [];
    for (const p of notes.map((n) => n.path).filter((x) => !assigned.has(x)).sort(rank)) {
      if (assigned.has(p)) continue;
      if (local(p).some((q) => !assigned.has(q))) {
        assigned.add(p);
        stars.push(p);
        claim(p, 1);
      } else loose.push(p);
    }
    // A few unlinked notes drift as rogue planets around the black hole; many become an asteroid belt.
    const asteroids = loose.length > 8 ? loose : [];
    const rogues = asteroids.length ? [] : loose;

    const horizon = clamp(1.1 + 0.14 * Math.sqrt(degree(core)), 1.1, 2.2);
    const out: Body[] = [];
    out.push({
      path: core, title: title(core), kind: 'blackhole', galaxy: gid, parent: null, light: null, orbit: 0, phase: 0, speed: 0,
      tilt: tiltFor(core, 0.35), size: horizon, degree: degree(core), satellites: stars.length + rogues.length, seed: seeded(core),
    });

    /** Lay out a planet and its moons; returns the planet body, its moons and how far they reach. */
    const planetSystem = (p: string, parent: string, light: string) => {
      const size = clamp(0.5 + 0.17 * Math.sqrt(degree(p)) + 0.1 * Math.log10(1 + words(p)), 0.5, 1.5);
      let mr = size * 1.9 + 0.6;
      const moons = (moonsOf.get(p) ?? []).map((m, j) => {
        const msize = clamp(0.2 + 0.06 * Math.sqrt(degree(m)) + 0.04 * Math.log10(1 + words(m)), 0.2, 0.45);
        const orbit = mr + msize;
        mr = orbit + msize + 0.5;
        return {
          path: m, title: title(m), kind: 'moon' as const, galaxy: gid, parent: p, light, orbit,
          phase: seeded(m) * Math.PI * 2 + j, speed: orbitalSpeed(orbit, 2), tilt: tiltFor(m, 0.8), size: msize,
          degree: degree(m), satellites: 0, seed: seeded(m),
        };
      });
      const planet: Body = {
        path: p, title: title(p), kind: 'planet', galaxy: gid, parent, light, orbit: 0, phase: seeded(p) * Math.PI * 2,
        speed: 0, tilt: tiltFor(p, 0.25), size, degree: degree(p), satellites: moons.length, seed: seeded(p),
      };
      return { planet, moons, extent: Math.max(size * 2.2, mr) };
    };

    let r = horizon * DISK_OUTER * 1.25 + 6;
    stars.forEach((s, i) => {
      const size = clamp(1.1 + 0.2 * Math.sqrt(degree(s)) + 0.12 * Math.log10(1 + words(s)), 1.1, 2.6);
      let pr = size * 2.6 + 2;
      const inner: Body[] = [];
      (planetsOf.get(s) ?? []).forEach((p, j) => {
        const sys = planetSystem(p, s, s);
        pr += sys.extent;
        sys.planet.orbit = pr;
        sys.planet.speed = orbitalSpeed(pr, 6);
        sys.planet.phase += j * GOLDEN;
        inner.push(sys.planet, ...sys.moons);
        pr += sys.extent + 1.6;
      });
      const extent = Math.max(size * 2, pr);
      r += extent;
      out.push({
        path: s, title: title(s), kind: 'star', galaxy: gid, parent: core, light: null, orbit: r,
        phase: seeded(s) * Math.PI * 2 + i * GOLDEN, speed: orbitalSpeed(r, 14), tilt: tiltFor(s, 0.3), size,
        degree: degree(s), satellites: inner.filter((b) => b.parent === s).length, seed: seeded(s),
      });
      out.push(...inner);
      r += extent + 5;
    });

    rogues.forEach((p) => {
      const sys = planetSystem(p, core, core);
      r += sys.extent;
      sys.planet.orbit = r;
      sys.planet.speed = orbitalSpeed(r, 14);
      out.push(sys.planet, ...sys.moons);
      r += sys.extent + 3;
    });

    const belt = r + 2;
    asteroids.forEach((a) => {
      const orbit = belt + seeded(a + 'r') * 6;
      out.push({
        path: a, title: title(a), kind: 'asteroid', galaxy: gid, parent: core, light: core, orbit,
        phase: seeded(a) * Math.PI * 2, speed: orbitalSpeed(orbit, 14), tilt: tiltFor(a, 0.18),
        size: 0.22 + seeded(a + 's') * 0.18, degree: 0, satellites: 0, seed: seeded(a),
      });
    });

    bodies.push(...out);
    galaxies.push({ id: gid, name: key || 'Home', center: new Vector3(), extent: asteroids.length ? belt + 8 : r, core });
  });

  // Spread galaxies on a golden-angle spiral, spaced by the largest one.
  const maxExtent = Math.max(10, ...galaxies.map((g) => g.extent));
  const spacing = (maxExtent * 2 + 30) / 0.8;
  galaxies.forEach((g, i) => {
    if (i === 0) return;
    const angle = i * GOLDEN * 2.4;
    const dist = spacing * Math.sqrt(i);
    g.center.set(Math.cos(angle) * dist, (seeded(g.name) - 0.5) * maxExtent * 0.5, Math.sin(angle) * dist);
  });
  const radius = Math.max(...galaxies.map((g) => g.center.length() + g.extent), 20);

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
  return { galaxies, bodies, byPath, beams, radius };
}

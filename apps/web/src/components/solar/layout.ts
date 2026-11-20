import { Euler, Quaternion, Vector3 } from 'three';
import type { VaultIndex } from '../../store/vaultIndex';
import { computeHierarchy, type Hierarchy } from '../../lib/hierarchy';
import { seeded } from '../../lib/hash';

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

export function computeLayout(index: VaultIndex, h: Hierarchy = computeHierarchy(index)): SolarLayout {
  const degree = (p: string) => h.adjacency.get(p)?.size ?? 0;
  const words = (p: string) => index.byPath.get(p)?.parsed.words ?? 0;
  const title = (p: string) => index.byPath.get(p)!.title;
  const kids = (p: string) => h.nodes.get(p)?.satellites ?? [];

  const bodies: Body[] = [];
  const galaxies: Galaxy[] = [];

  for (const g of h.galaxies) {
    const gid = g.id;
    const core = g.core;
    const inGalaxy = h.order.filter((p) => h.nodes.get(p)!.galaxy === gid).map((p) => h.nodes.get(p)!);
    const stars = inGalaxy.filter((n) => n.kind === 'star').map((n) => n.path);
    const rogues = inGalaxy.filter((n) => n.kind === 'planet' && n.orbitParent === core).map((n) => n.path);
    const asteroids = inGalaxy.filter((n) => n.kind === 'asteroid').map((n) => n.path);

    const horizon = clamp(1.1 + 0.14 * Math.sqrt(degree(core)), 1.1, 2.2);
    const out: Body[] = [];
    out.push({
      path: core, title: title(core), kind: 'blackhole', galaxy: gid, parent: null, light: null, orbit: 0, phase: 0, speed: 0,
      tilt: tiltFor(core, 0.35), size: horizon, degree: degree(core), satellites: kids(core).length, seed: seeded(core),
    });

    /** Lay out a planet and its moons; returns the planet body, its moons and how far they reach. */
    const planetSystem = (p: string, parent: string, light: string) => {
      const size = clamp(0.5 + 0.17 * Math.sqrt(degree(p)) + 0.1 * Math.log10(1 + words(p)), 0.5, 1.5);
      let mr = size * 1.9 + 0.6;
      const moons = kids(p).map((m, j) => {
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
      kids(s).forEach((p, j) => {
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
        degree: degree(s), satellites: kids(s).length, seed: seeded(s),
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
    galaxies.push({ id: gid, name: g.name, center: new Vector3(), extent: asteroids.length ? belt + 8 : r, core });
  }

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
  for (const [a, set] of h.adjacency) {
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

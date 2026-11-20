import { useEffect, useState } from 'react';
import { useVault } from '../../store/vault';
import type { NoteInfo, VaultIndex } from '../../store/vaultIndex';
import { setProperties } from '../../lib/markdown';
import { seeded } from '../../lib/hash';
import { CONFIG_PATH } from '../../lib/paths';
import { SURFACES, type Surface } from './shaders';
import type { Body, SolarLayout } from './layout';


export type ThemeId = 'realistic' | 'neon' | 'pastel' | 'mono';

/** Every field is optional: unset fields fall back to rules, then the theme. */
export interface BodyDesign {
  color?: string;
  surface?: Surface;
  rings?: boolean;
  /** Multiplier on the size the layout gives the body. */
  size?: number;
  glow?: number;
  disk?: string;
  brightness?: number;
  spin?: number;
}

export interface DesignRule {
  /** "#tag" or "Folder/Subfolder". */
  match: string;
  design: BodyDesign;
}

export interface GalaxyConfig {
  theme: ThemeId;
  rules: DesignRule[];
}

export type ResolvedDesign = Required<BodyDesign>;

/** Note properties that hold a body's design. */
export const PROPS = {
  color: 'orrery-color',
  surface: 'orrery-surface',
  rings: 'orrery-rings',
  size: 'orrery-size',
  glow: 'orrery-glow',
  disk: 'orrery-disk',
  brightness: 'orrery-brightness',
  spin: 'orrery-spin',
} as const;

interface Theme {
  label: string;
  stars: string[];
  /** null: disks take each galaxy's own colour. */
  disks: string[] | null;
  planetSat: number;
  planetLight: number;
  saturation: number;
  rim: number;
  glow: number;
  beam: number;
}

export const THEMES: Record<ThemeId, Theme> = {
  realistic: {
    label: 'Realistic',
    stars: ['#ffd9a0', '#fff1d6', '#bcd4ff', '#ffb27a', '#ffe9b8', '#ff9966'],
    disks: ['#ff8a3d', '#ffa24f', '#ff7433'],
    planetSat: 45, planetLight: 55, saturation: 0.9, rim: 0.5, glow: 1, beam: 0.45,
  },
  neon: {
    label: 'Neon',
    stars: ['#ff3df2', '#3dfcff', '#9dff3d', '#ffe83d', '#ff6b3d', '#8b5cff'],
    disks: null,
    planetSat: 95, planetLight: 58, saturation: 1.25, rim: 1.6, glow: 1.6, beam: 0.95,
  },
  pastel: {
    label: 'Pastel',
    stars: ['#ffd1dc', '#c9e7ff', '#fff3b5', '#d9c8ff', '#c6f7e2'],
    disks: ['#ffb3c7', '#b5d8ff', '#d6c2ff'],
    planetSat: 55, planetLight: 76, saturation: 0.75, rim: 0.9, glow: 0.85, beam: 0.5,
  },
  mono: {
    label: 'Monochrome',
    stars: ['#ffffff', '#e6e6e6', '#cfcfcf'],
    disks: ['#e8e8e8'],
    planetSat: 0, planetLight: 62, saturation: 0, rim: 0.8, glow: 0.9, beam: 0.4,
  },
};

export const DEFAULT_CONFIG: GalaxyConfig = { theme: 'realistic', rules: [] };

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim());
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pick = <T,>(list: T[], seed: number) => list[Math.floor(seed * list.length) % list.length];

function num(v: unknown, lo: number, hi: number) {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? clamp(n, lo, hi) : undefined;
}

/** Validate a design from untrusted input (note properties or the config file). */
export function cleanDesign(raw: Record<string, unknown>): BodyDesign {
  const d: BodyDesign = {};
  if (isColor(raw.color)) d.color = raw.color.trim().toLowerCase();
  if (SURFACES.includes(raw.surface as Surface)) d.surface = raw.surface as Surface;
  if (raw.rings === true || raw.rings === 'true') d.rings = true;
  if (raw.rings === false || raw.rings === 'false') d.rings = false;
  d.size = num(raw.size, 0.3, 3);
  d.glow = num(raw.glow, 0, 3);
  if (isColor(raw.disk)) d.disk = raw.disk.trim().toLowerCase();
  d.brightness = num(raw.brightness, 0.2, 3);
  d.spin = num(raw.spin, -3, 3);
  for (const k of Object.keys(d) as (keyof BodyDesign)[]) if (d[k] === undefined) delete d[k];
  return d;
}

export function designFromProps(fm: Record<string, unknown>): BodyDesign {
  const raw: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(PROPS)) if (prop in fm) raw[key] = fm[prop];
  return cleanDesign(raw);
}

export function designToProps(d: BodyDesign): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, prop] of Object.entries(PROPS)) {
    const v = d[key as keyof BodyDesign];
    out[prop] = v === undefined ? null : typeof v === 'string' && v.startsWith('#') ? `"${v}"` : String(v);
  }
  return out;
}

/** Write a design into a note's properties; fields left undefined are removed. */
export function saveNoteDesign(path: string, design: BodyDesign) {
  const { files, saveNote } = useVault.getState();
  const file = files[path];
  if (file) saveNote(path, setProperties(file.content, designToProps(design)));
}

export function ruleMatches(match: string, note: NoteInfo) {
  const m = match.trim().toLowerCase();
  if (!m) return false;
  if (m.startsWith('#')) {
    const tag = m.slice(1);
    return note.parsed.tags.some((t) => t === tag || t.startsWith(tag + '/'));
  }
  const folder = m.replace(/^\/+|\/+$/g, '');
  return note.path.toLowerCase().startsWith(folder + '/');
}

const PLANET_SURFACES: Surface[] = ['rocky', 'rocky', 'desert', 'ocean', 'ocean', 'ice', 'lava', 'toxic'];

function defaults(body: Body, layout: SolarLayout, index: VaultIndex, theme: Theme): ResolvedDesign {
  const galaxyHue = seeded(layout.galaxies[body.galaxy].name) * 360;
  const tag = index.byPath.get(body.path)?.parsed.tags[0];
  const hue = Math.round(tag ? seeded(tag) * 360 : (galaxyHue + (body.seed - 0.5) * 80 + 360) % 360);
  const base: ResolvedDesign = {
    color: '#ffffff', surface: 'rocky', rings: false, size: 1, glow: theme.glow,
    disk: theme.disks ? pick(theme.disks, body.seed) : hslHex(galaxyHue, 100, 60), brightness: 1, spin: 1,
  };
  switch (body.kind) {
    case 'blackhole':
      return { ...base, color: base.disk };
    case 'star':
      return { ...base, color: pick(theme.stars, body.seed) };
    case 'planet': {
      const big = body.satellites >= 3 || body.degree >= 5;
      const surface = big ? 'gas' : pick(PLANET_SURFACES, seeded(body.path + 'surface'));
      return {
        ...base,
        color: hslHex(hue, theme.planetSat, theme.planetLight),
        surface,
        rings: body.satellites >= 4 || (surface === 'gas' && body.seed > 0.55),
      };
    }
    case 'moon':
      return { ...base, color: hslHex(hue, theme.planetSat * 0.35, theme.planetLight + 8), surface: body.seed < 0.65 ? 'rocky' : 'ice' };
    default:
      return { ...base, color: '#8f8a9c' };
  }
}

export function resolveDesigns(layout: SolarLayout, index: VaultIndex, config: GalaxyConfig) {
  const theme = THEMES[config.theme] ?? THEMES.realistic;
  const out = new Map<string, ResolvedDesign>();
  for (const body of layout.bodies) {
    const note = index.byPath.get(body.path);
    const rule = note ? config.rules.find((r) => ruleMatches(r.match, note)) : undefined;
    const own = note ? designFromProps(note.parsed.frontmatter) : {};
    out.set(body.path, { ...defaults(body, layout, index, theme), ...rule?.design, ...own });
  }
  return out;
}

/** Changes only when something that affects looks changes. */
export function designKey(index: VaultIndex, config: GalaxyConfig) {
  const own = index.notes
    .map((n) => {
      const d = designFromProps(n.parsed.frontmatter);
      return Object.keys(d).length ? `${n.path}=${JSON.stringify(d)}` : '';
    })
    .filter(Boolean)
    .join('\n');
  return `${JSON.stringify(config)}\n${own}`;
}

export function parseConfig(text: string): GalaxyConfig {
  try {
    const raw = JSON.parse(text) as Partial<GalaxyConfig>;
    return {
      theme: raw.theme && raw.theme in THEMES ? raw.theme : 'realistic',
      rules: Array.isArray(raw.rules)
        ? raw.rules
            .filter((r) => r && typeof r.match === 'string')
            .map((r) => ({ match: r.match, design: cleanDesign((r.design ?? {}) as Record<string, unknown>) }))
        : [],
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function useGalaxyConfig() {
  const blob = useVault((s) => (s.files[CONFIG_PATH]?.deleted ? undefined : s.files[CONFIG_PATH]?.blob));
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  useEffect(() => {
    let alive = true;
    if (!blob) setConfig(DEFAULT_CONFIG);
    else void blob.text().then((t) => alive && setConfig(parseConfig(t)));
    return () => {
      alive = false;
    };
  }, [blob]);
  return config;
}

export function saveGalaxyConfig(config: GalaxyConfig) {
  void useVault.getState().saveFile(CONFIG_PATH, new Blob([JSON.stringify(config, null, 2) + '\n'], { type: 'application/json' }));
}

export function hslHex(h: number, s: number, l: number) {
  const S = clamp(s, 0, 100) / 100;
  const L = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export const SURFACE_LABELS: Record<Surface, string> = {
  rocky: 'Rocky', desert: 'Desert', ocean: 'Ocean', ice: 'Ice', lava: 'Lava', gas: 'Gas giant', toxic: 'Toxic',
};

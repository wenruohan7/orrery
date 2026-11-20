import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  ArrowUp, ChevronLeft, ChevronRight, CircleDot, Eye, EyeOff, Home, MoonStar, Orbit, Paintbrush, Palette, Pause, Play, Search, Sparkles,
  SquareArrowOutUpRight, Waypoints, X,
} from 'lucide-react';
import { useIndex, structureKey, type VaultIndex } from '../../store/vaultIndex';
import { useVault } from '../../store/vault';
import { useUI } from '../../store/ui';
import { computeLayout, type Body, type SolarLayout } from './layout';
import { KIND_NAMES, Scene, type Focus, type SceneOptions } from './Scene';
import { designKey, resolveDesigns, useGalaxyConfig, type ResolvedDesign } from './design';
import { DesignPanel } from './DesignPanel';
import { GalaxyPanel } from './GalaxyPanel';
import { Preview } from '../Preview';
import { addLinkedNote, newNote, openNote } from '../../lib/actions';
import { fuzzyScore } from '../../lib/fuzzy';
import { createSampleVault } from '../../lib/sample';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** The colour that represents a body in lists: the disk for black holes. */
const swatch = (body: Body, d?: ResolvedDesign) => (body.kind === 'blackhole' ? d?.disk : d?.color) ?? '#ffffff';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** Bodies whose title, tags or text contain every word of the query. */
function searchBodies(query: string, layout: SolarLayout, index: VaultIndex) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const hits = new Set<string>();
  for (const b of layout.bodies) {
    const note = index.byPath.get(b.path);
    const hay = `${b.title}\n${note?.parsed.tags.map((t) => '#' + t).join(' ') ?? ''}\n${note?.content ?? ''}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) hits.add(b.path);
  }
  return hits;
}

/** Neighbours to step through with ‹ ›: other black holes, or bodies orbiting the same parent. */
function siblingsOf(body: Body, layout: SolarLayout) {
  if (body.kind === 'blackhole') return layout.galaxies.map((g) => layout.byPath.get(g.core)!);
  return layout.bodies.filter((b) => b.parent === body.parent && b.galaxy === body.galaxy).sort((a, b) => a.orbit - b.orbit);
}

/** From the galaxy's black hole down to `body`. */
function lineage(body: Body, layout: SolarLayout) {
  const chain: Body[] = [];
  for (let b: Body | undefined = body; b; b = b.parent ? layout.byPath.get(b.parent) : undefined) chain.unshift(b);
  return chain;
}

export default function SolarView() {
  const index = useIndex();
  const config = useGalaxyConfig();
  const narrow = useNarrow();
  const key = structureKey(index);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout(index), [key]);
  const dKey = designKey(index, config);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const designs = useMemo(() => resolveDesigns(layout, index, config), [layout, dKey]);
  const time = useRef(0);

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [galaxyOpen, setGalaxyOpen] = useState(false);
  /** On phones the card can shrink to a strip so the sky stays visible. */
  const [peek, setPeek] = useState(true);
  const [focus, setFocus] = useState<Focus>({ path: null, galaxy: null, nonce: 0 });
  const [options, setOptions] = useState<SceneOptions>(() => {
    try {
      return { paused: false, speed: 0.35, labels: true, beams: true, orbits: true, ...JSON.parse(localStorage.getItem('orrery-solar') ?? '{}') };
    } catch {
      return { paused: false, speed: 0.35, labels: true, beams: true, orbits: true };
    }
  });

  const highlight = useMemo(() => searchBodies(query, layout, index), [query, layout, index]);

  useEffect(() => {
    try {
      localStorage.setItem('orrery-solar', JSON.stringify(options));
    } catch {
      /* ignore */
    }
  }, [options]);

  const flyTo = (path: string | null) => {
    setSelected(path);
    if (path) setGalaxyOpen(false);
    setFocus((f) => ({ path, galaxy: null, nonce: f.nonce + 1 }));
  };
  const flyGalaxy = (galaxy: number | null) => {
    setSelected(null);
    setFocus((f) => ({ path: null, galaxy, nonce: f.nonce + 1 }));
  };

  const body = selected ? layout.byPath.get(selected) : undefined;
  const nav = useMemo(() => {
    if (!body) return null;
    const siblings = siblingsOf(body, layout);
    const i = siblings.findIndex((s) => s.path === body.path);
    const step = (d: number) => siblings[(i + d + siblings.length) % siblings.length].path;
    return {
      siblings,
      index: i,
      prev: siblings.length > 1 ? step(-1) : null,
      next: siblings.length > 1 ? step(1) : null,
      up: body.parent,
      core: body.kind === 'blackhole' ? null : layout.galaxies[body.galaxy].core,
    };
  }, [body, layout]);

  // Arriving from "Find in space": fly straight to that note.
  useEffect(() => {
    const target = useUI.getState().solarFocus;
    if (target && layout.byPath.has(target)) {
      flyTo(target);
      useUI.getState().set({ solarFocus: null });
    }
  }, [layout]);

  // A selected note that was deleted or renamed disappears from the layout.
  useEffect(() => {
    if (selected && !layout.byPath.has(selected)) setSelected(null);
  }, [layout, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, .cm-editor')) return;
      if (e.key === 'Escape') flyTo(null);
      else if (e.key === ' ') {
        e.preventDefault();
        setOptions((o) => ({ ...o, paused: !o.paused }));
      } else if (nav && e.key === 'ArrowRight' && nav.next) flyTo(nav.next);
      else if (nav && e.key === 'ArrowLeft' && nav.prev) flyTo(nav.prev);
      else if (nav && (e.key === 'ArrowUp' || e.key === 'Backspace') && nav.up) flyTo(nav.up);
      else if (nav && e.key.toLowerCase() === 'h' && nav.core) flyTo(nav.core);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!layout.bodies.length) {
    return (
      <div className="solar empty-state">
        <h1>An empty sky</h1>
        <p className="muted">Each note becomes a star, planet or moon. Write a few and link them with [[ ]] to watch them orbit.</p>
        <div className="empty-actions">
          <button className="btn primary" onClick={() => newNote()}>New note</button>
          <button className="btn" onClick={createSampleVault}>
            <Sparkles size={16} /> Create sample vault
          </button>
        </div>
      </div>
    );
  }

  // Shift the view so the focused body sits beside (desktop) or above (phone) the card.
  const cardOpen = !!selected || galaxyOpen;
  const inset = !cardOpen ? { x: 0, y: 0 } : narrow ? { x: 0, y: selected && peek ? 0.1 : 0.27 } : { x: 0.17, y: 0 };

  const r = layout.radius;
  return (
    <div className="solar">
      <Canvas
        camera={{ position: [0, r * 0.6 + 15, r * 0.9 + 15], fov: 55, near: 0.1, far: r * 20 + 3000 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => setSelected(null)}
      >
        <Scene
          layout={layout}
          designs={designs}
          theme={config.theme}
          selected={selected}
          hovered={hovered}
          focus={focus}
          options={options}
          highlight={highlight}
          inset={inset}
          time={time}
          onSelect={flyTo}
          onHover={(p) => {
            setHovered(p);
            document.body.style.cursor = p ? 'pointer' : '';
          }}
        />
      </Canvas>

      <FlySearch layout={layout} designs={designs} query={query} setQuery={setQuery} matches={highlight} onPick={flyTo} />
      {!query && <GalaxyChips layout={layout} designs={designs} onPick={flyGalaxy} />}
      <Controls
        options={options}
        setOptions={setOptions}
        onHome={() => flyGalaxy(null)}
        onDesign={() => {
          setSelected(null);
          setGalaxyOpen((o) => !o);
        }}
        designOpen={galaxyOpen}
      />
      {galaxyOpen && !selected && (
        <div className="side-card">
          <GalaxyPanel config={config} onClose={() => setGalaxyOpen(false)} />
        </div>
      )}
      {body && nav && (
        <BodyCard
          layout={layout}
          designs={designs}
          body={body}
          nav={nav}
          peek={narrow && peek}
          setPeek={setPeek}
          onFly={flyTo}
          onClose={() => flyTo(null)}
        />
      )}
    </div>
  );
}

interface SearchProps {
  layout: SolarLayout;
  designs: Map<string, ResolvedDesign>;
  query: string;
  setQuery(q: string): void;
  matches: Set<string> | null;
  onPick(path: string): void;
}

/** Typing lights up every matching body; the list below jumps to one. */
function FlySearch({ layout, designs, query, setQuery, matches, onPick }: SearchProps) {
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    if (!matches) return [];
    return [...matches]
      .map((p) => layout.byPath.get(p)!)
      .map((b) => ({ b, s: fuzzyScore(query, b.title) ?? -1000 }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.b);
  }, [matches, layout, query]);

  const pick = (path: string) => {
    onPick(path);
    setOpen(false);
    (document.activeElement as HTMLElement)?.blur();
  };

  return (
    <div className="fly-search">
      <Search size={15} />
      <input
        value={query}
        placeholder="Search the sky…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) pick(results[0].path);
          if (e.key === 'Escape') {
            setQuery('');
            (e.target as HTMLInputElement).blur();
          }
        }}
        enterKeyHint="go"
      />
      {query && (
        <button className="icon-btn small" onClick={() => setQuery('')} aria-label="Clear search">
          <X size={14} />
        </button>
      )}
      {open && matches && (
        <div className="fly-results">
          <div className="fly-count">
            {matches.size === 0 ? 'Nothing matches' : `${matches.size} note${matches.size === 1 ? '' : 's'} light up`}
          </div>
          {results.map((b) => (
            <button key={b.path} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(b.path)}>
              <span className="dot" style={{ background: swatch(b, designs.get(b.path)) }} />
              <span className="name">{b.title}</span>
              <span className="detail">
                {cap(KIND_NAMES[b.kind])} · {layout.galaxies[b.galaxy].name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GalaxyChips({ layout, designs, onPick }: { layout: SolarLayout; designs: Map<string, ResolvedDesign>; onPick(galaxy: number): void }) {
  if (layout.galaxies.length < 2) return null;
  return (
    <div className="system-chips">
      {layout.galaxies.map((g) => {
        const c = designs.get(g.core)?.disk ?? '#ff8a3d';
        return (
          <button key={g.id} onClick={() => onPick(g.id)}>
            <span className="dot hole" style={{ borderColor: c, boxShadow: `0 0 8px ${c}` }} />
            {g.name}
          </button>
        );
      })}
    </div>
  );
}

interface ControlsProps {
  options: SceneOptions;
  setOptions(fn: (o: SceneOptions) => SceneOptions): void;
  onHome(): void;
  onDesign(): void;
  designOpen: boolean;
}

function Controls({ options, setOptions, onHome, onDesign, designOpen }: ControlsProps) {
  const toggle = (k: 'paused' | 'labels' | 'beams' | 'orbits') => setOptions((o) => ({ ...o, [k]: !o[k] }));
  return (
    <div className="solar-controls">
      <button className="icon-btn" onClick={onHome} title="See every galaxy" aria-label="Overview">
        <Home size={17} />
      </button>
      <button className="icon-btn" onClick={() => toggle('paused')} title={options.paused ? 'Resume orbits (Space)' : 'Pause orbits (Space)'} aria-label="Pause or resume">
        {options.paused ? <Play size={17} /> : <Pause size={17} />}
      </button>
      <input
        type="range"
        min={0.05}
        max={3}
        step={0.05}
        value={options.speed}
        onChange={(e) => setOptions((o) => ({ ...o, speed: Number(e.target.value) }))}
        aria-label="Orbit speed"
        title="Orbit speed"
      />
      <button className={`icon-btn ${options.labels ? 'on' : ''}`} onClick={() => toggle('labels')} title="Labels" aria-label="Toggle labels">
        {options.labels ? <Eye size={17} /> : <EyeOff size={17} />}
      </button>
      <button className={`icon-btn ${options.beams ? 'on' : ''}`} onClick={() => toggle('beams')} title="Link beams" aria-label="Toggle link beams">
        <Waypoints size={17} />
      </button>
      <button className={`icon-btn ${options.orbits ? 'on' : ''}`} onClick={() => toggle('orbits')} title="Orbit paths" aria-label="Toggle orbit paths">
        <Orbit size={17} />
      </button>
      <button className={`icon-btn ${designOpen ? 'on' : ''}`} onClick={onDesign} title="Galaxy design: themes and rules" aria-label="Galaxy design">
        <Palette size={17} />
      </button>
    </div>
  );
}

interface Nav {
  siblings: Body[];
  index: number;
  prev: string | null;
  next: string | null;
  up: string | null;
  core: string | null;
}

interface CardProps {
  layout: SolarLayout;
  designs: Map<string, ResolvedDesign>;
  body: Body;
  nav: Nav;
  peek: boolean;
  setPeek(p: boolean): void;
  onFly(path: string): void;
  onClose(): void;
}

function BodyCard({ layout, designs, body, nav, peek, setPeek, onFly, onClose }: CardProps) {
  const path = body.path;
  const design = designs.get(path)!;
  const index = useIndex();
  const content = useVault((s) => s.files[path]?.content ?? '');
  const [tab, setTab] = useState<'note' | 'design'>('note');
  const galaxy = layout.galaxies[body.galaxy];
  const parent = body.parent ? layout.byPath.get(body.parent) : null;
  const satellites = layout.bodies.filter((b) => b.parent === path);
  const related = [...new Set([...(index.byPath.get(path)?.outLinks ?? []), ...(index.backlinks.get(path) ?? [])])]
    .filter((p) => layout.byPath.has(p) && p !== body.parent && !satellites.some((s) => s.path === p));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const describe =
    body.kind === 'blackhole'
      ? `Black hole at the heart of ${galaxy.name} · ${plural(satellites.filter((s) => s.kind === 'star').length, 'star')}`
      : body.kind === 'star'
        ? `Star orbiting ${parent?.title} · ${plural(satellites.length, 'planet')}`
        : body.kind === 'planet'
          ? `${parent?.kind === 'blackhole' ? 'Rogue planet around' : 'Planet orbiting'} ${parent?.title} · ${plural(satellites.length, 'moon')}`
          : body.kind === 'moon'
            ? `Moon of ${parent?.title}`
            : `Asteroid in the ${galaxy.name} belt. Link it to pull it into orbit.`;

  const addLabel = body.kind === 'blackhole' ? 'Add star' : body.kind === 'star' ? 'Add planet' : 'Add moon';
  const satelliteLabel = body.kind === 'blackhole' ? 'Orbiting' : body.kind === 'star' ? 'Planets' : 'Moons';
  const siblingLabel = body.kind === 'blackhole' ? 'galaxies' : `${KIND_NAMES[body.kind]}s`;
  const color = swatch(body, design);

  // Swipe sideways for the next or previous body, down to shrink the card, up to expand it.
  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      const to = dx < 0 ? nav.next : nav.prev;
      if (to) onFly(to);
    } else if (dy > 45) setPeek(true);
    else if (dy < -45) setPeek(false);
  };

  const chip = (p: string) => {
    const b = layout.byPath.get(p)!;
    return (
      <button key={p} className="body-chip" onClick={() => onFly(p)}>
        <span className="dot" style={{ background: swatch(b, designs.get(p)) }} />
        {b.title}
      </button>
    );
  };

  return (
    <div className={`body-card side-card ${peek ? 'peek' : ''}`}>
      <div className="card-grab" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipe.current = null)}>
        <button className="grab-handle" onClick={() => setPeek(!peek)} aria-label={peek ? 'Show more' : 'Show less'} />
        <div className="crumbs">
          {lineage(body, layout).map((b, i, all) => (
            <span key={b.path}>
              {i > 0 && <ChevronRight size={12} />}
              {i === all.length - 1 ? <b>{i === 0 ? galaxy.name : b.title}</b> : <button onClick={() => onFly(b.path)}>{i === 0 ? galaxy.name : b.title}</button>}
            </span>
          ))}
        </div>
        <div className="body-card-head">
          <span
            className={`dot big ${body.kind === 'blackhole' ? 'hole' : ''}`}
            style={body.kind === 'blackhole' ? { borderColor: color, boxShadow: `0 0 12px ${color}` } : { background: color, boxShadow: `0 0 12px ${color}` }}
          />
          <div className="titles">
            <h2>{body.title}</h2>
            <div className="muted small">{describe}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="space-nav">
          <button className="nav-btn" disabled={!nav.up} onClick={() => nav.up && onFly(nav.up)} title="Up to what this orbits (↑)">
            <ArrowUp size={17} />
            <span>Up</span>
          </button>
          <button className="nav-btn" disabled={!nav.core} onClick={() => nav.core && onFly(nav.core)} title="Back to the black hole (H)">
            <CircleDot size={17} />
            <span>Core</span>
          </button>
          <div className="nav-step">
            <button className="nav-btn round" disabled={!nav.prev} onClick={() => nav.prev && onFly(nav.prev)} aria-label="Previous" title="Previous (←)">
              <ChevronLeft size={20} />
            </button>
            <span className="nav-count">
              {nav.index + 1} / {nav.siblings.length}
              <small>{siblingLabel}</small>
            </span>
            <button className="nav-btn round" disabled={!nav.next} onClick={() => nav.next && onFly(nav.next)} aria-label="Next" title="Next (→)">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>
      <div className="card-more">
        <div className="body-card-actions">
          <button className="btn primary" onClick={() => openNote(path)}>
            <SquareArrowOutUpRight size={15} /> Open note
          </button>
          {body.kind !== 'moon' && body.kind !== 'asteroid' && (
            <button
              className="btn"
              onClick={async () => {
                const created = await addLinkedNote(path);
                if (created) setTimeout(() => onFly(created), 50);
              }}
            >
              <MoonStar size={15} /> {addLabel}
            </button>
          )}
        </div>
        <div className="card-tabs">
          <button className={tab === 'note' ? 'on' : ''} onClick={() => setTab('note')}>
            Note
          </button>
          <button className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>
            <Paintbrush size={13} /> Design
          </button>
        </div>
        <div className="body-card-preview">
          {tab === 'design' ? (
            <DesignPanel body={body} resolved={design} />
          ) : (
            <>
              {satellites.length > 0 && (
                <div className="chip-row">
                  <div className="chip-label">{satelliteLabel}</div>
                  {satellites.map((s) => chip(s.path))}
                </div>
              )}
              {related.length > 0 && (
                <div className="chip-row">
                  <div className="chip-label">Light beams</div>
                  {related.map(chip)}
                </div>
              )}
              <Preview path={path} content={content} compact onNavigate={onFly} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

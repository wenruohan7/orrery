import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  Eye, EyeOff, Home, MoonStar, Orbit, Pause, Play, Search, Sparkles, SquareArrowOutUpRight, Sun, Waypoints, X,
} from 'lucide-react';
import { useIndex, structureKey } from '../../store/vaultIndex';
import { useVault } from '../../store/vault';
import { useUI } from '../../store/ui';
import { computeLayout, type Body, type SolarLayout } from './layout';
import { Scene, type Focus, type SceneOptions } from './Scene';
import { Preview } from '../Preview';
import { addLinkedNote, newNote, openNote } from '../../lib/actions';
import { fuzzyScore } from '../../lib/fuzzy';
import { createSampleVault } from '../../lib/sample';

const KIND_LABEL: Record<Body['kind'], string> = { sun: 'Sun', planet: 'Planet', moon: 'Moon', asteroid: 'Asteroid' };

export default function SolarView() {
  const index = useIndex();
  const key = structureKey(index);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout(index), [key]);
  const time = useRef(0);

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>({ path: null, system: null, nonce: 0 });
  const [options, setOptions] = useState<SceneOptions>(() => {
    try {
      return { paused: false, speed: 0.35, labels: true, beams: true, orbits: true, ...JSON.parse(localStorage.getItem('orrery-solar') ?? '{}') };
    } catch {
      return { paused: false, speed: 0.35, labels: true, beams: true, orbits: true };
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('orrery-solar', JSON.stringify(options));
    } catch {
      /* ignore */
    }
  }, [options]);

  const flyTo = (path: string | null) => {
    setSelected(path);
    setFocus((f) => ({ path, system: null, nonce: f.nonce + 1 }));
  };
  const flySystem = (system: number | null) => {
    setSelected(null);
    setFocus((f) => ({ path: null, system, nonce: f.nonce + 1 }));
  };

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
      if ((e.target as HTMLElement).closest('input, textarea, .cm-editor')) return;
      if (e.key === 'Escape') flyTo(null);
      if (e.key === ' ') {
        e.preventDefault();
        setOptions((o) => ({ ...o, paused: !o.paused }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!layout.bodies.length) {
    return (
      <div className="solar empty-state">
        <h1>An empty sky</h1>
        <p className="muted">Each note becomes a planet. Write a few and link them with [[ ]] to watch them orbit.</p>
        <div className="empty-actions">
          <button className="btn primary" onClick={() => newNote()}>New note</button>
          <button className="btn" onClick={createSampleVault}>
            <Sparkles size={16} /> Create sample vault
          </button>
        </div>
      </div>
    );
  }

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
          selected={selected}
          hovered={hovered}
          focus={focus}
          options={options}
          time={time}
          onSelect={flyTo}
          onHover={(p) => {
            setHovered(p);
            document.body.style.cursor = p ? 'pointer' : '';
          }}
        />
      </Canvas>

      <FlySearch layout={layout} onPick={flyTo} />
      <SystemChips layout={layout} onPick={flySystem} />
      <Controls options={options} setOptions={setOptions} onHome={() => flySystem(null)} />
      {selected && <BodyCard layout={layout} path={selected} onFly={flyTo} onClose={() => flyTo(null)} />}
    </div>
  );
}

function FlySearch({ layout, onPick }: { layout: SolarLayout; onPick(path: string): void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    return layout.bodies
      .map((b) => ({ b, s: fuzzyScore(q, b.title) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s!)
      .slice(0, 8)
      .map((x) => x.b);
  }, [q, layout]);

  const pick = (path: string) => {
    onPick(path);
    setQ('');
    setOpen(false);
    (document.activeElement as HTMLElement)?.blur();
  };

  return (
    <div className="fly-search">
      <Search size={15} />
      <input
        value={q}
        placeholder="Fly to a note…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) pick(results[0].path);
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      {open && results.length > 0 && (
        <div className="fly-results">
          {results.map((b) => (
            <button key={b.path} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(b.path)}>
              <span className="dot" style={{ background: b.color }} />
              <span className="name">{b.title}</span>
              <span className="detail">
                {KIND_LABEL[b.kind]} · {layout.systems[b.system].name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SystemChips({ layout, onPick }: { layout: SolarLayout; onPick(system: number): void }) {
  if (layout.systems.length < 2) return null;
  return (
    <div className="system-chips">
      {layout.systems.map((s) => (
        <button key={s.id} onClick={() => onPick(s.id)}>
          <span className="dot" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
          {s.name}
        </button>
      ))}
    </div>
  );
}

function Controls({ options, setOptions, onHome }: { options: SceneOptions; setOptions(fn: (o: SceneOptions) => SceneOptions): void; onHome(): void }) {
  const toggle = (k: 'paused' | 'labels' | 'beams' | 'orbits') => setOptions((o) => ({ ...o, [k]: !o[k] }));
  return (
    <div className="solar-controls">
      <button className="icon-btn" onClick={onHome} title="See every system" aria-label="Overview">
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
    </div>
  );
}

function BodyCard({ layout, path, onFly, onClose }: { layout: SolarLayout; path: string; onFly(path: string): void; onClose(): void }) {
  const body = layout.byPath.get(path)!;
  const index = useIndex();
  const content = useVault((s) => s.files[path]?.content ?? '');
  const system = layout.systems[body.system];
  const parent = body.parent ? layout.byPath.get(body.parent) : null;
  const satellites = layout.bodies.filter((b) => b.parent === path);
  const related = [...new Set([...(index.byPath.get(path)?.outLinks ?? []), ...(index.backlinks.get(path) ?? [])])]
    .filter((p) => layout.byPath.has(p) && p !== body.parent && !satellites.some((s) => s.path === p));

  const describe =
    body.kind === 'sun'
      ? `Sun of the ${system.name} system · ${satellites.length} planet${satellites.length === 1 ? '' : 's'}`
      : body.kind === 'planet'
        ? `Planet orbiting ${parent?.title} · ${satellites.length} moon${satellites.length === 1 ? '' : 's'}`
        : body.kind === 'moon'
          ? `Moon of ${parent?.title}`
          : `Asteroid in the ${system.name} belt. Link it to pull it into orbit.`;

  const chip = (p: string) => {
    const b = layout.byPath.get(p)!;
    return (
      <button key={p} className="body-chip" onClick={() => onFly(p)}>
        <span className="dot" style={{ background: b.color }} />
        {b.title}
      </button>
    );
  };

  return (
    <div className="body-card">
      <div className="body-card-head">
        <span className="dot big" style={{ background: body.color, boxShadow: `0 0 12px ${body.color}` }} />
        <div className="titles">
          <h2>{body.title}</h2>
          <div className="muted small">{describe}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="body-card-actions">
        <button className="btn primary" onClick={() => openNote(path)}>
          <SquareArrowOutUpRight size={15} /> Open note
        </button>
        <button
          className="btn"
          onClick={async () => {
            const created = await addLinkedNote(path);
            if (created) setTimeout(() => onFly(created), 50);
          }}
        >
          <MoonStar size={15} /> Add moon
        </button>
        {parent && (
          <button className="btn" onClick={() => onFly(parent.path)}>
            <Sun size={15} /> {parent.kind === 'sun' ? 'To sun' : 'To planet'}
          </button>
        )}
      </div>
      {satellites.length > 0 && (
        <div className="chip-row">
          <div className="chip-label">{body.kind === 'sun' ? 'Planets' : 'Moons'}</div>
          {satellites.map((s) => chip(s.path))}
        </div>
      )}
      {related.length > 0 && (
        <div className="chip-row">
          <div className="chip-label">Light beams</div>
          {related.map(chip)}
        </div>
      )}
      <div className="body-card-preview">
        <Preview path={path} content={content} compact onNavigate={onFly} />
      </div>
    </div>
  );
}

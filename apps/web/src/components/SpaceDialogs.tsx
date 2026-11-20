import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Orbit, X } from 'lucide-react';
import { useUI } from '../store/ui';
import { useIndex } from '../store/vaultIndex';
import { titleOf } from '../store/vault';
import { CHILD_KIND, KIND_LABEL, orbitCandidates, useHierarchy, type SpaceKind, type SpaceNode } from '../lib/hierarchy';
import { createInOrbit, openNote, setOrbit } from '../lib/actions';
import { dirname, normalizePath } from '../lib/paths';

/** Small coloured marker for a kind of body, matching the solar system's look. */
export function KindDot({ kind }: { kind: SpaceKind }) {
  return <span className={`kind-dot kind-${kind}`} aria-hidden />;
}

const depthOf = (n: SpaceNode) => ({ blackhole: 0, star: 1, planet: 2, moon: 3, asteroid: 2 })[n.kind];
/** What a note becomes when it orbits `parent`. */
export const roleUnder = (parent: SpaceNode) => CHILD_KIND[parent.kind] ?? 'moon';

/** Choose what a note orbits. Saved as the note's "orrery-orbits" property. */
export function OrbitPicker() {
  const path = useUI((s) => s.orbitPicker);
  const h = useHierarchy();
  const [q, setQ] = useState('');
  useEffect(() => setQ(''), [path]);
  const self = path ? h.nodes.get(path) : undefined;
  const options = useMemo(() => (path ? orbitCandidates(h, path) : []), [h, path]);
  if (!path || !self) return null;
  const close = () => useUI.getState().set({ orbitPicker: null });
  const galaxy = h.galaxies[self.galaxy];
  const shown = options.filter((n) => titleOf(n.path).toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (target: string | null) => {
    setOrbit(path, target);
    close();
  };

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog sheet" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Choose an orbit">
        <div className="settings-head">
          <h2>
            <Orbit size={18} /> What should “{titleOf(path)}” orbit?
          </h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="muted small">
          Orbiting a black hole makes it a star, orbiting a star makes it a planet, and orbiting a planet makes it a moon. Only bodies in the{' '}
          <b>{galaxy.name}</b> galaxy are listed; move the note to another folder to change galaxy.
        </p>
        {options.length > 8 && <input className="picker-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a body…" autoFocus />}
        <div className="picker-list">
          <button className={`picker-row ${!self.explicit ? 'on' : ''}`} onClick={() => pick(null)}>
            <span className="picker-name">Automatic</span>
            <span className="picker-detail">follow links</span>
            {!self.explicit && <Check size={15} />}
          </button>
          {shown.map((n) => {
            const current = self.explicit && self.parent === n.path;
            return (
              <button key={n.path} className={`picker-row ${current ? 'on' : ''}`} style={{ paddingLeft: 12 + depthOf(n) * 16 }} onClick={() => pick(n.path)}>
                <KindDot kind={n.kind} />
                <span className="picker-name">{titleOf(n.path)}</span>
                <span className="picker-detail">becomes a {KIND_LABEL[roleUnder(n)]}</span>
                {current && <Check size={15} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** New note, with an optional body to orbit so it lands where you want in space. */
export function NewNoteDialog() {
  const state = useUI((s) => s.newNote);
  const h = useHierarchy();
  const index = useIndex();
  const [name, setName] = useState('');
  const [orbit, setOrbitChoice] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName('');
    setOrbitChoice(state?.orbit ?? '');
    if (state) setTimeout(() => input.current?.focus(), 0);
  }, [state]);

  if (!state) return null;
  const close = () => useUI.getState().set({ newNote: null });
  const parent = orbit ? h.nodes.get(orbit) : undefined;
  const folder = parent ? dirname(parent.path) : normalizePath(state.folder);
  const create = () => {
    const path = createInOrbit(name, parent ? parent.path : null, folder);
    close();
    openNote(path);
  };

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="New note">
        <h3>New note</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
          className="new-note-form"
        >
          <input ref={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Note name" />
          <label className="field-label">
            Orbits
            <select value={orbit} onChange={(e) => setOrbitChoice(e.target.value)}>
              <option value="">Nothing yet (decide later)</option>
              {h.galaxies.map((g) => (
                <optgroup key={g.id} label={`${g.name} galaxy`}>
                  {h.order
                    .map((p) => h.nodes.get(p)!)
                    .filter((n) => n.galaxy === g.id && n.kind !== 'asteroid' && index.byPath.has(n.path))
                    .map((n) => (
                      <option key={n.path} value={n.path}>
                        {'  '.repeat(depthOf(n))}
                        {titleOf(n.path)} ({KIND_LABEL[n.kind]})
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <p className="muted small">
            {parent
              ? `It becomes a ${KIND_LABEL[roleUnder(parent)]} orbiting ${titleOf(parent.path)}, saved in ${folder || 'the vault root'}.`
              : `Saved in ${folder || 'the vault root'}. Link it from another note, or choose an orbit later.`}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { useIndex } from '../../store/vaultIndex';
import { SURFACES, type Surface } from './shaders';
import { SURFACE_LABELS, designFromProps, saveNoteDesign, type BodyDesign, type ResolvedDesign } from './design';
import type { Body } from './layout';

const SWATCHES = ['#ff8a3d', '#ffd166', '#f25f5c', '#ef476f', '#c77dff', '#7b8cff', '#4cc9f0', '#2ec4b6', '#80ed99', '#e9edf5'];

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="design-field">
      <div className="design-label">{label}</div>
      {children}
    </div>
  );
}

export function ColorField({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button
          key={c}
          className={`swatch ${c === value ? 'on' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={`Colour ${c}`}
        />
      ))}
      <label className="swatch custom" style={{ background: value }} title="Pick any colour">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export function Slider({ value, min, max, step = 0.05, onChange }: { value: number; min: number; max: number; step?: number; onChange(v: number): void }) {
  return (
    <div className="slider-row">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span>{value.toFixed(step < 1 ? 2 : 0)}</span>
    </div>
  );
}

export function SurfacePicker({ value, onChange }: { value: Surface; onChange(s: Surface): void }) {
  return (
    <div className="chips">
      {SURFACES.map((s) => (
        <button key={s} className={`chip surface-${s} ${s === value ? 'on' : ''}`} onClick={() => onChange(s)}>
          {SURFACE_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

/** Edit one body's look; changes are written into the note's properties. */
export function DesignPanel({ body, resolved }: { body: Body; resolved: ResolvedDesign }) {
  const note = useIndex().byPath.get(body.path);
  const saved = note ? designFromProps(note.parsed.frontmatter) : {};
  const [draft, setDraft] = useState<BodyDesign>(saved);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Pick up edits made elsewhere (another device, the editor) when we aren't mid-change.
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    if (!timer.current) setDraft(JSON.parse(savedKey));
  }, [savedKey]);

  const update = (patch: BodyDesign) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      saveNoteDesign(body.path, next);
    }, 250);
  };
  const value = { ...resolved, ...draft };
  const custom = Object.keys(draft).length > 0;

  return (
    <div className="design-panel">
      {body.kind === 'blackhole' && (
        <>
          <Field label="Accretion disk">
            <ColorField value={value.disk} onChange={(disk) => update({ disk })} />
          </Field>
          <Field label="Brightness">
            <Slider value={value.brightness} min={0.2} max={3} onChange={(brightness) => update({ brightness })} />
          </Field>
          <Field label="Spin (negative turns it the other way)">
            <Slider value={value.spin} min={-3} max={3} onChange={(spin) => update({ spin })} />
          </Field>
        </>
      )}
      {(body.kind === 'planet' || body.kind === 'moon') && (
        <Field label="Surface">
          <SurfacePicker value={value.surface} onChange={(surface) => update({ surface })} />
        </Field>
      )}
      {body.kind !== 'blackhole' && (
        <Field label={body.kind === 'star' ? 'Star colour' : 'Colour'}>
          <ColorField value={value.color} onChange={(color) => update({ color })} />
        </Field>
      )}
      {body.kind === 'star' && (
        <Field label="Glow">
          <Slider value={value.glow} min={0} max={3} onChange={(glow) => update({ glow })} />
        </Field>
      )}
      {body.kind === 'planet' && (
        <Field label="Rings">
          <div className="chips">
            <button className={`chip ${value.rings ? 'on' : ''}`} onClick={() => update({ rings: true })}>
              On
            </button>
            <button className={`chip ${!value.rings ? 'on' : ''}`} onClick={() => update({ rings: false })}>
              Off
            </button>
          </div>
        </Field>
      )}
      <Field label="Size">
        <Slider value={value.size} min={0.3} max={3} onChange={(size) => update({ size })} />
      </Field>
      <div className="design-foot">
        <span className="muted small">{custom ? 'Saved in this note’s properties.' : 'Using the galaxy theme and rules.'}</span>
        {custom && (
          <button
            className="btn small"
            onClick={() => {
              clearTimeout(timer.current);
              timer.current = undefined;
              setDraft({});
              saveNoteDesign(body.path, {});
            }}
          >
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>
    </div>
  );
}

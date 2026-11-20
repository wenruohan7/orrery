import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { SURFACES, type Surface } from './shaders';
import { SURFACE_LABELS, THEMES, saveGalaxyConfig, type DesignRule, type GalaxyConfig, type ThemeId } from './design';
import { ColorField } from './DesignPanel';
import { useIndex } from '../../store/vaultIndex';

/** Galaxy-wide looks: theme presets and tag/folder rules, saved to orrery.json so every device shares them. */
export function GalaxyPanel({ config, onClose }: { config: GalaxyConfig; onClose(): void }) {
  const [draft, setDraft] = useState(config);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const index = useIndex();

  const configKey = JSON.stringify(config);
  useEffect(() => {
    if (!timer.current) setDraft(JSON.parse(configKey));
  }, [configKey]);

  const commit = (next: GalaxyConfig) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      saveGalaxyConfig(next);
    }, 400);
  };
  const setRule = (i: number, rule: DesignRule) => commit({ ...draft, rules: draft.rules.map((r, j) => (j === i ? rule : r)) });

  const suggestions = [...[...index.tags.keys()].slice(0, 30).map((t) => `#${t}`), ...index.folders];

  return (
    <div className="galaxy-panel">
      <div className="galaxy-panel-head">
        <h2>Galaxy design</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <section>
        <div className="design-label">Theme</div>
        <div className="theme-grid">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => (
            <button key={id} className={`theme-card ${draft.theme === id ? 'on' : ''}`} onClick={() => commit({ ...draft, theme: id })}>
              <span className="theme-swatches">
                {THEMES[id].stars.slice(0, 4).map((c) => (
                  <i key={c} style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                ))}
              </span>
              {THEMES[id].label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="design-label">Rules</div>
        <p className="muted small">
          Give every note with a tag or in a folder the same look. A note’s own design wins over rules, and the first matching rule wins.
        </p>
        <datalist id="rule-targets">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {draft.rules.map((rule, i) => (
          <div key={i} className="rule">
            <div className="rule-head">
              <input
                list="rule-targets"
                value={rule.match}
                placeholder="#tag or Folder"
                onChange={(e) => setRule(i, { ...rule, match: e.target.value })}
                autoCapitalize="off"
              />
              <button className="icon-btn small" onClick={() => commit({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })} aria-label="Delete rule">
                <Trash2 size={14} />
              </button>
            </div>
            <div className="rule-row">
              <select
                value={rule.design.surface ?? ''}
                onChange={(e) => {
                  const { surface: _omit, ...rest } = rule.design;
                  setRule(i, { ...rule, design: e.target.value ? { ...rest, surface: e.target.value as Surface } : rest });
                }}
              >
                <option value="">Any surface</option>
                {SURFACES.map((s) => (
                  <option key={s} value={s}>
                    {SURFACE_LABELS[s]}
                  </option>
                ))}
              </select>
              <select
                value={rule.design.rings === undefined ? '' : String(rule.design.rings)}
                onChange={(e) => {
                  const { rings: _omit, ...rest } = rule.design;
                  setRule(i, { ...rule, design: e.target.value ? { ...rest, rings: e.target.value === 'true' } : rest });
                }}
              >
                <option value="">Rings: theme</option>
                <option value="true">Rings on</option>
                <option value="false">Rings off</option>
              </select>
            </div>
            <label className="rule-color-toggle">
              <input
                type="checkbox"
                checked={!!rule.design.color}
                onChange={(e) => {
                  const { color: _omit, ...rest } = rule.design;
                  setRule(i, { ...rule, design: e.target.checked ? { ...rest, color: '#c77dff' } : rest });
                }}
              />
              Set colour
            </label>
            {rule.design.color && <ColorField value={rule.design.color} onChange={(color) => setRule(i, { ...rule, design: { ...rule.design, color } })} />}
          </div>
        ))}
        <button className="btn" onClick={() => commit({ ...draft, rules: [...draft.rules, { match: '', design: { surface: 'gas' } }] })}>
          <Plus size={15} /> Add rule
        </button>
      </section>
      <p className="muted small">Saved in orrery.json in your vault, so every synced device gets the same galaxy.</p>
    </div>
  );
}

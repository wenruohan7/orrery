import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Link2, Orbit, Plus, Unlink } from 'lucide-react';
import { useVault } from '../store/vault';
import { useIndex, type VaultIndex } from '../store/vaultIndex';
import { addLinkedNote, flyTo, openNote, openOrCreate, searchFor } from '../lib/actions';
import { CHILD_KIND, KIND_LABEL, useHierarchy } from '../lib/hierarchy';
import { useUI } from '../store/ui';
import { KindDot } from './SpaceDialogs';
import { scrollToLine } from '../lib/editorBridge';
import { isNote, noteTitle } from '../lib/paths';
import { maskCode } from '../lib/markdown';

function Section({ title, count, children, initiallyOpen = true }: { title: string; count?: number; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <section className="panel-section">
      <button className="panel-section-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
      </button>
      {open && <div className="panel-section-body">{children}</div>}
    </section>
  );
}

/** Where this note sits in the solar system, and how to move it. */
function SpaceSection({ path }: { path: string }) {
  const h = useHierarchy();
  const node = h.nodes.get(path);
  if (!node) return null;
  const galaxy = h.galaxies[node.galaxy];
  const child = CHILD_KIND[node.kind];
  const plural = (k: string, n: number) => `${n} ${k}${n === 1 ? '' : 's'}`;
  const childKinds = node.kind === 'blackhole' ? 'body' : child ?? 'moon';

  return (
    <Section title="In space">
      <div className="space-role">
        <KindDot kind={node.kind} />
        <span>
          <b>{KIND_LABEL[node.kind][0].toUpperCase() + KIND_LABEL[node.kind].slice(1)}</b>{' '}
          {node.kind === 'blackhole' ? 'at the heart of' : 'in'} the <b>{galaxy.name}</b> galaxy
        </span>
      </div>
      {node.kind === 'blackhole' ? (
        <p className="muted small space-help">Every note in the {galaxy.folder ? `“${galaxy.folder}” folder` : 'vault root'} belongs to this galaxy.</p>
      ) : (
        <div className="space-orbit">
          <span className="muted small">Orbits</span>
          {node.orbitParent ? (
            <button className="link-btn" onClick={() => openNote(node.parent ?? node.orbitParent!)}>
              {noteTitle(node.parent ?? node.orbitParent)}
            </button>
          ) : (
            <span className="small">nothing</span>
          )}
          <span className="muted small">· {node.explicit ? 'set by you' : node.kind === 'asteroid' ? 'not linked yet' : 'from links'}</span>
          <button className="btn small" onClick={() => useUI.getState().set({ orbitPicker: path })}>
            Change
          </button>
        </div>
      )}
      {node.satellites.length > 0 && (
        <div className="space-kids">
          <span className="muted small">{plural(childKinds, node.satellites.length)} orbiting</span>
          {node.satellites.map((s) => (
            <button key={s} className="pill" onClick={() => openNote(s)}>
              {noteTitle(s)}
            </button>
          ))}
        </div>
      )}
      <div className="row wrap space-actions">
        {child && (
          <button
            className="btn small"
            onClick={async () => {
              const created = await addLinkedNote(path);
              if (created) openNote(created);
            }}
          >
            <Plus size={13} /> Add {KIND_LABEL[child]}
          </button>
        )}
        <button className="btn small" onClick={() => flyTo(path)}>
          <Orbit size={13} /> Find in space
        </button>
      </div>
    </Section>
  );
}

/** The line in `content` that links to `target`, for backlink context. */
function contextLine(content: string, target: string, index: VaultIndex) {
  const lines = content.split('\n');
  const masked = maskCode(content).split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of masked[i].matchAll(/\[\[([^[\]\n|#^]+)/g)) if (index.resolve(m[1]) === target) return lines[i].trim();
  }
  return '';
}

export function RightPanel() {
  const path = useVault((s) => s.activePath);
  const index = useIndex();
  const info = path ? index.byPath.get(path) : undefined;

  const unlinked = useMemo(() => {
    if (!info) return [];
    const title = info.title.toLowerCase();
    if (title.length < 3) return [];
    const linked = new Set(index.backlinks.get(info.path) ?? []);
    return index.notes.filter((n) => n.path !== info.path && !linked.has(n.path) && n.content.toLowerCase().includes(title)).slice(0, 30);
  }, [info, index]);

  if (!path || !info) return <aside className="sidebar right"><p className="muted pad">Open a note to see its links.</p></aside>;

  const backlinks = index.backlinks.get(path) ?? [];
  return (
    <aside className="sidebar right">
      <div className="sidebar-body">
        <SpaceSection path={path} />
        <Section title="Backlinks" count={backlinks.length}>
          {backlinks.length === 0 && <p className="muted small">No notes link here yet.</p>}
          {backlinks.map((b) => (
            <button key={b} className="backlink" onClick={() => openNote(b)}>
              <div className="hit-title">{noteTitle(b)}</div>
              <div className="hit-snippet">{contextLine(index.byPath.get(b)?.content ?? '', path, index)}</div>
            </button>
          ))}
        </Section>

        <Section title="Outgoing links" count={info.outLinks.length + info.unresolved.length}>
          {info.outLinks.map((p) => (
            <button key={p} className="list-row" onClick={() => openNote(p)}>
              <Link2 size={13} />
              <span className="name">{isNote(p) ? noteTitle(p) : p}</span>
            </button>
          ))}
          {info.unresolved.map((t) => (
            <button key={t} className="list-row unresolved" onClick={() => openOrCreate(t)} title="Create this note">
              <Unlink size={13} />
              <span className="name">{t}</span>
            </button>
          ))}
        </Section>

        <Section title="Outline" count={info.parsed.headings.length}>
          {info.parsed.headings.length === 0 && <p className="muted small">Add # headings to see an outline.</p>}
          {info.parsed.headings.map((h, i) => (
            <button key={i} className="outline-row" style={{ paddingLeft: 8 + (h.level - 1) * 12 }} onClick={() => scrollToLine(h.line)}>
              {h.text.replace(/[*_`=[\]]/g, '')}
            </button>
          ))}
        </Section>

        {info.parsed.tags.length > 0 && (
          <Section title="Tags" count={info.parsed.tags.length}>
            <div className="pills">
              {info.parsed.tags.map((t) => (
                <button key={t} className="pill tag" onClick={() => searchFor(`#${t}`)}>
                  #{t}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Unlinked mentions" count={unlinked.length} initiallyOpen={false}>
          {unlinked.length === 0 && <p className="muted small">No other notes mention this title.</p>}
          {unlinked.map((n) => (
            <button key={n.path} className="list-row" onClick={() => openNote(n.path)}>
              <span className="name">{n.title}</span>
            </button>
          ))}
        </Section>
      </div>
    </aside>
  );
}

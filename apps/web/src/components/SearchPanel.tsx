import { useMemo, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useIndex, type NoteInfo } from '../store/vaultIndex';
import { useUI } from '../store/ui';
import { openNote } from '../lib/actions';

interface Hit {
  note: NoteInfo;
  score: number;
  snippet: ReactNode;
}

/** Supports plain words (all must match), "exact phrases", #tag, tag:x, path:x and -exclude. */
function parseQuery(q: string) {
  const terms: string[] = [];
  const excludes: string[] = [];
  const tags: string[] = [];
  const paths: string[] = [];
  for (const m of q.matchAll(/(-?)(?:(tag|path):)?(?:"([^"]+)"|(\S+))/g)) {
    const [, neg, field, quoted, word] = m;
    const value = (quoted ?? word).toLowerCase();
    if (field === 'tag' || (!field && value.startsWith('#') && value.length > 1)) tags.push(value.replace(/^#/, ''));
    else if (field === 'path') paths.push(value);
    else (neg ? excludes : terms).push(value);
  }
  return { terms, excludes, tags, paths };
}

function snippet(text: string, term: string): ReactNode {
  const lower = text.toLowerCase();
  const i = term ? lower.indexOf(term) : -1;
  if (i < 0) return text.slice(0, 120);
  const start = Math.max(0, i - 50);
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length, i + term.length + 80)}
    </>
  );
}

export function SearchPanel() {
  const query = useUI((s) => s.search);
  const set = useUI((s) => s.set);
  const index = useIndex();

  const hits = useMemo<Hit[]>(() => {
    const q = parseQuery(query.trim());
    if (!q.terms.length && !q.tags.length && !q.paths.length) return [];
    const out: Hit[] = [];
    for (const note of index.notes) {
      const title = note.title.toLowerCase();
      const body = note.content.toLowerCase();
      const path = note.path.toLowerCase();
      if (q.tags.some((t) => !note.parsed.tags.some((nt) => nt === t || nt.startsWith(t + '/')))) continue;
      if (q.paths.some((p) => !path.includes(p))) continue;
      if (q.excludes.some((x) => body.includes(x) || title.includes(x))) continue;
      if (q.terms.some((t) => !body.includes(t) && !title.includes(t))) continue;
      const score = q.terms.reduce((s, t) => s + (title.includes(t) ? 10 : 0) + (body.split(t).length - 1), 0);
      out.push({ note, score, snippet: snippet(note.content.replace(/\s+/g, ' '), q.terms[0] ?? '') });
    }
    return out.sort((a, b) => b.score - a.score || b.note.mtime - a.note.mtime).slice(0, 200);
  }, [query, index]);

  return (
    <div className="search">
      <div className="search-box">
        <input
          autoFocus
          value={query}
          placeholder="Search notes, #tag, path:folder"
          onChange={(e) => set({ search: e.target.value })}
        />
        {query && (
          <button className="icon-btn small" onClick={() => set({ search: '' })} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </div>
      {query.trim() && <div className="muted small pad-x">{hits.length} result{hits.length === 1 ? '' : 's'}</div>}
      <div className="list">
        {hits.map(({ note, snippet: s }) => (
          <button key={note.path} className="search-hit" onClick={() => openNote(note.path)}>
            <div className="hit-title">{note.title}</div>
            {note.folder && <div className="hit-path">{note.folder}</div>}
            <div className="hit-snippet">{s}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

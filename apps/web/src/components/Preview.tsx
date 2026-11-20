import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { useVault } from '../store/vault';
import { useIndex } from '../store/vaultIndex';
import { parseFrontmatter, renderMarkdown, splitFrontmatter, toggleTask } from '../lib/markdown';
import { editorBridge } from '../lib/editorBridge';
import { openNote, openOrCreate, searchFor } from '../lib/actions';
import { renderContext } from './resources';

interface Props {
  path: string;
  content: string;
  /** Compact previews (solar system card) don't register for outline scrolling. */
  compact?: boolean;
  onNavigate?: (path: string) => void;
}

export function Preview({ path, content, compact, onNavigate }: Props) {
  const index = useIndex();
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(content, renderContext()), [content, index]);
  const props = useMemo(() => {
    const { raw } = splitFrontmatter(content);
    // Solar designs (orrery-*) are edited from the solar system, not shown here.
    return raw ? Object.entries(parseFrontmatter(raw)).filter(([k]) => !k.startsWith('orrery-')) : [];
  }, [content]);

  useEffect(() => {
    if (compact) return;
    editorBridge.previewScroll = (line) => {
      const headingIndex = index.byPath.get(path)?.parsed.headings.findIndex((h) => h.line === line) ?? -1;
      const el = ref.current?.querySelectorAll('h1, h2, h3, h4, h5, h6')[headingIndex];
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    return () => {
      editorBridge.previewScroll = null;
    };
  }, [compact, index, path]);

  const onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const link = el.closest<HTMLElement>('a.wikilink');
    if (link) {
      e.preventDefault();
      const target = link.dataset.target;
      if (target) (onNavigate ?? openNote)(target);
      else if (link.dataset.create) openOrCreate(link.dataset.create);
      return;
    }
    const tag = el.closest<HTMLElement>('a.tag');
    if (tag) {
      e.preventDefault();
      searchFor(`#${tag.dataset.tag}`);
      return;
    }
    if (el instanceof HTMLInputElement && el.dataset.task) {
      const current = useVault.getState().files[path]?.content ?? '';
      useVault.getState().saveNote(path, toggleTask(current, Number(el.dataset.task)));
    }
  };

  return (
    <div className={`preview markdown ${compact ? 'compact' : ''}`} ref={ref} onClick={onClick}>
      {props.length > 0 && !compact && (
        <table className="properties">
          <tbody>
            {props.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{Array.isArray(v) ? v.map((x) => <span key={String(x)} className="pill">{String(x)}</span>) : String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

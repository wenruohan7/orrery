import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  Decoration, EditorView, MatchDecorator, ViewPlugin, drawSelection, dropCursor, highlightActiveLine, keymap,
  placeholder, type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting, indentOnInput } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { useVault } from '../store/vault';
import { getIndex } from '../store/vaultIndex';
import { editorBridge, wrapSelection } from '../lib/editorBridge';
import { openOrCreate, searchFor } from '../lib/actions';
import { basename, isNote, noteTitle } from '../lib/paths';
import { WIKILINK, splitLinkInner } from '../lib/markdown';
import { livePreview } from './livePreview';
import { slashCompletion } from './slashMenu';

/** Swaps live preview on and off without rebuilding the editor. */
const liveMode = new Compartment();

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700', color: 'var(--h1)' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '700', color: 'var(--h2)' },
  { tag: t.heading3, fontSize: '1.18em', fontWeight: '650', color: 'var(--h3)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650', color: 'var(--h3)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--text-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, fontFamily: 'var(--mono)', color: 'var(--code)' },
  { tag: t.quote, color: 'var(--muted-strong)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--faint)' },
  { tag: t.keyword, color: '#c792ea' },
  { tag: [t.string, t.special(t.string)], color: '#c3e88d' },
  { tag: [t.number, t.bool, t.atom], color: '#f78c6c' },
  { tag: t.comment, color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.typeName], color: '#82aaff' },
]);

const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '16px', backgroundColor: 'transparent' },
    '.cm-scroller': { fontFamily: 'var(--font)', lineHeight: '1.7', padding: '24px 0 40vh' },
    '.cm-content': { maxWidth: 'var(--line-width)', margin: '0 auto', padding: '0 24px', caretColor: 'var(--accent)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-tooltip': { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--accent-bg)', color: 'var(--text-strong)' },
    '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '8px' },
    '.cm-panels': { background: 'var(--panel)', color: 'var(--text)' },
  },
  { dark: true },
);

const linkDecorator = new MatchDecorator({
  regexp: /!?\[\[[^[\]\n]+?\]\]|(?<=^|[\s(])#[\p{L}\p{N}_][\p{L}\p{N}_/-]*/gu,
  decoration: (m) => Decoration.mark({ class: m[0].startsWith('#') ? 'cm-tag' : 'cm-wikilink' }),
});
const linkHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = linkDecorator.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = linkDecorator.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

function linkCompletion(ctx: CompletionContext) {
  const m = ctx.matchBefore(/!?\[\[[^[\]\n|#]*$/);
  if (!m) return null;
  const embed = m.text.startsWith('!');
  const from = m.from + (embed ? 3 : 2);
  const index = getIndex();
  const paths = embed ? [...index.notes.map((n) => n.path), ...index.attachments] : index.notes.map((n) => n.path);
  return {
    from,
    options: paths.map((p) => ({
      label: isNote(p) ? noteTitle(p) : basename(p),
      detail: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : undefined,
      type: isNote(p) ? 'text' : 'variable',
      apply: (view: EditorView, _c: unknown, f: number, to: number) => {
        const text = index.linkText(p);
        const closed = view.state.sliceDoc(to, to + 2) === ']]';
        view.dispatch({
          changes: { from: f, to: closed ? to + 2 : to, insert: text + ']]' },
          selection: { anchor: f + text.length + 2 },
        });
      },
    })),
    validFor: /^[^[\]\n|#]*$/,
  };
}

function tagCompletion(ctx: CompletionContext) {
  const m = ctx.matchBefore(/(?:^|[\s(])#[\p{L}\p{N}_/-]*$/u);
  if (!m) return null;
  const hash = m.text.indexOf('#');
  if (m.text.length - hash < 2 && !ctx.explicit) return null;
  return {
    from: m.from + hash + 1,
    options: [...getIndex().tags.entries()].map(([tag, list]) => ({ label: tag, detail: String(list.length), type: 'keyword' })),
    validFor: /^[\p{L}\p{N}_/-]*$/u,
  };
}

/** Find the [[link]] around a document position. */
function linkAt(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(WIKILINK)) {
    const start = line.from + m.index!;
    if (pos >= start && pos <= start + m[0].length) return splitLinkInner(m[2]).target;
  }
  return null;
}

async function insertFiles(view: EditorView, files: File[], pos: number) {
  const links: string[] = [];
  for (const file of files) {
    const name = file.name && file.name !== 'image.png' ? file.name : `Pasted image ${Date.now()}.${file.type.split('/')[1] || 'png'}`;
    const path = await useVault.getState().saveAttachment(name, file);
    links.push(`![[${getIndex().linkText(path)}]]`);
  }
  const text = links.join('\n');
  view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
}

function extensions(onChange: (doc: string) => void, live: boolean): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(highlight),
    linkHighlighter,
    autocompletion({ override: [slashCompletion, linkCompletion, tagCompletion], icons: false }),
    liveMode.of(live ? livePreview : []),
    placeholder('Start writing… Type / for blocks or [[ to link a note.'),
    keymap.of([
      { key: 'Mod-b', run: () => (wrapSelection('**'), true) },
      { key: 'Mod-i', run: () => (wrapSelection('*'), true) },
      { key: 'Mod-Shift-h', run: () => (wrapSelection('=='), true) },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => u.docChanged && onChange(u.state.doc.toString())),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        const target = e.target as HTMLElement;
        if ((e.metaKey || e.ctrlKey) && target.closest('.cm-wikilink')) {
          const link = linkAt(view, pos);
          if (link) {
            e.preventDefault();
            openOrCreate(link);
            return true;
          }
        }
        if ((e.metaKey || e.ctrlKey) && target.closest('.cm-tag')) {
          e.preventDefault();
          searchFor(target.textContent ?? '');
          return true;
        }
        return false;
      },
      paste(e, view) {
        const files = [...(e.clipboardData?.files ?? [])];
        if (!files.length) return false;
        e.preventDefault();
        void insertFiles(view, files, view.state.selection.main.head);
        return true;
      },
      drop(e, view) {
        const files = [...(e.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
        void insertFiles(view, files, pos);
        return true;
      },
    }),
    theme,
  ];
}

export function Editor({ path, live }: { path: string; live: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pathRef = useRef(path);
  const content = useVault((s) => s.files[path]?.content ?? '');
  const states = useRef(new Map<string, EditorState>());

  const makeState = (doc: string) =>
    EditorState.create({ doc, extensions: extensions((d) => useVault.getState().saveNote(pathRef.current, d), liveRef.current) });

  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
    viewRef.current?.dispatch({ effects: liveMode.reconfigure(live ? livePreview : []) });
  }, [live]);

  useEffect(() => {
    const view = new EditorView({ parent: host.current!, state: makeState(content) });
    viewRef.current = view;
    editorBridge.view = view;
    return () => {
      if (editorBridge.view === view) editorBridge.view = null;
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching notes: keep each note's undo history and cursor while the editor stays mounted.
  useEffect(() => {
    const view = viewRef.current!;
    if (pathRef.current === path) return;
    states.current.set(pathRef.current, view.state);
    pathRef.current = path;
    const saved = states.current.get(path);
    view.setState(saved && saved.doc.toString() === content ? saved : makeState(content));
    view.scrollDOM.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // The note changed elsewhere (sync, rename, preview checkbox): merge it in.
  useEffect(() => {
    const view = viewRef.current!;
    const current = view.state.doc.toString();
    if (pathRef.current !== path || current === content) return;
    let start = 0;
    while (start < current.length && current[start] === content[start]) start++;
    let endA = current.length;
    let endB = content.length;
    while (endA > start && endB > start && current[endA - 1] === content[endB - 1]) {
      endA--;
      endB--;
    }
    view.dispatch({ changes: { from: start, to: endA, insert: content.slice(start, endB) } });
  }, [content, path]);

  return <div className="editor" ref={host} />;
}


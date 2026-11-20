import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { getIndex } from '../store/vaultIndex';
import { openOrCreate } from '../lib/actions';
import { WIKILINK, splitLinkInner } from '../lib/markdown';
import { isImage } from '../lib/paths';
import { resourceUrl } from './resources';

/**
 * Obsidian-style live preview: markdown syntax is hidden and rendered on every
 * line except the ones holding the cursor, where the raw text stays editable.
 */

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly at: number) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-live-task';
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', () => {
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string) {
    super();
  }
  eq(other: TextWidget) {
    return other.text === this.text && other.cls === this.cls;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = this.cls;
    span.textContent = this.text;
    return span;
  }
}

class LinkWidget extends WidgetType {
  constructor(readonly label: string, readonly target: string, readonly exists: boolean) {
    super();
  }
  eq(other: LinkWidget) {
    return other.label === this.label && other.target === this.target && other.exists === this.exists;
  }
  toDOM() {
    const a = document.createElement('span');
    a.className = `cm-live-link${this.exists ? '' : ' unresolved'}`;
    a.textContent = this.label;
    a.addEventListener('mousedown', (e) => {
      e.preventDefault();
      openOrCreate(this.target);
    });
    return a;
  }
  ignoreEvent() {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly width?: string) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.width === this.width;
  }
  toDOM() {
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.className = 'cm-live-image';
    if (this.width) img.style.width = `${this.width}px`;
    return img;
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('span');
    hr.className = 'cm-live-hr';
    return hr;
  }
}

const hide = Decoration.replace({});

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  const activeLines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) activeLines.add(n);
  }
  const active = (pos: number) => activeLines.has(state.doc.lineAt(pos).number);
  const tree = syntaxTree(state);
  const inCode = (pos: number) => {
    for (let node = tree.resolveInner(pos, 1); node; node = node.parent!) {
      if (/^(FencedCode|CodeBlock|InlineCode|CodeText)$/.test(node.name)) return true;
      if (!node.parent) break;
    }
    return false;
  };

  for (const { from, to } of view.visibleRanges) {
    // Wiki links and embeds first; syntax nodes inside them are skipped below.
    const taken: [number, number][] = [];
    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      if (inCode(start)) continue;
      taken.push([start, end]);
      if (active(start)) continue;
      const { target, alias } = splitLinkInner(m[2]);
      const path = getIndex().resolve(target);
      const url = m[1] && path && isImage(path) ? resourceUrl(path) : null;
      if (url) ranges.push(Decoration.replace({ widget: new ImageWidget(url, target, alias && /^\d+$/.test(alias) ? alias : undefined) }).range(start, end));
      else ranges.push(Decoration.replace({ widget: new LinkWidget(alias || target, target, !!path) }).range(start, end));
    }
    const isTaken = (a: number, b: number) => taken.some(([s, e]) => a < e && b > s);
    const isInside = (a: number, b: number) => taken.some(([s, e]) => a >= s && b <= e);

    // ==highlights== aren't part of the markdown grammar.
    for (const m of text.matchAll(/==([^=\n]+)==/g)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      if (inCode(start) || isTaken(start, end)) continue;
      ranges.push(Decoration.mark({ class: 'cm-live-highlight' }).range(start + 2, end - 2));
      if (!active(start)) ranges.push(hide.range(start, start + 2), hide.range(end - 2, end));
    }

    tree.iterate({
      from,
      to,
      enter: (node) => {
        const { name } = node;
        if (isInside(node.from, node.to)) return false;
        if (/^ATXHeading(\d)$/.test(name)) {
          ranges.push(Decoration.line({ class: `cm-live-h${name.slice(-1)}` }).range(state.doc.lineAt(node.from).from));
        }
        if (name === 'Blockquote') {
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            ranges.push(Decoration.line({ class: 'cm-live-quote' }).range(line.from));
            pos = line.to + 1;
          }
        }
        if (name === 'InlineCode') ranges.push(Decoration.mark({ class: 'cm-live-code' }).range(node.from, node.to));
        if (name === 'FencedCode') {
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            ranges.push(Decoration.line({ class: 'cm-live-codeblock' }).range(line.from));
            pos = line.to + 1;
          }
          return false;
        }
        if (active(node.from)) return;

        switch (name) {
          case 'HeaderMark': {
            const next = state.sliceDoc(node.to, node.to + 1);
            if (node.node.parent?.name.startsWith('ATXHeading')) ranges.push(hide.range(node.from, node.to + (next === ' ' ? 1 : 0)));
            break;
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            ranges.push(hide.range(node.from, node.to));
            break;
          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode') ranges.push(hide.range(node.from, node.to));
            break;
          case 'QuoteMark': {
            const next = state.sliceDoc(node.to, node.to + 1);
            ranges.push(hide.range(node.from, node.to + (next === ' ' ? 1 : 0)));
            break;
          }
          case 'Link': {
            const marks = node.node.getChildren('LinkMark');
            const url = node.node.getChild('URL');
            if (marks.length >= 2 && url) {
              ranges.push(hide.range(node.from, marks[0].to));
              ranges.push(Decoration.mark({ class: 'cm-live-mdlink' }).range(marks[0].to, marks[1].from));
              ranges.push(hide.range(marks[1].from, node.to));
            }
            return false;
          }
          case 'ListMark': {
            const item = node.node.parent;
            const task = item?.getChild('Task');
            const after = state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0;
            if (task) ranges.push(hide.range(node.from, node.to + after));
            else if (item?.parent?.name === 'BulletList') {
              ranges.push(Decoration.replace({ widget: new TextWidget('•', 'cm-live-bullet') }).range(node.from, node.to));
            }
            break;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to));
            ranges.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to));
            if (checked) {
              const line = state.doc.lineAt(node.from);
              if (node.to + 1 < line.to) ranges.push(Decoration.mark({ class: 'cm-live-done' }).range(node.to + 1, line.to));
            }
            break;
          }
          case 'HorizontalRule':
            ranges.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
            break;
        }
      },
    });
  }
  return Decoration.set(ranges, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

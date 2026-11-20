import type { EditorView } from '@codemirror/view';

/** The editor currently on screen, so toolbars and commands can act on it. */
export const editorBridge = {
  view: null as EditorView | null,
  /** Called with a 0-based line when the preview should scroll instead. */
  previewScroll: null as ((line: number) => void) | null,
};

export function insertAtCursor(text: string) {
  const view = editorBridge.view;
  if (!view) return false;
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
  view.focus();
  return true;
}

export function wrapSelection(before: string, after = before) {
  const view = editorBridge.view;
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: before + selected + after },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  });
  view.focus();
}

/** Toggle a prefix such as "- [ ] " or "## " on every selected line. */
export function toggleLinePrefix(prefix: string, pattern: RegExp) {
  const view = editorBridge.view;
  if (!view) return;
  const { state } = view;
  const changes = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const m = pattern.exec(line.text);
        changes.push(m ? { from: line.from, to: line.from + m[0].length, insert: '' } : { from: line.from, insert: prefix });
      }
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes });
  view.focus();
}

export function scrollToLine(line: number) {
  const view = editorBridge.view;
  if (view) {
    const l = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
    view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
    view.focus();
  } else editorBridge.previewScroll?.(line);
}

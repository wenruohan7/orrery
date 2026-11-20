import { startCompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { useVault } from '../store/vault';
import { getIndex } from '../store/vaultIndex';
import { useUI } from '../store/ui';
import { formatDate } from '../lib/dates';

interface SlashItem {
  label: string;
  detail?: string;
  /** Text to insert; `|` marks where the cursor goes. */
  text?: string;
  run?(view: EditorView, at: number): void;
}

function pickFiles(view: EditorView, at: number) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = async () => {
    const links: string[] = [];
    for (const file of input.files ?? []) {
      const path = await useVault.getState().saveAttachment(file.name, file);
      links.push(`![[${getIndex().linkText(path)}]]`);
    }
    const text = links.join('\n');
    view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
    view.focus();
  };
  input.click();
}

const ITEMS: SlashItem[] = [
  { label: 'Heading 1', detail: '#', text: '# |' },
  { label: 'Heading 2', detail: '##', text: '## |' },
  { label: 'Heading 3', detail: '###', text: '### |' },
  { label: 'Task', detail: '- [ ]', text: '- [ ] |' },
  { label: 'Bulleted list', detail: '-', text: '- |' },
  { label: 'Numbered list', detail: '1.', text: '1. |' },
  { label: 'Link to a note', detail: '[[ ]]', text: '[[|]]' },
  { label: 'Image or file', detail: 'attach', run: pickFiles },
  { label: 'Quote', detail: '>', text: '> |' },
  { label: 'Callout', detail: '> [!note]', text: '> [!note] |\n> ' },
  { label: 'Code block', detail: '```', text: '```\n|\n```' },
  { label: 'Table', detail: '| |', text: '| Column | Column |\n| --- | --- |\n| | |\n|' },
  { label: 'Divider', detail: '---', text: '---\n|' },
  { label: 'Highlight', detail: '==', text: '==|==' },
  { label: 'Template', detail: 'insert', run: () => useUI.getState().set({ palette: 'templates' }) },
  { label: "Today's date", detail: 'date', text: '' },
  { label: 'Current time', detail: 'time', text: '' },
];

function apply(item: SlashItem) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const start = from - 1; // include the slash
    view.dispatch({ changes: { from: start, to, insert: '' } });
    if (item.run) return item.run(view, start);
    let text = item.text ?? '';
    if (item.label === "Today's date") text = formatDate(new Date()) + '|';
    if (item.label === 'Current time') text = formatDate(new Date(), 'HH:mm') + '|';
    const cursor = text.indexOf('|');
    const insert = text.replace('|', '');
    view.dispatch({ changes: { from: start, insert }, selection: { anchor: start + (cursor < 0 ? insert.length : cursor) } });
    if (item.text?.startsWith('[[')) startCompletion(view);
  };
}

/** Type "/" at the start of a line or after a space to insert blocks; handy on phones. */
export function slashCompletion(ctx: CompletionContext) {
  const m = ctx.matchBefore(/(?:^|\s)\/[\w']*$/);
  if (!m) return null;
  const slash = m.from + m.text.indexOf('/');
  return {
    from: slash + 1,
    options: ITEMS.map((item, i) => ({ label: item.label, detail: item.detail, apply: apply(item), boost: -i })),
    validFor: /^[\w']*$/,
  };
}

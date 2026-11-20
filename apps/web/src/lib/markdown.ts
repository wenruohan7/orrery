import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { isAudio, isImage, isPdf, isVideo } from './paths';

export interface WikiLink {
  target: string;
  alias?: string;
  embed: boolean;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export interface ParsedNote {
  links: WikiLink[];
  tags: string[];
  headings: Heading[];
  frontmatter: Record<string, unknown>;
  words: number;
  tasks: { done: number; total: number };
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
export const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const TAG = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/;

export function splitFrontmatter(content: string): { raw: string; body: string; offsetLines: number } {
  const m = FRONTMATTER.exec(content);
  if (!m) return { raw: '', body: content, offsetLines: 0 };
  return { raw: m[1], body: content.slice(m[0].length), offsetLines: m[0].split('\n').length - 1 };
}

/** Minimal YAML subset: `key: value`, `key: [a, b]` and `key:` followed by `- item` lines. */
export function parseFrontmatter(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (out[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([\w-][\w\s-]*?):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    listKey = null;
    if (!value) {
      out[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(value)) {
      out[key] = value.slice(1, -1).split(',').map((s) => unquote(s)).filter(Boolean);
    } else {
      out[key] = unquote(value);
    }
  }
  return out;
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');

/** Blank out code so links and tags inside code aren't picked up; keeps offsets and line numbers. */
export function maskCode(text: string) {
  return text
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

export function splitLinkInner(inner: string): { target: string; alias?: string } {
  const pipe = inner.indexOf('|');
  const rawTarget = pipe < 0 ? inner : inner.slice(0, pipe);
  const alias = pipe < 0 ? undefined : inner.slice(pipe + 1).trim();
  const target = rawTarget.replace(/[#^].*$/, '').trim();
  return { target, alias };
}

export function parseNote(content: string): ParsedNote {
  const { raw, body, offsetLines } = splitFrontmatter(content);
  const frontmatter = raw ? parseFrontmatter(raw) : {};
  const masked = maskCode(body);

  const links: WikiLink[] = [];
  for (const m of masked.matchAll(WIKILINK)) {
    const { target, alias } = splitLinkInner(m[2]);
    if (target) links.push({ target, alias, embed: m[1] === '!' });
  }

  const tags = new Set<string>();
  for (const m of masked.matchAll(TAG)) if (!/^\d+$/.test(m[2])) tags.add(m[2].toLowerCase());
  const fmTags = frontmatter.tags ?? frontmatter.tag;
  for (const t of Array.isArray(fmTags) ? fmTags : typeof fmTags === 'string' ? fmTags.split(/[,\s]+/) : []) {
    const clean = String(t).replace(/^#/, '').toLowerCase();
    if (clean) tags.add(clean);
  }

  const headings: Heading[] = [];
  let done = 0;
  let total = 0;
  masked.split('\n').forEach((line, i) => {
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (h) headings.push({ level: h[1].length, text: h[2], line: i + offsetLines });
    const t = TASK_LINE.exec(line);
    if (t) {
      total++;
      if (t[2] !== ' ') done++;
    }
  });

  const words = (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  return { links, tags: [...tags], headings, frontmatter, words, tasks: { done, total } };
}

/** Set, replace or (with null) remove top-level properties, keeping everything else as written. */
export function setProperties(content: string, patch: Record<string, string | null>) {
  const m = FRONTMATTER.exec(content);
  const lines = m ? m[1].split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(patch)) {
    const at = lines.findIndex((l) => l.startsWith(key + ':'));
    if (value == null) {
      if (at >= 0) lines.splice(at, 1);
    } else if (at >= 0) lines[at] = `${key}: ${value}`;
    else lines.push(`${key}: ${value}`);
  }
  const body = m ? content.slice(m[0].length) : content;
  return lines.some((l) => l.trim()) ? `---\n${lines.join('\n')}\n---\n${body}` : body;
}

/** Flip the n-th task checkbox (0-based, in document order, skipping code). */
export function toggleTask(content: string, n: number) {
  const masked = maskCode(content).split('\n');
  const lines = content.split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!TASK_LINE.test(masked[i])) continue;
    if (seen++ === n) {
      lines[i] = lines[i].replace(TASK_LINE, (_, a, mark, c) => a + (mark === ' ' ? 'x' : ' ') + c);
      break;
    }
  }
  return lines.join('\n');
}

/** Rewrite wiki link targets. `map` returns the new target text, or null to keep the link. */
export function rewriteLinks(content: string, map: (target: string) => string | null) {
  return content.replace(/(!?\[\[)([^[\]\n|#^]+)([#^][^[\]\n|]*)?(\|[^[\]\n]*)?\]\]/g, (whole, open, target, sub = '', alias = '') => {
    const next = map(target.trim());
    return next == null ? whole : `${open}${next}${sub}${alias}]]`;
  });
}

// ---------- rendering ----------

export interface RenderContext {
  /** Resolve a link target to a vault path, or null if no such file exists. */
  resolve(target: string): string | null;
  /** Object URL for an attachment path, if its data is available. */
  resourceUrl(path: string): string | null;
  /** Raw markdown of a note, for ![[note]] embeds. */
  noteContent(path: string): string | null;
}

let ctx: RenderContext | null = null;
let depth = 0;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface WikiToken extends Tokens.Generic {
  embed: boolean;
  inner: string;
}

const md = new Marked({ gfm: true, breaks: true });
md.use({
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start(src: string) {
        const i = src.indexOf('[[');
        if (i < 0) return undefined;
        return i > 0 && src[i - 1] === '!' ? i - 1 : i;
      },
      tokenizer(src: string) {
        const m = /^(!?)\[\[([^[\]\n]+?)\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], embed: m[1] === '!', inner: m[2] } as WikiToken;
        return undefined;
      },
      renderer(token) {
        return renderWikiLink(token as WikiToken);
      },
    },
    {
      name: 'tag',
      level: 'inline',
      start(src: string) {
        const m = /(^|[\s(])#[\p{L}\p{N}_]/u.exec(src);
        return m ? m.index + m[1].length : undefined;
      },
      tokenizer(src: string) {
        const m = /^#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/u.exec(src);
        if (m && !/^\d+$/.test(m[1])) return { type: 'tag', raw: m[0], tag: m[1] };
        return undefined;
      },
      renderer(token) {
        return `<a class="tag" data-tag="${esc(token.tag.toLowerCase())}">#${esc(token.tag)}</a>`;
      },
    },
    {
      name: 'highlight',
      level: 'inline',
      start(src: string) {
        const i = src.indexOf('==');
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        const m = /^==([^=\n]+)==/.exec(src);
        if (m) return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
        return undefined;
      },
      renderer(token) {
        return `<mark>${this.parser.parseInline(token.tokens!)}</mark>`;
      },
    },
  ],
});

function renderWikiLink(tok: WikiToken): string {
  const { target, alias } = splitLinkInner(tok.inner);
  const path = ctx?.resolve(target) ?? null;
  const label = esc(alias || tok.inner.split('|')[0].trim());

  if (tok.embed && path) {
    const url = ctx!.resourceUrl(path);
    const width = alias && /^\d+$/.test(alias) ? ` width="${alias}"` : '';
    if (isImage(path)) return url ? `<img src="${url}" alt="${esc(target)}"${width}>` : `<span class="missing">${label}</span>`;
    if (isAudio(path) && url) return `<audio controls src="${url}"></audio>`;
    if (isVideo(path) && url) return `<video controls playsinline src="${url}"></video>`;
    if (isPdf(path) && url) return `<a href="${url}" target="_blank" rel="noopener">📄 ${label}</a>`;
    const content = ctx!.noteContent(path);
    if (content != null && depth < 2) {
      depth++;
      try {
        return `<div class="embed"><a class="wikilink embed-title" data-target="${esc(path)}">${esc(target)}</a>${renderBody(content)}</div>`;
      } finally {
        depth--;
      }
    }
  }
  if (path) return `<a class="wikilink" data-target="${esc(path)}">${label}</a>`;
  return `<a class="wikilink unresolved" data-create="${esc(target)}">${label}</a>`;
}

function renderBody(markdown: string) {
  return md.parse(splitFrontmatter(markdown).body, { async: false }) as string;
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const CALLOUT_ICONS: Record<string, string> = {
  note: '✎', info: 'ℹ', tip: '💡', hint: '💡', success: '✓', done: '✓', question: '?', warning: '⚠',
  caution: '⚠', danger: '⚡', error: '✕', bug: '🐞', example: '◆', quote: '❝', todo: '☐', abstract: '☰', summary: '☰',
};

export function renderMarkdown(markdown: string, context: RenderContext): string {
  ctx = context;
  depth = 0;
  const html = DOMPurify.sanitize(renderBody(markdown), {
    ADD_ATTR: ['data-target', 'data-create', 'data-tag', 'target', 'controls', 'playsinline'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
  ctx = null;

  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  // Obsidian-style callouts: > [!type] Title
  tpl.content.querySelectorAll('blockquote').forEach((bq) => {
    const first = bq.firstElementChild;
    const m = first?.tagName === 'P' ? /^\[!(\w+)\]([+-]?)[ \t]*((?:(?!<br\s*\/?>)[^\n])*)/.exec(first.innerHTML) : null;
    if (!first || !m) return;
    const type = m[1].toLowerCase();
    const title = document.createElement('div');
    title.className = 'callout-title';
    title.innerHTML = `<span class="callout-icon">${CALLOUT_ICONS[type] ?? '✎'}</span><span>${m[3].trim() || type[0].toUpperCase() + type.slice(1)}</span>`;
    first.innerHTML = first.innerHTML.slice(m[0].length).replace(/^\s*<br\s*\/?>\s*/, '');
    if (!first.textContent?.trim() && !first.children.length) first.remove();
    const div = document.createElement('div');
    div.className = `callout callout-${type}`;
    div.append(title, ...bq.childNodes);
    bq.replaceWith(div);
  });
  // Task checkboxes become clickable; embeds keep theirs read-only.
  let n = 0;
  tpl.content.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((box) => {
    if (box.closest('.embed')) return;
    box.removeAttribute('disabled');
    box.dataset.task = String(n++);
    box.closest('li')?.classList.add('task');
  });
  return tpl.innerHTML;
}

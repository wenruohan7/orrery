import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashBytes } from './hash';

const PORT = Number(process.env.PORT ?? 8787);
const VAULT = resolve(process.env.ORRERY_VAULT ?? join(import.meta.dir, '..', 'vault'));
const STATIC = resolve(process.env.ORRERY_STATIC ?? join(import.meta.dir, '..', 'apps', 'web', 'dist'));
const META_DIR = join(VAULT, '.orrery');
const META_FILE = join(META_DIR, 'meta.json');
const ALLOWED = /\.(md|png|jpe?g|gif|webp|svg|avif|mp3|m4a|wav|ogg|flac|mp4|webm|mov|pdf|txt|csv|json)$/i;
const MAX_UPLOAD = 50 * 1024 * 1024;

interface Entry {
  rev: number;
  hash: string;
  deleted: boolean;
  mtime: number;
  size: number;
}
interface Meta {
  rev: number;
  files: Record<string, Entry>;
}

class HttpError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

await mkdir(META_DIR, { recursive: true });
let meta: Meta = await readFile(META_FILE, 'utf8').then(JSON.parse, () => ({ rev: 0, files: {} }));
const TOKEN = process.env.ORRERY_TOKEN ?? (await loadToken());

async function loadToken() {
  const file = join(META_DIR, 'token');
  const existing = await readFile(file, 'utf8').catch(() => '');
  if (existing.trim()) return existing.trim();
  const token = randomBytes(18).toString('base64url');
  await writeFile(file, token + '\n', { mode: 0o600 });
  return token;
}

const saveMeta = () => writeFile(META_FILE, JSON.stringify(meta));

// Every vault operation runs one at a time so revisions stay consistent.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

const isNote = (p: string) => /\.md$/i.test(p);

async function walk(dir: string, out: string[]) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await walk(full, out);
    else if (ent.isFile() && ALLOWED.test(ent.name)) out.push(relative(VAULT, full).split(sep).join('/'));
  }
}

/** Pick up edits made directly in the vault folder (another editor, a file manager, git...). */
async function rescan() {
  const paths: string[] = [];
  await walk(VAULT, paths);
  const found = new Set(paths);
  let changed = false;
  for (const p of paths) {
    const st = await stat(join(VAULT, p));
    const e = meta.files[p];
    if (e && !e.deleted && e.mtime === st.mtimeMs && e.size === st.size) continue;
    const hash = hashBytes(new Uint8Array(await readFile(join(VAULT, p))));
    if (e && !e.deleted && e.hash === hash) {
      Object.assign(e, { mtime: st.mtimeMs, size: st.size });
    } else {
      meta.files[p] = { rev: ++meta.rev, hash, deleted: false, mtime: st.mtimeMs, size: st.size };
    }
    changed = true;
  }
  for (const [p, e] of Object.entries(meta.files)) {
    if (!e.deleted && !found.has(p)) {
      meta.files[p] = { ...e, rev: ++meta.rev, deleted: true };
      changed = true;
    }
  }
  if (changed) await saveMeta();
}

function safePath(input: unknown) {
  if (typeof input !== 'string' || !input) throw new HttpError(400, 'Missing path');
  const rel = input.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = rel.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..' || s.startsWith('.'))) throw new HttpError(400, 'Invalid path');
  if (!ALLOWED.test(rel)) throw new HttpError(400, 'File type not allowed');
  const full = resolve(VAULT, rel);
  if (!full.startsWith(VAULT + sep)) throw new HttpError(400, 'Invalid path');
  return { rel, full };
}

const describe = async (path: string, withContent: boolean) => {
  const e = meta.files[path];
  const out: Record<string, unknown> = { path, rev: e.rev, hash: e.hash, deleted: e.deleted, kind: isNote(path) ? 'note' : 'binary' };
  if (withContent && !e.deleted && isNote(path)) out.content = await readFile(join(VAULT, path), 'utf8');
  return out;
};

async function removeEmptyDirs(dir: string) {
  while (dir.startsWith(VAULT + sep)) {
    if ((await readdir(dir)).length) return;
    await rmdir(dir).catch(() => {});
    dir = dirname(dir);
  }
}

const routes: Record<string, (req: Request, url: URL) => Promise<Response>> = {
  'GET /api/ping': () =>
    serial(async () => {
      await rescan();
      const files = Object.values(meta.files).filter((e) => !e.deleted).length;
      return Response.json({ name: 'orrery', rev: meta.rev, files });
    }),

  'GET /api/changes': (_req, url) =>
    serial(async () => {
      await rescan();
      const since = Number(url.searchParams.get('since') ?? 0);
      const paths = Object.keys(meta.files).filter((p) => meta.files[p].rev > since);
      paths.sort((a, b) => meta.files[a].rev - meta.files[b].rev);
      const changes = await Promise.all(paths.map((p) => describe(p, true)));
      return Response.json({ rev: meta.rev, changes });
    }),

  'GET /api/raw': (_req, url) =>
    serial(async () => {
      const { rel, full } = safePath(url.searchParams.get('path'));
      if (!meta.files[rel] || meta.files[rel].deleted) throw new HttpError(404, 'Not found');
      return new Response(Bun.file(full));
    }),

  'PUT /api/file': (req) =>
    serial(async () => {
      const length = Number(req.headers.get('content-length') ?? 0);
      if (length > MAX_UPLOAD * 1.4) throw new HttpError(413, 'File too large');
      const body = (await req.json()) as { path: string; baseRev: number; encoding: 'utf8' | 'base64'; content: string };
      const { rel, full } = safePath(body.path);
      const bytes = body.encoding === 'base64' ? new Uint8Array(Buffer.from(body.content, 'base64')) : new TextEncoder().encode(body.content);
      const hash = hashBytes(bytes);
      await rescan();
      const e = meta.files[rel];
      if (e && !e.deleted && e.rev !== body.baseRev) {
        if (e.hash === hash) return Response.json({ rev: e.rev, hash });
        throw new HttpError(409, 'Conflict', { conflict: true, entry: await describe(rel, true) });
      }
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, bytes);
      const st = await stat(full);
      meta.files[rel] = { rev: ++meta.rev, hash, deleted: false, mtime: st.mtimeMs, size: st.size };
      await saveMeta();
      return Response.json({ rev: meta.rev, hash });
    }),

  'DELETE /api/file': (_req, url) =>
    serial(async () => {
      const { rel, full } = safePath(url.searchParams.get('path'));
      const baseRev = Number(url.searchParams.get('baseRev') ?? 0);
      await rescan();
      const e = meta.files[rel];
      if (!e || e.deleted) return Response.json({ rev: meta.rev });
      if (e.rev !== baseRev) throw new HttpError(409, 'Conflict', { conflict: true, entry: await describe(rel, true) });
      await rm(full, { force: true });
      await removeEmptyDirs(dirname(full));
      meta.files[rel] = { ...e, rev: ++meta.rev, deleted: true };
      await saveMeta();
      return Response.json({ rev: meta.rev });
    }),
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
};

function authorized(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function serveStatic(url: URL) {
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const full = resolve(STATIC, rel);
  if (full.startsWith(STATIC + sep)) {
    const file = Bun.file(full);
    if (await file.exists()) {
      const immutable = rel.startsWith('assets/');
      return new Response(file, { headers: { 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' } });
    }
  }
  const index = Bun.file(join(STATIC, 'index.html'));
  if (await index.exists()) return new Response(index, { headers: { 'Cache-Control': 'no-cache' } });
  return new Response('Orrery sync server is running. Build the web app (bun run build) to serve it from here.', { status: 404 });
}

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  maxRequestBodySize: MAX_UPLOAD * 1.4,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!url.pathname.startsWith('/api/')) return serveStatic(url);
    const route = routes[`${req.method} ${url.pathname}`];
    try {
      if (!route) throw new HttpError(404, 'Not found');
      if (!authorized(req)) throw new HttpError(401, 'Unauthorized');
      const res = await route(req, url);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, String(err));
      if (e.status === 500) console.error(err);
      return Response.json(e.body ?? { error: e.message }, { status: e.status, headers: cors });
    }
  },
});

const lanUrls = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => `http://${i!.address}:${PORT}`);

console.log(`
  Orrery sync server
  vault:  ${VAULT}
  token:  ${TOKEN}
  local:  http://localhost:${PORT}
${lanUrls.map((u) => `  lan:    ${u}`).join('\n')}
`);

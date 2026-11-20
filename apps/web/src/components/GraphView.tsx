import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { useIndex, structureKey } from '../store/vaultIndex';
import { useVault } from '../store/vault';
import { openNote } from '../lib/actions';
import { seeded } from '../lib/hash';
import { topFolder } from '../lib/paths';

interface Node extends SimulationNodeDatum {
  id: string;
  title: string;
  degree: number;
  color: string;
}
type Link = SimulationLinkDatum<Node> & { source: Node | string; target: Node | string };

export default function GraphView() {
  const index = useIndex();
  const key = structureKey(index);
  const active = useVault((s) => s.activePath);
  const [local, setLocal] = useState(false);
  const [orphans, setOrphans] = useState(true);
  const [filter, setFilter] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);

  const graph = useMemo(() => {
    let notes = index.notes;
    if (local && active) {
      const keep = new Set([active, ...(index.byPath.get(active)?.outLinks ?? []), ...(index.backlinks.get(active) ?? [])]);
      notes = notes.filter((n) => keep.has(n.path));
    }
    if (filter.trim()) notes = notes.filter((n) => n.path.toLowerCase().includes(filter.trim().toLowerCase()));
    const ids = new Set(notes.map((n) => n.path));
    const links: Link[] = [];
    const degree = new Map<string, number>();
    for (const n of notes)
      for (const t of n.outLinks)
        if (ids.has(t)) {
          links.push({ source: n.path, target: t });
          degree.set(n.path, (degree.get(n.path) ?? 0) + 1);
          degree.set(t, (degree.get(t) ?? 0) + 1);
        }
    const nodes: Node[] = notes
      .filter((n) => orphans || degree.get(n.path) || n.path === active)
      .map((n) => ({
        id: n.path,
        title: n.title,
        degree: degree.get(n.path) ?? 0,
        color: `hsl(${Math.floor(seeded(topFolder(n.path) || 'home') * 360)} 65% 66%)`,
      }));
    const kept = new Set(nodes.map((n) => n.id));
    return { nodes, links: links.filter((l) => kept.has(l.source as string) && kept.has(l.target as string)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, local, orphans, filter, local ? active : null]);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const { nodes, links } = graph;
    const neighbours = new Map<string, Set<string>>();
    const sim = forceSimulation(nodes)
      .force('link', forceLink<Node, Link>(links).id((d) => d.id).distance(60).strength(0.5))
      .force('charge', forceManyBody().strength(-160))
      .force('center', forceCenter(0, 0))
      .force('x', forceX(0).strength(0.04))
      .force('y', forceY(0).strength(0.04))
      .force('collide', forceCollide<Node>((d) => radius(d) + 4));
    for (const l of links) {
      const a = (l.source as Node).id;
      const b = (l.target as Node).id;
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      if (!neighbours.has(b)) neighbours.set(b, new Set());
      neighbours.get(a)!.add(b);
      neighbours.get(b)!.add(a);
    }

    let view = { x: 0, y: 0, k: 1 };
    let hover: Node | null = null;
    let dragging: Node | null = null;
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;

    function radius(n: Node) {
      return 4 + Math.sqrt(n.degree) * 2.6;
    }
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      el.width = width * dpr;
      el.height = height * dpr;
      draw();
    };
    const toWorld = (sx: number, sy: number) => {
      const r = el.getBoundingClientRect();
      return { x: (sx - r.left - r.width / 2 - view.x) / view.k, y: (sy - r.top - r.height / 2 - view.y) / view.k };
    };
    const nodeAt = (sx: number, sy: number) => {
      const p = toWorld(sx, sy);
      let best: Node | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x! - p.x, n.y! - p.y);
        if (d < radius(n) + 6 / view.k && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };

    function draw() {
      const { width, height } = el;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, width / 2 + view.x * dpr, height / 2 + view.y * dpr);
      const focus = hover?.id ?? null;
      const near = focus ? neighbours.get(focus) ?? new Set() : null;

      ctx.lineWidth = 1 / view.k;
      for (const l of links) {
        const s = l.source as Node;
        const t = l.target as Node;
        const lit = focus && (s.id === focus || t.id === focus);
        ctx.strokeStyle = lit ? 'rgba(170,150,255,0.9)' : focus ? 'rgba(140,130,190,0.08)' : 'rgba(140,130,190,0.28)';
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }
      for (const n of nodes) {
        const dim = focus && n.id !== focus && !near!.has(n.id);
        ctx.globalAlpha = dim ? 0.2 : 1;
        ctx.fillStyle = n.id === active ? '#ffffff' : n.color;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, radius(n), 0, Math.PI * 2);
        ctx.fill();
        if (n.id === active) {
          ctx.strokeStyle = '#a99bff';
          ctx.lineWidth = 2 / view.k;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      const showAll = view.k > 1.1 || nodes.length < 40;
      ctx.font = `${12 / Math.max(view.k, 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const n of nodes) {
        const lit = n.id === focus || near?.has(n.id) || n.id === active;
        if (!showAll && !lit && n.degree < 4) continue;
        if (focus && !lit) continue;
        ctx.fillStyle = lit ? '#f1efff' : 'rgba(220,216,240,0.75)';
        ctx.fillText(n.title, n.x!, n.y! + radius(n) + 13 / Math.max(view.k, 0.6));
      }
    }

    sim.on('tick', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });

    // Pointer handling: drag nodes, pan the background, pinch or wheel to zoom.
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pointers.size === 1) {
        dragging = nodeAt(e.clientX, e.clientY);
        if (dragging) {
          dragging.fx = dragging.x;
          dragging.fy = dragging.y;
          sim.alphaTarget(0.25).restart();
        }
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        if (dragging) {
          dragging.fx = dragging.fy = null;
          dragging = null;
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        const h = nodeAt(e.clientX, e.clientY);
        if (h !== hover) {
          hover = h;
          el.style.cursor = h ? 'pointer' : 'grab';
          draw();
        }
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      moved += Math.abs(dx) + Math.abs(dy);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
        pinch = d;
      } else if (dragging) {
        const p = toWorld(e.clientX, e.clientY);
        dragging.fx = p.x;
        dragging.fy = p.y;
      } else {
        view = { ...view, x: view.x + dx, y: view.y + dy };
        draw();
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (dragging) {
        if (moved < 6) openNote(dragging.id);
        dragging.fx = dragging.fy = null;
        dragging = null;
        sim.alphaTarget(0);
      }
    };
    const zoomAt = (sx: number, sy: number, factor: number) => {
      const r = el.getBoundingClientRect();
      const k = Math.min(6, Math.max(0.15, view.k * factor));
      const cx = sx - r.left - r.width / 2;
      const cy = sy - r.top - r.height / 2;
      view = { k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k };
      draw();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => {
      sim.stop();
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [graph, active]);

  return (
    <div className="graph">
      <canvas ref={canvas} />
      <div className="graph-controls">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by path…" />
        <label>
          <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} disabled={!active} /> Only this note's links
        </label>
        <label>
          <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} /> Show unlinked notes
        </label>
      </div>
      <div className="graph-count muted small">
        {graph.nodes.length} notes · {graph.links.length} links
      </div>
    </div>
  );
}

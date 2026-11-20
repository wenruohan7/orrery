import { useEffect, useMemo, useRef, type ElementRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, LineLoop, PerspectiveCamera, SRGBColorSpace,
  Vector3, type Object3D,
} from 'three';
import type { Body, SolarLayout } from './layout';

export interface Focus {
  path: string | null;
  system: number | null;
  nonce: number;
}

export interface SceneOptions {
  paused: boolean;
  speed: number;
  labels: boolean;
  beams: boolean;
  orbits: boolean;
}

interface Props {
  layout: SolarLayout;
  selected: string | null;
  hovered: string | null;
  focus: Focus;
  options: SceneOptions;
  time: MutableRefObject<number>;
  onSelect(path: string | null): void;
  onHover(path: string | null): void;
}

// ---------- textures, made once ----------

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const glowTexture = canvasTexture(128, 128, (ctx) => {
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
});

const ringTexture = canvasTexture(128, 128, (ctx) => {
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.stroke();
});

const labels = new Map<string, { tex: CanvasTexture; aspect: number }>();
function labelTexture(text: string) {
  const hit = labels.get(text);
  if (hit) return hit;
  const font = '600 44px system-ui, -apple-system, "Segoe UI", sans-serif';
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const label = text.length > 28 ? text.slice(0, 27) + '…' : text;
  const w = Math.ceil(measure.measureText(label).width) + 24;
  const tex = canvasTexture(w, 64, (ctx) => {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(235,232,255,0.95)';
    ctx.fillText(label, w / 2, 33);
  });
  const entry = { tex, aspect: w / 64 };
  labels.set(text, entry);
  return entry;
}

const circle = (() => {
  const g = new BufferGeometry();
  const pts = new Float32Array(128 * 3);
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    pts.set([Math.cos(a), 0, Math.sin(a)], i * 3);
  }
  g.setAttribute('position', new BufferAttribute(pts, 3));
  return g;
})();

// ---------- pieces ----------

/** Background stars on a sphere that travels with the camera, so they can never be reached. */
function Starfield({ radius }: { radius: number }) {
  const ref = useRef<Group>(null);
  const layers = useMemo(
    () =>
      [
        { count: 5000, size: 1.3, opacity: 0.55 },
        { count: 900, size: 2.2, opacity: 0.85 },
      ].map(({ count, size, opacity }) => {
        const pos = new Float32Array(count * 3);
        const col = new Float32Array(count * 3);
        const c = new Color();
        for (let i = 0; i < count; i++) {
          const u = Math.random() * 2 - 1;
          const a = Math.random() * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          pos.set([s * Math.cos(a) * radius, u * radius, s * Math.sin(a) * radius], i * 3);
          c.setHSL(0.55 + Math.random() * 0.2, 0.25 + Math.random() * 0.35, 0.72 + Math.random() * 0.25);
          col.set([c.r, c.g, c.b], i * 3);
        }
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(pos, 3));
        g.setAttribute('color', new BufferAttribute(col, 3));
        return { g, size, opacity };
      }),
    [radius],
  );
  useFrame(({ camera }) => ref.current?.position.copy(camera.position));
  return (
    <group ref={ref}>
      {layers.map(({ g, size, opacity }, i) => (
        <points key={i} geometry={g} frustumCulled={false}>
          <pointsMaterial size={size} sizeAttenuation={false} vertexColors transparent opacity={opacity} depthWrite={false} />
        </points>
      ))}
    </group>
  );
}

/** Suns use `fixed` labels that keep their screen size, so systems stay readable from afar. */
function Label({ text, height, y, fixed }: { text: string; height: number; y: number; fixed?: boolean }) {
  const { tex, aspect } = labelTexture(text);
  const h = fixed ? 0.032 : height;
  return (
    <sprite position={[0, y + (fixed ? y * 0.6 : height / 2), 0]} scale={[h * aspect, h, 1]} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthWrite={false} depthTest={false} sizeAttenuation={!fixed} />
    </sprite>
  );
}

interface BodyProps {
  body: Body;
  showLabel: boolean;
  register(path: string, obj: Object3D | null): void;
  onSelect(path: string): void;
  onHover(path: string | null): void;
}

function BodyMesh({ body, showLabel, register, onSelect, onHover }: BodyProps) {
  const segments = body.kind === 'sun' ? 40 : body.kind === 'planet' ? 28 : 14;
  const hitRadius = Math.max(body.size * 1.5, body.size + 0.7);
  const labelHeight = body.kind === 'planet' ? 1.2 : 0.7;

  return (
    <group ref={(g) => register(body.path, g)}>
      <mesh>
        <sphereGeometry args={[body.size, segments, Math.ceil(segments / 2)]} />
        {body.kind === 'sun' ? (
          <meshBasicMaterial color={body.color} />
        ) : (
          <meshStandardMaterial color={body.color} emissive={body.color} emissiveIntensity={0.22} roughness={0.9} metalness={0} />
        )}
      </mesh>
      {/* Larger invisible sphere so small bodies are easy to tap. */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(body.path);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(body.path);
        }}
        onPointerOut={() => onHover(null)}
      >
        <sphereGeometry args={[hitRadius, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {body.kind === 'sun' && (
        <>
          <sprite scale={[body.size * 7, body.size * 7, 1]}>
            <spriteMaterial map={glowTexture} color={body.color} blending={AdditiveBlending} transparent depthWrite={false} />
          </sprite>
          <sprite scale={[body.size * 16, body.size * 16, 1]}>
            <spriteMaterial map={glowTexture} color={body.color} blending={AdditiveBlending} transparent opacity={0.25} depthWrite={false} />
          </sprite>
        </>
      )}
      {body.kind === 'planet' && body.moons >= 4 && (
        <mesh rotation={[-Math.PI / 2.4, 0.3, 0]}>
          <ringGeometry args={[body.size * 1.35, body.size * 1.9, 48]} />
          <meshBasicMaterial color={body.color} side={DoubleSide} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      )}
      {showLabel && <Label text={body.title} height={labelHeight} y={body.size + 0.25} fixed={body.kind === 'sun'} />}
    </group>
  );
}

// ---------- scene ----------

export function Scene({ layout, selected, hovered, focus, options, time, onSelect, onHover }: Props) {
  const objects = useRef(new Map<string, Object3D>());
  const rings = useRef(new Map<string, LineLoop>());
  const positions = useMemo(() => new Map(layout.bodies.map((b) => [b.path, new Vector3()])), [layout]);
  const marker = useRef<Group>(null);
  const hoverAnchor = useRef<Group>(null);
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const { camera, size } = useThree();

  // Keep the selected body in the part of the screen the note card doesn't cover.
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    if (!selected) cam.clearViewOffset();
    else {
      const narrow = size.width <= 820;
      const dx = narrow ? 0 : Math.min(392, size.width * 0.45) / 2;
      const dy = narrow ? size.height * 0.27 : 0;
      cam.setViewOffset(size.width, size.height, dx, dy, size.width, size.height);
    }
  }, [camera, selected, size]);

  const register = (path: string, obj: Object3D | null) => {
    if (obj) objects.current.set(path, obj);
    else objects.current.delete(path);
  };

  // ----- link beams -----
  const beamGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(layout.beams.length * 6), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(layout.beams.length * 6), 3));
    return g;
  }, [layout]);

  useEffect(() => {
    const colors = beamGeometry.getAttribute('color') as BufferAttribute;
    const c = new Color();
    layout.beams.forEach(([a, b], i) => {
      const lit = selected === a || selected === b;
      for (const [k, p] of [[0, a], [1, b]] as const) {
        c.set(layout.byPath.get(p)!.color).multiplyScalar(lit ? 1.4 : selected ? 0.18 : 0.45);
        colors.setXYZ(i * 2 + k, c.r, c.g, c.b);
      }
    });
    colors.needsUpdate = true;
  }, [beamGeometry, layout, selected]);

  // ----- camera flights -----
  const flight = useRef({ active: false, elapsed: 0, last: new Vector3(), following: false, dist: 30 });
  useEffect(() => {
    const f = flight.current;
    f.active = true;
    f.elapsed = 0;
    f.following = false;
    if (focus.path) {
      const body = layout.byPath.get(focus.path);
      f.dist = body ? (body.kind === 'sun' ? body.size * 9 : body.size * 9 + 6) : 30;
    } else if (focus.system != null) {
      f.dist = layout.systems[focus.system].extent * 1.6 + 10;
    } else f.dist = layout.radius * 1.05 + 15;
  }, [focus, layout]);

  useEffect(() => {
    const c = controls.current;
    const stop = () => (flight.current.active = false);
    c?.addEventListener('start', stop);
    return () => c?.removeEventListener('start', stop);
  }, []);

  const target = new Vector3();
  const dir = new Vector3();
  const delta = new Vector3();

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    if (!options.paused) time.current += dt * options.speed;
    const t = time.current;

    for (const body of layout.bodies) {
      const pos = positions.get(body.path)!;
      if (body.parent) {
        pos.copy(positions.get(body.parent)!);
        const a = body.phase + t * body.speed;
        pos.add(dir.set(Math.cos(a) * body.orbit, 0, Math.sin(a) * body.orbit).applyQuaternion(body.tilt));
      } else pos.copy(layout.systems[body.system].center);
      objects.current.get(body.path)?.position.copy(pos);
      const ring = rings.current.get(body.path);
      if (ring && body.parent) ring.position.copy(positions.get(body.parent)!);
    }

    if (options.beams && layout.beams.length) {
      const attr = beamGeometry.getAttribute('position') as BufferAttribute;
      layout.beams.forEach(([a, b], i) => {
        const pa = positions.get(a)!;
        const pb = positions.get(b)!;
        attr.setXYZ(i * 2, pa.x, pa.y, pa.z);
        attr.setXYZ(i * 2 + 1, pb.x, pb.y, pb.z);
      });
      attr.needsUpdate = true;
      beamGeometry.computeBoundingSphere();
    }

    if (marker.current) {
      const sel = selected ? positions.get(selected) : null;
      marker.current.visible = !!sel;
      if (sel) {
        marker.current.position.copy(sel);
        const s = layout.byPath.get(selected!)!.size * 3.2 * (1 + Math.sin(performance.now() / 300) * 0.04);
        marker.current.scale.setScalar(s);
      }
    }
    if (hoverAnchor.current && hovered) {
      const p = positions.get(hovered);
      if (p) hoverAnchor.current.position.copy(p);
    }

    // Follow the focused body as it orbits, and ease the camera towards it.
    const c = controls.current;
    if (!c) return;
    const f = flight.current;
    if (focus.path && positions.has(focus.path)) {
      const p = positions.get(focus.path)!;
      if (f.following) {
        delta.subVectors(p, f.last);
        camera.position.add(delta);
        c.target.add(delta);
      }
      f.last.copy(p);
      f.following = true;
      target.copy(p);
    } else if (focus.system != null) {
      target.copy(layout.systems[focus.system].center);
    } else target.set(0, 0, 0);

    if (f.active) {
      f.elapsed += dt;
      const k = 1 - Math.exp(-dt * 3.2);
      c.target.lerp(target, k);
      dir.subVectors(camera.position, c.target);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.4, 1);
      dir.normalize();
      if (focus.path == null) dir.lerp(new Vector3(0, 0.55, 0.85).normalize(), k).normalize();
      camera.position.lerp(delta.copy(target).addScaledVector(dir, f.dist), k);
      if (f.elapsed > 2.6) f.active = false;
    }
    c.update();
  });

  const hoveredBody = hovered ? layout.byPath.get(hovered) : null;

  return (
    <>
      <color attach="background" args={['#03040a']} />
      <ambientLight intensity={0.22} />
      {layout.systems.slice(0, 8).map((s) => (
        <pointLight key={s.id} position={s.center} intensity={1.15} decay={0} distance={s.extent * 2.5 + 20} />
      ))}
      <Starfield radius={layout.radius * 6 + 1500} />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1.5}
        maxDistance={layout.radius * 5 + 300}
        zoomSpeed={0.9}
      />

      {layout.bodies.map((b) => (
        <BodyMesh
          key={b.path}
          body={b}
          showLabel={options.labels ? b.kind !== 'moon' && b.kind !== 'asteroid' : b.kind === 'sun'}
          register={register}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}

      {options.orbits &&
        layout.bodies
          .filter((b) => b.kind === 'planet' || b.kind === 'moon')
          .map((b) => (
            <lineLoop
              key={b.path}
              ref={(l: LineLoop | null) => {
                if (l) rings.current.set(b.path, l);
                else rings.current.delete(b.path);
              }}
              geometry={circle}
              scale={b.orbit}
              quaternion={b.tilt}
              position={b.kind === 'planet' ? layout.systems[b.system].center : undefined}
            >
              <lineBasicMaterial
                color={b.kind === 'planet' ? '#8b84c9' : '#6c6890'}
                transparent
                opacity={selected === b.path ? 0.6 : b.kind === 'planet' ? 0.16 : 0.1}
                depthWrite={false}
              />
            </lineLoop>
          ))}

      {options.beams && layout.beams.length > 0 && (
        <lineSegments geometry={beamGeometry} frustumCulled={false}>
          <lineBasicMaterial vertexColors transparent opacity={0.75} blending={AdditiveBlending} depthWrite={false} />
        </lineSegments>
      )}

      <group ref={marker} visible={false}>
        <sprite>
          <spriteMaterial map={ringTexture} color="#b8acff" transparent depthWrite={false} depthTest={false} />
        </sprite>
      </group>

      <group ref={hoverAnchor}>
        {hoveredBody && hoveredBody.path !== selected && (
          <Html center style={{ pointerEvents: 'none' }} position={[0, hoveredBody.size + 1.2, 0]} zIndexRange={[20, 0]}>
            <div className="solar-tooltip">
              <strong>{hoveredBody.title}</strong>
              <span>{hoveredBody.kind}</span>
            </div>
          </Html>
        )}
      </group>
    </>
  );
}


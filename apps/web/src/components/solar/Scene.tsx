import { useEffect, useMemo, useRef, type ElementRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Group, LineLoop, Matrix3, Matrix4, Mesh,
  PerspectiveCamera, SRGBColorSpace, ShaderMaterial, Vector3, type Object3D,
} from 'three';
import { DISK_OUTER, type Body, type SolarLayout } from './layout';
import { BLACKHOLE_BOUND, blackHoleMaterial, planetMaterial, ringMaterial, starMaterial, surfaceIndex } from './shaders';
import { THEMES, type ResolvedDesign, type ThemeId } from './design';

export interface Focus {
  path: string | null;
  galaxy: number | null;
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
  designs: Map<string, ResolvedDesign>;
  theme: ThemeId;
  selected: string | null;
  hovered: string | null;
  focus: Focus;
  options: SceneOptions;
  /** Search matches: these glow, everything else dims. null when not searching. */
  highlight: Set<string> | null;
  /** Screen area covered by the note card, as fractions of width and height to shift the view by. */
  inset: { x: number; y: number };
  time: MutableRefObject<number>;
  onSelect(path: string | null): void;
  onHover(path: string | null): void;
}

export const KIND_NAMES: Record<Body['kind'], string> = {
  blackhole: 'black hole', star: 'star', planet: 'planet', moon: 'moon', asteroid: 'asteroid',
};

const WHITE = new Color(1, 1, 1);
/** Fingers are less precise than a mouse: make bodies easier to tap. */
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 1.6 : 1;

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

/** Black holes use `fixed` labels that keep their screen size, so galaxies stay readable from afar. */
function Label({ text, height, y, fixed }: { text: string; height: number; y: number; fixed?: boolean }) {
  const { tex, aspect } = labelTexture(text);
  const h = fixed ? 0.032 : height;
  return (
    <sprite position={[0, fixed ? y : y + height / 2, 0]} scale={[h * aspect, h, 1]} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthWrite={false} depthTest={false} sizeAttenuation={!fixed} />
    </sprite>
  );
}

/** Materials the frame loop updates every frame. */
interface Live {
  planets: Map<string, ShaderMaterial>;
  stars: Map<string, ShaderMaterial>;
  holes: Map<string, { mesh: Mesh; mat: ShaderMaterial }>;
}

function HitTarget({ radius, path, onSelect, onHover }: { radius: number; path: string; onSelect(p: string): void; onHover(p: string | null): void }) {
  return (
    <mesh
      onClick={(e) => {
        e.stopPropagation();
        onSelect(path);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(path);
      }}
      onPointerOut={() => onHover(null)}
    >
      <sphereGeometry args={[radius * TOUCH, 12, 8]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** Pulsing glow around a search match. */
function Halo({ size }: { size: number }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => ref.current?.scale.setScalar(size * (5 + Math.sin(clock.elapsedTime * 3) * 0.8)));
  return (
    <group ref={ref}>
      <sprite>
        <spriteMaterial map={glowTexture} color="#d9d2ff" blending={AdditiveBlending} transparent opacity={0.9} depthWrite={false} />
      </sprite>
    </group>
  );
}

interface BodyProps {
  body: Body;
  design: ResolvedDesign;
  theme: ThemeId;
  mode: 'normal' | 'match' | 'dim';
  showLabel: boolean;
  live: Live;
  register(path: string, obj: Object3D | null): void;
  onSelect(path: string): void;
  onHover(path: string | null): void;
}

function BodyMesh({ body, design, theme, mode, showLabel, live, register, onSelect, onHover }: BodyProps) {
  const size = body.size * design.size;
  const t = THEMES[theme];
  const material = useMemo(
    () => (body.kind === 'blackhole' ? blackHoleMaterial() : body.kind === 'star' ? starMaterial() : planetMaterial()),
    [body.kind],
  );
  const rings = useMemo(() => ringMaterial(), []);
  const hole = useRef<Mesh>(null);

  useEffect(() => {
    const u = material.uniforms;
    if (body.kind === 'blackhole') {
      u.uDiskColor.value.set(design.disk);
      u.uBrightness.value = design.brightness * (theme === 'neon' ? 1.3 : 1);
      u.uSpin.value = design.spin;
      u.uUnit.value = size;
      u.uInvTilt.value = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(body.tilt.clone().invert()));
    } else if (body.kind === 'star') {
      u.uColor.value.set(design.color);
      u.uSeed.value = body.seed;
    } else {
      u.uColor.value.set(design.color);
      u.uSurface.value = surfaceIndex(body.kind === 'asteroid' ? 'rocky' : design.surface);
      u.uSeed.value = body.seed;
      u.uRim.value = t.rim;
      u.uSaturation.value = t.saturation;
    }
    rings.uniforms.uColor.value.set(design.color);
    rings.uniforms.uInner.value = size * 1.35;
    rings.uniforms.uOuter.value = size * 2.25;
    rings.uniforms.uSeed.value = body.seed;
  }, [material, rings, design, body, size, t, theme]);

  useEffect(() => {
    material.uniforms.uDim.value = mode === 'dim' ? 1 : 0;
  }, [material, mode]);
  const glowFade = mode === 'dim' ? 0.15 : 1;

  useEffect(() => {
    if (body.kind === 'blackhole') live.holes.set(body.path, { mesh: hole.current!, mat: material });
    else if (body.kind === 'star') live.stars.set(body.path, material);
    else live.planets.set(body.path, material);
    return () => {
      live.holes.delete(body.path);
      live.stars.delete(body.path);
      live.planets.delete(body.path);
    };
  }, [body, material, live]);

  useEffect(
    () => () => {
      material.dispose();
      rings.dispose();
    },
    [material, rings],
  );

  if (body.kind === 'blackhole') {
    return (
      <group ref={(g) => register(body.path, g)}>
        {/* Billboard quad; the frame loop turns it to the camera and sizes it to cover the lensing. */}
        <mesh ref={hole} material={material} renderOrder={5} frustumCulled={false}>
          <planeGeometry args={[2, 2]} />
        </mesh>
        <HitTarget radius={size * 4} path={body.path} onSelect={onSelect} onHover={onHover} />
        {mode === 'match' && <Halo size={size * 2} />}
        {showLabel && <Label text={body.title} height={0} y={size * DISK_OUTER * 0.8} fixed />}
      </group>
    );
  }

  const segments = body.kind === 'star' ? 48 : body.kind === 'planet' ? 40 : 20;
  return (
    <group ref={(g) => register(body.path, g)}>
      <mesh material={material}>
        <sphereGeometry args={[size, segments, Math.ceil(segments / 2)]} />
      </mesh>
      <HitTarget radius={Math.max(size * 1.5, size + 0.7)} path={body.path} onSelect={onSelect} onHover={onHover} />
      {body.kind === 'star' && design.glow > 0 && (
        <>
          <sprite scale={[size * 6 * design.glow, size * 6 * design.glow, 1]}>
            <spriteMaterial map={glowTexture} color={design.color} blending={AdditiveBlending} transparent opacity={glowFade} depthWrite={false} />
          </sprite>
          <sprite scale={[size * 14 * design.glow, size * 14 * design.glow, 1]}>
            <spriteMaterial map={glowTexture} color={design.color} blending={AdditiveBlending} transparent opacity={0.22 * glowFade} depthWrite={false} />
          </sprite>
        </>
      )}
      {body.kind === 'planet' && design.rings && (
        <mesh rotation={[-Math.PI / 2.3, 0.25, 0]} material={rings}>
          <ringGeometry args={[size * 1.35, size * 2.25, 96]} />
        </mesh>
      )}
      {mode === 'match' && <Halo size={size} />}
      {showLabel && <Label text={body.title} height={body.kind === 'star' ? 1.5 : body.kind === 'planet' ? 0.9 : 0.6} y={size + 0.3} />}
    </group>
  );
}

// ---------- scene ----------

export function Scene({ layout, designs, theme, selected, hovered, focus, options, highlight, inset, time, onSelect, onHover }: Props) {
  const objects = useRef(new Map<string, Object3D>());
  const rings = useRef(new Map<string, LineLoop>());
  const live = useMemo<Live>(() => ({ planets: new Map(), stars: new Map(), holes: new Map() }), []);
  const positions = useMemo(() => new Map(layout.bodies.map((b) => [b.path, new Vector3()])), [layout]);
  const marker = useRef<Group>(null);
  const hoverAnchor = useRef<Group>(null);
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const { camera, size } = useThree();
  const beamLevel = THEMES[theme].beam;

  // Keep the selected body in the part of the screen the note card doesn't cover.
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    if (!inset.x && !inset.y) cam.clearViewOffset();
    else cam.setViewOffset(size.width, size.height, size.width * inset.x, size.height * inset.y, size.width, size.height);
  }, [camera, inset.x, inset.y, size]);

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
      const lit = selected === a || selected === b || (!!highlight && highlight.has(a) && highlight.has(b));
      const dim = !lit && (!!selected || !!highlight);
      for (const [k, p] of [[0, a], [1, b]] as const) {
        c.set(designs.get(p)?.color ?? '#ffffff').multiplyScalar(lit ? 1.4 : dim ? beamLevel * 0.25 : beamLevel);
        colors.setXYZ(i * 2 + k, c.r, c.g, c.b);
      }
    });
    colors.needsUpdate = true;
  }, [beamGeometry, layout, selected, designs, beamLevel, highlight]);

  // ----- camera flights -----
  const flight = useRef({ active: false, elapsed: 0, last: new Vector3(), following: false, dist: 30 });
  useEffect(() => {
    const f = flight.current;
    f.active = true;
    f.elapsed = 0;
    f.following = false;
    const body = focus.path ? layout.byPath.get(focus.path) : null;
    if (body) {
      const s = body.size * (designs.get(body.path)?.size ?? 1);
      f.dist = body.kind === 'blackhole' ? s * DISK_OUTER * 2.6 : body.kind === 'star' ? s * 9 + 8 : body.kind === 'planet' ? s * 9 + 5 : s * 12 + 3;
    } else if (focus.galaxy != null) {
      f.dist = layout.galaxies[focus.galaxy].extent * 1.5 + 10;
    } else f.dist = layout.radius * 1.05 + 15;
    // Portrait phones see much less sideways; back off so the body still fits.
    const aspect = size.width / size.height;
    if (aspect < 1) f.dist *= Math.min(2.2, 0.8 / aspect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, layout]);

  useEffect(() => {
    const c = controls.current;
    const stop = () => (flight.current.active = false);
    c?.addEventListener('start', stop);
    return () => c?.removeEventListener('start', stop);
  }, []);

  const scratch = useMemo(
    () => ({ target: new Vector3(), dir: new Vector3(), delta: new Vector3(), up: new Vector3(0, 0.55, 0.85).normalize() }),
    [],
  );

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    if (!options.paused) time.current += dt * options.speed;
    const t = time.current;
    const clock = state.clock.elapsedTime;
    const { target, dir, delta } = scratch;

    for (const body of layout.bodies) {
      const pos = positions.get(body.path)!;
      if (body.parent) {
        pos.copy(positions.get(body.parent)!);
        const a = body.phase + t * body.speed;
        pos.add(dir.set(Math.cos(a) * body.orbit, 0, Math.sin(a) * body.orbit).applyQuaternion(body.tilt));
      } else pos.copy(layout.galaxies[body.galaxy].center);
      objects.current.get(body.path)?.position.copy(pos);
      const ring = rings.current.get(body.path);
      if (ring && body.parent) ring.position.copy(positions.get(body.parent)!);
    }

    for (const [path, mat] of live.planets) {
      const body = layout.byPath.get(path);
      if (!body?.light) continue;
      mat.uniforms.uLightPos.value.copy(positions.get(body.light)!);
      const source = layout.byPath.get(body.light)!;
      const d = designs.get(body.light);
      mat.uniforms.uLightColor.value.set((source.kind === 'blackhole' ? d?.disk : d?.color) ?? '#ffffff').lerp(WHITE, 0.55);
      mat.uniforms.uTime.value = clock;
    }
    for (const mat of live.stars.values()) mat.uniforms.uTime.value = clock;
    for (const [path, { mesh, mat }] of live.holes) {
      const center = positions.get(path)!;
      const R = BLACKHOLE_BOUND * (mat.uniforms.uUnit.value as number);
      const d = camera.position.distanceTo(center);
      const half = d > R * 1.05 ? (R * d) / Math.sqrt(d * d - R * R) : R * 40;
      mesh.quaternion.copy(camera.quaternion);
      mesh.scale.setScalar(half * 1.15);
      mat.uniforms.uCenter.value.copy(center);
      mat.uniforms.uTime.value = clock;
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
      // Black holes already have a photon ring; a marker on top just muddies it.
      marker.current.visible = !!sel && layout.byPath.get(selected!)!.kind !== 'blackhole';
      if (sel) {
        const body = layout.byPath.get(selected!)!;
        const s = body.size * (designs.get(selected!)?.size ?? 1) * (body.kind === 'blackhole' ? 7 : 3.2);
        marker.current.position.copy(sel);
        marker.current.scale.setScalar(s * (1 + Math.sin(performance.now() / 300) * 0.04));
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
    } else if (focus.galaxy != null) {
      target.copy(layout.galaxies[focus.galaxy].center);
    } else target.set(0, 0, 0);

    if (f.active) {
      f.elapsed += dt;
      const k = 1 - Math.exp(-dt * 3.2);
      c.target.lerp(target, k);
      dir.subVectors(camera.position, c.target);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.4, 1);
      dir.normalize();
      if (focus.path == null) dir.lerp(scratch.up, k).normalize();
      camera.position.lerp(delta.copy(target).addScaledVector(dir, f.dist), k);
      if (f.elapsed > 2.6) f.active = false;
    }
    c.update();
  });

  const hoveredBody = hovered ? layout.byPath.get(hovered) : null;

  return (
    <>
      <color attach="background" args={['#03040a']} />
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
          design={designs.get(b.path)!}
          theme={theme}
          mode={!highlight ? 'normal' : highlight.has(b.path) ? 'match' : 'dim'}
          showLabel={
            highlight
              ? highlight.has(b.path)
              : b.kind === 'blackhole' || (options.labels && (b.kind === 'star' || b.kind === 'planet'))
          }
          live={live}
          register={register}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}

      {options.orbits &&
        layout.bodies
          .filter((b) => b.kind === 'star' || b.kind === 'planet' || b.kind === 'moon')
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
            >
              <lineBasicMaterial
                color={b.kind === 'star' ? '#a39bd8' : b.kind === 'planet' ? '#8b84c9' : '#6c6890'}
                transparent
                opacity={(selected === b.path ? 0.6 : b.kind === 'star' ? 0.14 : b.kind === 'planet' ? 0.12 : 0.08) * (highlight ? 0.35 : 1)}
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
              <span>{KIND_NAMES[hoveredBody.kind]}</span>
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

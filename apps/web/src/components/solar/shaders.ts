import { Color, DoubleSide, Matrix3, NormalBlending, ShaderMaterial, Vector3 } from 'three';
import { DISK_INNER, DISK_OUTER } from './layout';

// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT) and fractal sum.
const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * snoise(p); p *= 2.03; a *= 0.5; }
  return v * 0.5 + 0.5;
}
`;

const SPHERE_VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vObj;
void main() {
  vObj = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const SURFACES = ['rocky', 'desert', 'ocean', 'ice', 'lava', 'gas', 'toxic'] as const;
export type Surface = (typeof SURFACES)[number];

const PLANET_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform int uSurface;
uniform float uSeed;
uniform float uTime;
uniform vec3 uLightPos;
uniform vec3 uLightColor;
uniform float uRim;
uniform float uSaturation;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vObj;
${NOISE}
void main() {
  vec3 n = normalize(vObj);
  vec3 p = n * 1.6 + uSeed * 37.0;
  vec3 col;
  vec3 glow = vec3(0.0);
  if (uSurface == 0) {          // rocky, cratered
    float f = fbm(p * 1.4);
    col = mix(uColor * 0.45, uColor * 1.05, f);
    float crater = smoothstep(0.62, 0.7, snoise(p * 3.5) * 0.5 + 0.5);
    col *= 1.0 - crater * 0.35;
  } else if (uSurface == 1) {   // desert dunes
    float f = fbm(p * vec3(1.0, 3.5, 1.0));
    col = mix(uColor * 0.75, uColor * 1.15 + vec3(0.08, 0.04, 0.0), f);
  } else if (uSurface == 2) {   // ocean world with continents and clouds
    float land = smoothstep(0.5, 0.54, fbm(p * 1.1));
    vec3 sea = mix(uColor * 0.35, uColor * 0.7, fbm(p * 3.0));
    vec3 ground = mix(vec3(0.22, 0.38, 0.16), vec3(0.55, 0.45, 0.3), fbm(p * 2.5));
    col = mix(sea, ground, land);
    float ice = smoothstep(0.78, 0.86, abs(n.y));
    col = mix(col, vec3(0.92), ice);
    float clouds = smoothstep(0.55, 0.78, fbm(p * 2.2 + vec3(uTime * 0.015, 0.0, 0.0)));
    col = mix(col, vec3(1.0), clouds * 0.75);
  } else if (uSurface == 3) {   // ice
    float f = fbm(p * 2.0);
    col = mix(vec3(0.82, 0.9, 1.0), uColor * 0.55 + vec3(0.35), f * 0.7);
    float crack = 1.0 - smoothstep(0.0, 0.04, abs(snoise(p * 2.6)));
    col = mix(col, uColor * 0.4, crack * 0.6);
  } else if (uSurface == 4) {   // lava
    float crust = fbm(p * 1.8);
    col = mix(vec3(0.05, 0.03, 0.03), uColor * 0.25, crust);
    float vein = 1.0 - smoothstep(0.0, 0.07, abs(snoise(p * 2.4 + uTime * 0.02)));
    glow = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.85, 0.3), vein) * vein * 1.8;
  } else if (uSurface == 5) {   // gas giant bands with a storm
    float warp = fbm(p * vec3(0.7, 2.5, 0.7) + vec3(uTime * 0.01, 0.0, 0.0));
    float bands = sin(n.y * 16.0 + warp * 5.0) * 0.5 + 0.5;
    col = mix(uColor * 0.65, uColor * 1.15 + vec3(0.12), bands);
    vec3 spot = normalize(vec3(cos(uSeed * 40.0), -0.35, sin(uSeed * 40.0)));
    float storm = smoothstep(0.92, 0.97, dot(n, spot));
    col = mix(col, uColor * 0.5 + vec3(0.35, 0.12, 0.05), storm);
  } else {                      // toxic swirl
    float f = fbm(p * 1.5 + vec3(0.0, uTime * 0.02, 0.0));
    float g = fbm(p * 3.0 - f * 2.0);
    col = mix(uColor * 0.4, vec3(0.6, 1.0, 0.3) * 0.6 + uColor * 0.4, g);
  }
  float gray = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(gray), col, uSaturation);

  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uLightPos - vPosW);
  vec3 V = normalize(cameraPosition - vPosW);
  float diff = max(dot(N, L), 0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 lit = col * (0.07 + uLightColor * diff * 1.15) + glow;
  lit += rim * uRim * mix(uColor, vec3(0.6, 0.8, 1.0), 0.4) * (0.25 + diff);
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uSeed;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vObj;
${NOISE}
void main() {
  vec3 n = normalize(vObj);
  float cells = fbm(n * 4.0 + uSeed * 20.0 + vec3(0.0, uTime * 0.04, 0.0));
  float spots = smoothstep(0.7, 0.8, fbm(n * 2.0 + uSeed * 9.0 - uTime * 0.01));
  vec3 V = normalize(cameraPosition - vPosW);
  float mu = max(dot(normalize(vNormalW), V), 0.0);
  vec3 col = uColor * (0.55 + cells * 0.75) * (1.0 - spots * 0.45);
  col = mix(col, uColor * 1.3 + 0.1, pow(mu, 4.0) * 0.3);
  col *= 0.45 + 0.55 * pow(mu, 0.5);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BILLBOARD_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * Ray-marched Schwarzschild black hole. Each pixel's ray is bent toward the hole
 * (photon geodesic in Cartesian form: a = -1.5 h² r / |r|⁵) and picks up light where
 * it crosses the thin accretion disk, so the far side of the disk shows above and
 * below the shadow. Units: event horizon radius = 1.
 */
const BLACKHOLE_FRAGMENT = /* glsl */ `
uniform vec3 uCenter;
uniform float uUnit;
uniform mat3 uInvTilt;
uniform float uTime;
uniform vec3 uDiskColor;
uniform float uBrightness;
uniform float uSpin;
uniform float uBound;
varying vec3 vWorld;
${NOISE}
const float INNER = ${DISK_INNER.toFixed(2)};
const float OUTER = ${DISK_OUTER.toFixed(2)};
void main() {
  vec3 ro = uInvTilt * ((cameraPosition - uCenter) / uUnit);
  vec3 rd = normalize(uInvTilt * (vWorld - cameraPosition));
  float b = dot(ro, rd);
  float c = dot(ro, ro) - uBound * uBound;
  float disc = b * b - c;
  if (disc < 0.0) discard;
  vec3 pos = ro + rd * max(-b - sqrt(disc), 0.0);
  vec3 vel = rd;
  vec3 h = cross(pos, vel);
  float h2 = dot(h, h);

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float ring = 0.0;
  for (int i = 0; i < 110; i++) {
    float r2 = dot(pos, pos);
    if (r2 < 1.0) { alpha = 1.0; break; }
    float r = sqrt(r2);
    float dt = clamp(0.07 * r, 0.025, 0.5);
    vec3 prev = pos;
    vel += -1.5 * h2 * pos / (r2 * r2 * r) * dt;
    pos += vel * dt;
    float near = (r - 1.5) * 5.0;
    ring += dt * 0.35 * exp(-near * near);
    if (prev.y * pos.y < 0.0) {
      vec3 q = mix(prev, pos, prev.y / (prev.y - pos.y));
      float rr = length(q.xz);
      if (rr > INNER && rr < OUTER) {
        float x = (rr - INNER) / (OUTER - INNER);
        float ang = atan(q.z, q.x) + uTime * uSpin * 3.0 / (rr * sqrt(rr));
        float swirl = fbm(vec3(cos(ang) * rr, sin(ang) * rr, rr * 0.6) * 0.9);
        float streaks = 0.6 + 0.4 * sin(rr * 9.0 + swirl * 6.0);
        float dens = smoothstep(0.0, 0.06, x) * pow(1.0 - x, 1.6) * (0.45 + 0.75 * swirl) * streaks;
        vec3 heat = mix(vec3(1.0, 0.96, 0.88) * 2.6, uDiskColor * 1.4, smoothstep(0.0, 0.55, x));
        vec3 orbit = normalize(vec3(-q.z, 0.0, q.x)) * sign(uSpin + 1e-4);
        float doppler = clamp(1.0 + 0.75 * dot(orbit, -normalize(vel)), 0.25, 2.2);
        float a = clamp(dens * 1.6, 0.0, 1.0);
        col += heat * doppler * uBrightness * a * (1.0 - alpha);
        alpha += a * (1.0 - alpha);
        if (alpha > 0.985) break;
      }
    }
    if (r2 > uBound * uBound * 1.02 && dot(pos, vel) > 0.0) break;
  }
  ring = clamp(ring, 0.0, 1.5) * (1.0 - alpha);
  col += mix(uDiskColor, vec3(1.0), 0.5) * ring * uBrightness * 0.9;
  alpha = clamp(alpha + ring * 0.6, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SURFACE_INDEX: Record<Surface, number> = { rocky: 0, desert: 1, ocean: 2, ice: 3, lava: 4, gas: 5, toxic: 6 };

export function planetMaterial() {
  return new ShaderMaterial({
    vertexShader: SPHERE_VERTEX,
    fragmentShader: PLANET_FRAGMENT,
    uniforms: {
      uColor: { value: new Color() },
      uSurface: { value: 0 },
      uSeed: { value: 0 },
      uTime: { value: 0 },
      uLightPos: { value: new Vector3() },
      uLightColor: { value: new Color(1, 1, 1) },
      uRim: { value: 0.6 },
      uSaturation: { value: 1 },
    },
  });
}

export const surfaceIndex = (s: Surface) => SURFACE_INDEX[s];

export function starMaterial() {
  return new ShaderMaterial({
    vertexShader: SPHERE_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    uniforms: { uColor: { value: new Color() }, uSeed: { value: 0 }, uTime: { value: 0 } },
  });
}

/** Bounding sphere of the lensing effect, in horizon radii. */
export const BLACKHOLE_BOUND = DISK_OUTER * 1.25;

export function blackHoleMaterial() {
  return new ShaderMaterial({
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: BLACKHOLE_FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    blending: NormalBlending,
    depthWrite: false,
    uniforms: {
      uCenter: { value: new Vector3() },
      uUnit: { value: 1 },
      uInvTilt: { value: new Matrix3() },
      uTime: { value: 0 },
      uDiskColor: { value: new Color('#ff8a3d') },
      uBrightness: { value: 1 },
      uSpin: { value: 1 },
      uBound: { value: BLACKHOLE_BOUND },
    },
  });
}


const RING_VERTEX = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uInner;
uniform float uOuter;
uniform float uSeed;
varying vec2 vLocal;
void main() {
  float x = (length(vLocal) - uInner) / (uOuter - uInner);
  float bands = 0.5 + 0.5 * sin(x * 46.0 + sin(x * 11.0 + uSeed * 20.0) * 3.0);
  float gap = smoothstep(0.02, 0.05, abs(x - 0.62));
  float a = smoothstep(0.0, 0.06, x) * smoothstep(1.0, 0.9, x) * (0.25 + 0.55 * bands) * gap;
  gl_FragColor = vec4(uColor * (0.55 + 0.6 * bands), a);
  #include <colorspace_fragment>
}
`;

/** Planetary rings; geometry is a RingGeometry from inner to outer radius. */
export function ringMaterial() {
  return new ShaderMaterial({
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uColor: { value: new Color() }, uInner: { value: 1 }, uOuter: { value: 2 }, uSeed: { value: 0 } },
  });
}

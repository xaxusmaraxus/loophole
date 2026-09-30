import { Color, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import { type Board, idx } from '../puzzle/board';
import { PAL, THEMES } from '../render/palette';
import type { ParkId } from '../run/run';
import { Geo, rng, shade, v3 } from './geo';
import { type Flora, M, type Parts, arc, bench, flowerBed, hedge, lamp, pondRim, rock, stand, tree } from './models';
import { BLOOM_LAYER, GLOW_LAYER } from './post';
import { MATS } from './toon';

// The day's island: a slab of layered rock with a paved plaza, the grassy
// board, a verge of hedges and trees, lamps with bunting, and a toon sea.

export interface Look3D {
  cliff: string[];
  lip: string;
  sea: [string, string, string];
  horizon: string;
  support: string;
  tie: string;
  flora: Flora;
  flowers: string[];
}

export const LOOKS: Record<ParkId, Look3D> = {
  meadow: {
    cliff: ['#c99a6b', '#a47a55', '#b58a5e', '#8b6a4f', '#74563f'],
    lip: '#6fb84a',
    sea: ['#6fe0e0', '#2fa6cf', '#1a5c9e'],
    horizon: '#2a5a9a',
    support: '#3aa6a0',
    tie: '#3a3550',
    flora: 'meadow',
    flowers: ['#ff8fb8', '#ffd23f', '#fbf6ec', '#ff9a3c'],
  },
  boardwalk: {
    cliff: ['#f1d696', '#dcbb74', '#e9c987', '#c9a466', '#b08e52'],
    lip: '#aed178',
    sea: ['#8ff5e6', '#35c2d0', '#1f7fb8'],
    horizon: '#2a74b0',
    support: '#f3ead5',
    tie: '#8a5a36',
    flora: 'boardwalk',
    flowers: ['#ff5d8a', '#ffd23f', '#fbf6ec'],
  },
  hollow: {
    cliff: ['#7d7494', '#6a6182', '#5c5475', '#4d4666', '#3f3957'],
    lip: '#7a9676',
    sea: ['#5c6f9e', '#3e4a7e', '#262b58'],
    horizon: '#1e2148',
    support: '#6b6480',
    tie: '#2b2140',
    flora: 'hollow',
    flowers: ['#b98cff', '#8cf0c8', '#e4e4ec'],
  },
  finale: {
    cliff: ['#e8b89a', '#c99a7b', '#d9a98a', '#b08066', '#94684f'],
    lip: '#7cc453',
    sea: ['#7ae8f0', '#38b0dc', '#1c5fa8'],
    horizon: '#2b5aa0',
    support: '#e8484f',
    tie: '#3a3550',
    flora: 'finale',
    flowers: ['#ff8fb8', '#ffd23f', '#9d6ef0', '#45a8e0'],
  },
};

const WATER_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uHorizon;
uniform vec2 uC;
uniform vec2 uHalf;
uniform float uR;
uniform float uMode;
uniform float uDusk;
uniform float uGold;
varying vec3 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = vW.xz;
  float d = uMode < 0.5 ? sdBox(p - uC, uHalf, uR) : length(p - uC) - uR;
  if (uMode > 0.5) d = -d;
  float w = noise(p * 1.3 + uTime * 0.15) * 0.35 + noise(p * 3.1 - uTime * 0.2) * 0.15;
  float dd = d + w * 0.6;
  float scale = uMode < 0.5 ? 1.0 : 0.12;
  vec3 c = uShallow;
  c = mix(c, uMid, smoothstep(0.2 * scale, 1.0 * scale, dd));
  c = mix(c, uDeep, smoothstep(1.2 * scale, 3.2 * scale, dd));
  // Foam rings drifting out from the shore, and a hard foam line on it.
  float ring = fract(d * (uMode < 0.5 ? 1.4 : 9.0) - uTime * 0.3);
  float rings = step(0.9, ring) * (1.0 - smoothstep(0.2 * scale, 1.6 * scale, d)) * step(0.25, noise(p * 2.0 + uTime * 0.1));
  float shore = 1.0 - step((0.07 + 0.05 * noise(p * 6.0 + uTime * 0.4)) * (uMode < 0.5 ? 1.0 : 0.4), d);
  c = mix(c, uFoam, max(rings * 0.8, shore));
  // Glints.
  vec2 g = floor(p * 5.0);
  float gl = step(0.985, hash(g + floor(uTime * 1.5))) * step(0.5, noise(p * 8.0 + uTime));
  c = mix(c, uFoam, gl * 0.9);
  c = mix(c, uHorizon, smoothstep(5.0, 18.0, d) * (uMode < 0.5 ? 1.0 : 0.0));
  // Sunset: warm streaks on the water; dusk: deep blue with lamp glints.
  float streak = step(0.66, noise(vec2(p.x * 0.5, p.y * 3.2) + vec2(uTime * 0.05, 0.0))) * (1.0 - step(2.2 * scale, dd) * 0.5);
  c *= mix(vec3(1.0), vec3(1.08, 0.9, 0.86), uGold);
  c = mix(c, vec3(1.0, 0.72, 0.45), streak * 0.5 * uGold);
  c *= mix(vec3(1.0), vec3(0.42, 0.45, 0.85), uDusk);
  c += uFoam * gl * uDusk * 0.8;
  gl_FragColor = vec4(c, 1.0);
}`;

export function waterMaterial(look: Look3D, mode: 0 | 1): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new Color(look.sea[0]) },
      uMid: { value: new Color(look.sea[1]) },
      uDeep: { value: new Color(look.sea[2]) },
      uFoam: { value: new Color('#f4fbff') },
      uHorizon: { value: new Color(look.horizon) },
      uC: { value: new Vector2() },
      uHalf: { value: new Vector2(1, 1) },
      uR: { value: 0.3 },
      uMode: { value: mode },
      uDusk: { value: 0 },
      uGold: { value: 0 },
    },
  });
}

export interface Island {
  group: Group;
  lamps: Vector3[];
  waters: ShaderMaterial[];
  /** Extent of the island top, for framing. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  ferris: Group | null;
  swing: Group | null;
  boat: Group;
  clouds: Group[];
  look: Look3D;
}

export const WATER_Y = -0.62;
/** Plaza margins around the board (the front one holds the station and the queue). */
export const PLAZA_SIDE = 0.6;
export const PLAZA_FRONT = 2.4;
const CLIFF_BOTTOM = -0.9;
export const GRASS_Y = 0.03;

export function buildIsland(b: Board, park: ParkId, seed: number): Island {
  const n = b.size;
  const look = LOOKS[park];
  const th = THEMES[park];
  const r = rng(seed);
  const parts: Parts = { matte: new Geo(), gloss: new Geo(), leaf: new Geo(), cloth: new Geo(), glow: new Geo(), detail: new Geo() };
  const det = parts.detail!;
  const m = parts.matte!;
  const group = new Group();
  // Plaza (margins) and verge extents.
  const px0 = -PLAZA_SIDE;
  const px1 = n + PLAZA_SIDE;
  const pz0 = -PLAZA_SIDE;
  const pz1 = n + PLAZA_FRONT;
  const V = 0.4;
  const x0 = px0 - V;
  const x1 = px1 + V;
  const z0 = pz0 - V;
  const z1 = pz1 + 0.12;

  // ---- Plaza surface: flat pavers or planks, colored, no steps (so no ink grid) ----
  const flat = (ax: number, az: number, bx: number, bz: number, y: number, c: string) =>
    m.quad(v3(ax, y, az), v3(bx, y, az), v3(bx, y, bz), v3(ax, y, bz), c, v3((ax + bx) / 2, y - 1, (az + bz) / 2));
  m.cube((px0 + px1) / 2, -0.03, (pz0 + pz1) / 2, px1 - px0, 0.06, pz1 - pz0, th.plaza[2]);
  if (th.plazaStyle === 'planks') {
    for (let z = pz0; z < pz1 - 1e-6; z += 0.2) {
      let x = px0 - r() * 0.8;
      while (x < px1) {
        const len = 0.6 + r() * 0.8;
        const a = Math.max(px0, x);
        const e = Math.min(px1, x + len);
        if (e - a > 0.05) {
          const v = r();
          flat(a + 0.008, z + 0.008, e - 0.008, Math.min(pz1, z + 0.2) - 0.008, 0.001, v < 0.25 ? th.plaza[0] : v < 0.5 ? th.plaza[2] : th.plaza[1]);
          det.cube(a + 0.05, 0.003, z + 0.1, 0.012, 0.004, 0.012, th.plaza[3]);
        }
        x += len;
      }
    }
  } else {
    const s = 1 / 3;
    for (let z = pz0; z < pz1 - 1e-6; z += s) {
      const off = Math.round((z - pz0) / s) % 2 ? s / 2 : 0;
      for (let x = px0 - off; x < px1 - 1e-6; x += s) {
        const a = Math.max(px0, x);
        const e = Math.min(px1, x + s);
        if (a >= -1e-6 && e <= n + 1e-6 && z >= -1e-6 && z < n - 1e-6) continue;
        const v = r();
        flat(a + 0.012, z + 0.012, e - 0.012, Math.min(pz1, z + s) - 0.012, 0.001, v < 0.14 ? th.plaza[0] : v < 0.3 ? th.plaza[2] : th.plaza[1]);
      }
    }
  }
  // ---- The grass board, raised a touch inside a stone kerb ----
  m.cube(n / 2, GRASS_Y / 2 - 0.01, n / 2, n + 0.06, GRASS_Y + 0.02, n + 0.06, PAL.dirt[1]);
  const kerb = park === 'hollow' ? '#8a84a0' : park === 'boardwalk' ? '#e8d9b0' : '#e2dccb';
  const kw = 0.07;
  const kh = GRASS_Y + 0.03;
  m.cube(n / 2, kh / 2, -kw / 2, n + kw * 2, kh, kw, kerb, 0.012);
  m.cube(-kw / 2, kh / 2, n / 2, kw, kh, n, kerb, 0.012);
  m.cube(n + kw / 2, kh / 2, n / 2, kw, kh, n, kerb, 0.012);
  // The front kerb leaves a gap where the track runs down to the station.
  const gap0 = b.station.x;
  const gap1 = b.station.x + 2;
  if (gap0 > 0) m.cube(gap0 / 2 - kw / 2, kh / 2, n + kw / 2, gap0 + kw, kh, kw, kerb, 0.012);
  if (gap1 < n) m.cube((gap1 + n) / 2 + kw / 2, kh / 2, n + kw / 2, n - gap1 + kw, kh, kw, kerb, 0.012);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = idx(b, x, y);
      const base = (x + y) % 2 ? th.grass[1] : th.grass[2];
      if (b.soft[i]) {
        m.cube(x + 0.5, GRASS_Y - 0.004, y + 0.5, 0.98, 0.012, 0.98, base);
        softPatch(m, x + 0.5, y + 0.5, th.soft, seed + i * 31);
        continue;
      }
      m.cube(x + 0.5, GRASS_Y - 0.004, y + 0.5, 1, 0.012, 1, base);
      // Tufts and flowers.
      if (b.obstacles[i] === 'pond') continue;
      const rr = rng(seed * 13 + i);
      for (let k = 0; k < 5; k++) {
        const tx = x + 0.1 + rr() * 0.8;
        const tz = y + 0.1 + rr() * 0.8;
        const c = rr() < 0.6 ? th.grass[0] : th.grass[3];
        for (let b2 = -1; b2 <= 1; b2++) {
          const h = 0.04 + rr() * 0.03 - Math.abs(b2) * 0.012;
          det.tri(v3(tx + b2 * 0.018 - 0.012, GRASS_Y, tz), v3(tx + b2 * 0.018 + 0.012, GRASS_Y, tz), v3(tx + b2 * 0.03, GRASS_Y + h, tz + 0.012), c, v3(tx, GRASS_Y, tz - 1));
        }
      }
      if (rr() < 0.45) {
        const fx = x + 0.15 + rr() * 0.7;
        const fz = y + 0.15 + rr() * 0.7;
        det.sphere(v3(fx, GRASS_Y + 0.02, fz), 0.02, look.flowers[Math.floor(rr() * look.flowers.length)], 1, 0.7, 1, 6, 4);
      }
    }
  // ---- Obstacles ----
  const waters: ShaderMaterial[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const ob = b.obstacles[idx(b, x, y)];
      const cx = x + 0.5;
      const cz = y + 0.5;
      const s = seed + x * 7 + y * 13;
      if (ob === 'tree') tree(parts, cx, cz, s, look.flora, 1.05);
      else if (ob === 'rock') rock(parts, cx, cz, s, park === 'hollow');
      else if (ob === 'stand') stand(parts, cx, cz);
      else if (ob === 'pond') {
        pondRim(parts, cx, cz, s);
        const wm = waterMaterial(look, 1);
        wm.uniforms.uC.value.set(cx, cz);
        wm.uniforms.uR.value = 0.36;
        const disc = new Mesh(new PlaneGeometry(0.84, 0.76), wm);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(cx, GRASS_Y + 0.006, cz);
        group.add(disc);
        waters.push(wm);
      }
    }
  // ---- Verge: hedges, flowers and trees around the plaza ----
  const flora = look.flora;
  const verge = (vx0: number, vx1: number, vz0: number, vz1: number) => m.cube((vx0 + vx1) / 2, 0.01, (vz0 + vz1) / 2, vx1 - vx0, 0.04, vz1 - vz0, look.lip);
  verge(x0, px0, z0, z1);
  verge(px1, x1, z0, z1);
  verge(px0, px1, z0, pz0);
  // Kerb along the plaza's edge with the verge.
  m.cube(px0 - 0.03, 0.03, (z0 + pz1) / 2 + 0.2, 0.06, 0.06, pz1 - z0 - 0.2, '#d9dbe6');
  m.cube(px1 + 0.03, 0.03, (z0 + pz1) / 2 + 0.2, 0.06, 0.06, pz1 - z0 - 0.2, '#d9dbe6');
  m.cube((px0 + px1) / 2, 0.03, pz0 - 0.03, px1 - px0 + 0.12, 0.06, 0.06, '#d9dbe6');
  // Trees along the back, hedges and beds down the sides.
  for (let k = 0; k < n + 3; k++) {
    const tx = px0 + 0.2 + (k * (px1 - px0 - 0.4)) / (n + 2);
    if (r() < 0.75) tree(parts, tx + (r() - 0.5) * 0.2, z0 + 0.2 + r() * 0.08, seed + 500 + k, flora, 0.7 + r() * 0.2);
    else hedge(parts, tx, z0 + 0.25, 0.4, 0.22, seed + 600 + k, look.flowers);
  }
  for (const side of [-1, 1]) {
    const vx = side < 0 ? x0 + V / 2 : x1 - V / 2;
    for (let z = z0 + 0.8; z < z1 - 0.3; z += 0.62) {
      const v = r();
      if (v < 0.35) tree(parts, vx + (r() - 0.5) * 0.1, z, seed + Math.round(z * 97) + side * 5, flora, 0.62 + r() * 0.15);
      else if (v < 0.65) hedge(parts, vx, z, 0.25, 0.3, seed + Math.round(z * 31), look.flowers);
      else if (v < 0.82) flowerBed(parts, vx, z, 0.3, 0.3, seed + Math.round(z * 17), look.flowers);
      else rock(parts, vx, z, seed + Math.round(z * 11), park === 'hollow');
    }
  }
  // Benches in the queue corners.
  bench(parts, px0 + 0.3, pz1 - 0.25, 0);
  bench(parts, px1 - 0.3, pz1 - 0.25, 0);
  // ---- Lamps and bunting ----
  const lamps = [
    lamp(parts, px0 + 0.28, pz0 + 0.28),
    lamp(parts, px1 - 0.28, pz0 + 0.28),
    lamp(parts, px0 + 0.28, pz1 - 0.7),
    lamp(parts, px1 - 0.28, pz1 - 0.7),
  ];
  bunting(parts, lamps[0].clone().setY(0.62), lamps[1].clone().setY(0.62), seed);
  // ---- Cliffs: stepped rock strata all round ----
  cliffs(m, x0, x1, z0, z1, look, seed);
  // ---- The sea, and a few islets ----
  const sea = waterMaterial(look, 0);
  sea.uniforms.uC.value.set((x0 + x1) / 2, (z0 + z1) / 2);
  sea.uniforms.uHalf.value.set((x1 - x0) / 2, (z1 - z0) / 2);
  sea.uniforms.uR.value = 0.25;
  const plane = new Mesh(new PlaneGeometry(160, 160), sea);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set((x0 + x1) / 2, WATER_Y, (z0 + z1) / 2);
  group.add(plane);
  waters.push(sea);
  const isl = rng(seed + 99);
  const islets: [number, number, number][] = [
    [x0 - 1.6, z0 + 1.2, 0.7],
    [x1 + 1.5, z0 + 2.4, 0.55],
    [x0 - 1.3, z1 - 1.2, 0.45],
    [x1 + 1.8, z1 - 0.6, 0.6],
  ];
  for (const [ix, iz, ir] of islets) {
    m.blob(v3(ix, WATER_Y - 0.05, iz), ir, look.cliff[1], seed + Math.round(ix * 10), 0.25, 1.2, 0.5, 1);
    m.blob(v3(ix, WATER_Y + ir * 0.18, iz), ir * 0.8, look.lip, seed + Math.round(iz * 10), 0.2, 1.2, 0.3, 1);
    const k = 1 + Math.floor(isl() * 2);
    for (let j = 0; j < k; j++) tree(parts, ix + (isl() - 0.5) * ir, iz + (isl() - 0.5) * ir * 0.6, seed + j + Math.round(ix * 3), flora, 0.8);
  }
  // A Ferris wheel and a swing ride on the back islands.
  const ferris = ferrisWheel(x0 - 1.2, z0 - 1.6, park);
  group.add(ferris.base);
  const swing = swingRide(x1 + 1.1, z0 - 1.3, park);
  group.add(swing.base);

  for (const [key, mat] of Object.entries(MATS) as [keyof typeof MATS, (typeof MATS)[keyof typeof MATS]][]) {
    const g = parts[key];
    if (!g || g.empty) continue;
    const mesh = new Mesh(g.build(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (parts.glow && !parts.glow.empty) {
    const glow = new Mesh(parts.glow.build(), GLOW_MAT);
    glow.layers.set(GLOW_LAYER);
    glow.layers.enable(BLOOM_LAYER);
    group.add(glow);
  }
  if (!det.empty) {
    const d = new Mesh(det.build(), MATS.matte);
    d.receiveShadow = true;
    d.layers.set(GLOW_LAYER);
    group.add(d);
  }
  const boat = sailboat(seed);
  group.add(boat);
  const clouds: Group[] = [];
  const cr = rng(seed + 3);
  for (let k = 0; k < 4; k++) {
    const c = cloud(seed + k * 17);
    c.position.set(x0 + cr() * (x1 - x0), 1.1 + cr() * 0.6, z0 - 1.6 - cr() * 2.2);
    c.userData.speed = 0.05 + cr() * 0.06;
    clouds.push(c);
    group.add(c);
  }
  return { group, lamps, waters, x0, x1, z0, z1, ferris: ferris.wheel, swing: swing.spin, boat, clouds, look };
}

/** Bulbs and lanterns: unlit, and brighter at dusk. */
export const GLOW_MAT = new MeshBasicMaterial({ vertexColors: true, color: new Color(0.8, 0.8, 0.8) });

function softPatch(g: Geo, cx: number, cz: number, ramp: readonly string[], seed: number): void {
  const r = rng(seed);
  const pts: Vector3[] = [];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const rr = 0.44 + r() * 0.05;
    pts.push(v3(cx + Math.cos(a) * rr * (Math.abs(Math.cos(a)) > 0.7 ? 1.05 : 1), GRASS_Y + 0.003, cz + Math.sin(a) * rr));
  }
  g.disc(pts, ramp[1]);
  for (let k = 0; k < 16; k++) {
    const x = cx + (r() - 0.5) * 0.7;
    const z = cz + (r() - 0.5) * 0.7;
    g.cube(x, GRASS_Y + 0.006, z, 0.03, 0.006, 0.03, k % 3 ? ramp[2] : ramp[0]);
  }
  if (r() < 0.5) g.blob(v3(cx + 0.2, GRASS_Y + 0.01, cz - 0.15), 0.04, ramp[3], seed, 0.3, 1.3, 0.5, 1);
}

function bunting(p: Parts, a: Vector3, b: Vector3, seed: number): void {
  const m = p.matte!;
  const cloth = p.cloth!;
  const pts = arc(24, (t) => a.clone().lerp(b, t).setY(a.y - Math.sin(Math.PI * t) * 0.14));
  m.pipe(pts, 0.006, '#fbf6ec', 4);
  const colors = [PAL.red, PAL.gold, '#45a8e0', '#72c457', '#ff8fb8'];
  const r = rng(seed);
  for (let i = 1; i < pts.length - 1; i += 1) {
    const q = pts[i];
    const c = colors[(i + Math.floor(r() * 2)) % colors.length];
    cloth.tri(v3(q.x - 0.05, q.y, q.z), v3(q.x + 0.05, q.y, q.z), v3(q.x, q.y - 0.1, q.z + 0.01), c, v3(q.x, q.y, q.z - 1));
  }
}

function cliffs(g: Geo, x0: number, x1: number, z0: number, z1: number, look: Look3D, seed: number): void {
  const r = rng(seed + 7);
  const layers = [
    [0.04, -0.06],
    [-0.06, -0.22],
    [-0.22, -0.4],
    [-0.4, -0.58],
    [-0.58, CLIFF_BOTTOM],
  ];
  const step = 0.24;
  const side = (ax: number, az: number, bx: number, bz: number, ox: number, oz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const nseg = Math.ceil(len / step);
    for (let k = 0; k < nseg; k++) {
      const t0 = k / nseg;
      const t1 = (k + 1) / nseg;
      const sx = ax + (bx - ax) * t0;
      const sz = az + (bz - az) * t0;
      const ex = ax + (bx - ax) * t1;
      const ez = az + (bz - az) * t1;
      layers.forEach(([top, bot], li) => {
        const out = li === 0 ? 0.03 : (r() * 0.07 - 0.02) - li * 0.012;
        const inset = 0.35;
        const col = li === 0 ? look.lip : look.cliff[(li + Math.floor(r() * 2)) % look.cliff.length];
        // A slab from inside the island out to the jittered face.
        const cx = (sx + ex) / 2 + ox * (out - inset) / 2;
        const cz = (sz + ez) / 2 + oz * (out - inset) / 2;
        const w = Math.abs(ex - sx) + Math.abs(ox) * (out + inset) + 0.002;
        const d = Math.abs(ez - sz) + Math.abs(oz) * (out + inset) + 0.002;
        const jitterTop = li === 0 ? 0 : (r() - 0.5) * 0.03;
        g.cube(cx, (top + bot) / 2 + jitterTop, cz, w, top - bot, d, col, li === 0 ? 0.015 : 0, li === 0 ? shade(col, 0.05) : undefined);
      });
    }
  };
  side(x0, z1, x1, z1, 0, 1);
  side(x0, z0, x1, z0, 0, -1);
  side(x0, z0, x0, z1, -1, 0);
  side(x1, z0, x1, z1, 1, 0);
}

/** A small sailboat that circles the island. */
function sailboat(seed: number): Group {
  const g = new Group();
  const hull = new Geo();
  const r = rng(seed + 5);
  const col = [PAL.red, '#45a8e0', PAL.gold][Math.floor(r() * 3)];
  hull.box(M(0, 0.04, 0), 0.14, 0.08, 0.36, col, 0.03, PAL.white);
  hull.sphere(v3(0, 0.05, 0.18), 0.07, col, 1, 0.6, 1.4, 8, 5, true);
  hull.post(0, 0.08, -0.02, 0.008, 0.42, '#7a4e2f', 5);
  const mh = new Mesh(hull.build(), MATS.gloss);
  mh.castShadow = true;
  g.add(mh);
  const sail = new Geo();
  sail.tri(v3(0.005, 0.48, -0.02), v3(0.005, 0.12, -0.02), v3(0.005, 0.12, 0.2), PAL.white, v3(-1, 0.3, 0));
  sail.tri(v3(-0.005, 0.46, -0.04), v3(-0.005, 0.12, -0.04), v3(-0.005, 0.12, -0.2), '#ffd0c8', v3(1, 0.3, 0));
  g.add(new Mesh(sail.build(), MATS.cloth));
  g.userData.phase = r() * Math.PI * 2;
  return g;
}

/** A puffy cloud of a few blobs. */
function cloud(seed: number): Group {
  const g = new Group();
  const geo = new Geo();
  const r = rng(seed);
  const n = 3 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) geo.blob(v3((k - n / 2) * 0.28 + r() * 0.1, r() * 0.12, r() * 0.2), 0.2 + r() * 0.14, '#ffffff', seed + k, 0.12, 1, 0.75, 1, 0.0);
  const m = new Mesh(geo.build(), MATS.matte);
  m.castShadow = true;
  g.add(m);
  return g;
}

/** A little Ferris wheel on its own islet; returns the wheel so it can turn. */
function ferrisWheel(x: number, z: number, park: ParkId): { base: Group; wheel: Group } {
  const base = new Group();
  const g = new Geo();
  const look = LOOKS[park];
  g.blob(v3(x, WATER_Y - 0.1, z), 0.9, look.cliff[1], 11, 0.2, 1.3, 0.55, 1);
  g.blob(v3(x, WATER_Y + 0.22, z), 0.75, look.lip, 12, 0.15, 1.3, 0.25, 1);
  const hub = v3(x, WATER_Y + 1.35, z);
  for (const sz of [-0.12, 0.12]) {
    g.beam(v3(x - 0.45, WATER_Y + 0.3, z + sz), hub.clone().setZ(z + sz), 0.05, '#e7e9f2');
    g.beam(v3(x + 0.45, WATER_Y + 0.3, z + sz), hub.clone().setZ(z + sz), 0.05, '#e7e9f2');
  }
  const mesh = new Mesh(g.build(), MATS.matte);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  base.add(mesh);
  const wheel = new Group();
  wheel.position.copy(hub);
  const w = new Geo();
  const R = 0.95;
  const colors = [PAL.red, PAL.gold, '#45a8e0', '#72c457', '#9d6ef0', '#ff9a3c', '#ff8fb8', '#35c2b0'];
  for (const sz of [-0.1, 0.1]) {
    const ring = arc(32, (t) => v3(Math.cos(t * Math.PI * 2) * R, Math.sin(t * Math.PI * 2) * R, sz));
    w.pipe(ring.slice(0, 32), 0.022, '#fbf6ec', 5, true);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      w.beam(v3(0, 0, sz), v3(Math.cos(a) * R, Math.sin(a) * R, sz), 0.018, '#fbf6ec');
    }
  }
  w.cyl(new Matrix4().makeRotationX(Math.PI / 2), 0.08, 0.08, 0.3, PAL.gold, 10);
  const wm = new Mesh(w.build(), MATS.gloss);
  wm.castShadow = true;
  wheel.add(wm);
  // Gondolas hang from the rim and stay level (counter-rotated each frame).
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const gg = new Geo();
    gg.box(M(0, -0.14, 0), 0.2, 0.14, 0.2, colors[k], 0.03);
    gg.cyl(M(0, -0.04, 0), 0.02, 0.12, 0.08, colors[k], 6);
    gg.beam(v3(0, 0, 0), v3(0, -0.07, 0), 0.015, '#fbf6ec');
    const gm = new Mesh(gg.build(), MATS.gloss);
    gm.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    gm.userData.gondola = true;
    wheel.add(gm);
  }
  base.add(wheel);
  return { base, wheel };
}

/** A swing carousel: a tower with a spinning, tilting top. */
function swingRide(x: number, z: number, park: ParkId): { base: Group; spin: Group } {
  const base = new Group();
  const look = LOOKS[park];
  const g = new Geo();
  g.blob(v3(x, WATER_Y - 0.1, z), 0.7, look.cliff[2], 21, 0.2, 1.3, 0.55, 1);
  g.blob(v3(x, WATER_Y + 0.2, z), 0.6, look.lip, 22, 0.15, 1.3, 0.25, 1);
  g.post(x, WATER_Y + 0.3, z, 0.06, 1.1, '#fbf6ec', 10);
  const mesh = new Mesh(g.build(), MATS.matte);
  mesh.castShadow = true;
  base.add(mesh);
  const spin = new Group();
  spin.position.set(x, WATER_Y + 1.4, z);
  const s = new Geo();
  s.cyl(M(0, 0.1, 0), 0.5, 0.06, 0.26, PAL.red, 12, PAL.gold);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    s.tri(v3(Math.cos(a) * 0.5, -0.03, Math.sin(a) * 0.5), v3(Math.cos(a + 0.26) * 0.5, -0.03, Math.sin(a + 0.26) * 0.5), v3(Math.cos(a + 0.13) * 0.46, -0.1, Math.sin(a + 0.13) * 0.46), k % 2 ? PAL.white : PAL.red, v3(0, 0.5, 0));
    const c = v3(Math.cos(a) * 0.62, -0.42, Math.sin(a) * 0.62);
    s.beam(v3(Math.cos(a) * 0.45, -0.03, Math.sin(a) * 0.45), c, 0.008, '#e7e9f2');
    s.box(M(c.x, c.y, c.z), 0.07, 0.03, 0.07, ['#45a8e0', PAL.gold, '#72c457'][k % 3], 0.01);
  }
  const sm = new Mesh(s.build(), MATS.gloss);
  sm.castShadow = true;
  spin.add(sm);
  base.add(spin);
  return { base, spin };
}


import { AmbientLight, DirectionalLight, Group, HemisphereLight, Matrix4, Mesh, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { PAL, THEMES } from '../render/palette';
import { BOSSES, type BossId, type Look } from '../riders/riders';
import type { NodeKind, ParkId } from '../run/run';
import { Geo, shade, v3 } from './geo';
import { M, arc, carGeo, personGeo } from './models';
import { MATS } from './toon';

// Little clay dioramas for the route map: every stop is a round clay token with a
// scene on it (a loop for a regular day, a crown on a red carpet for the VIP, a
// storm cloud, the shop's striped tent, a patched-up heart, the capsule machine,
// the boss on a pedestal). Rendered once each, offscreen, with the game's own clay.

const S = 220;
let gl: WebGLRenderer | null = null;
let failed = false;
const scene = new Scene();
const cam = new PerspectiveCamera(26, 1, 0.05, 30);
const stage = new Group();
const cache = new Map<string, string>();

function setup(): WebGLRenderer | null {
  if (gl || failed) return gl;
  try {
    const c = document.createElement('canvas');
    gl = new WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
    gl.setPixelRatio(1);
    gl.setSize(S, S, false);
    gl.setClearColor(0x000000, 0);
    const sun = new DirectionalLight('#fff2dc', 2.6);
    sun.position.set(-1.5, 3, 2.5);
    scene.add(sun, new HemisphereLight('#d6e6ff', '#b89a78', 1.7), new AmbientLight('#ffffff', 0.15), stage);
  } catch {
    failed = true;
    gl = null;
  }
  return gl;
}

export type MapArt = NodeKind | 'gates' | 'token';

/** A data URL of the diorama for a stop (or '' when WebGL isn't available). */
export function mapArt(kind: MapArt, park: ParkId, boss?: BossId): string {
  const key = `${kind}:${park}:${boss ?? ''}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const r = setup();
  if (!r) {
    cache.set(key, '');
    return '';
  }
  stage.clear();
  const parts = { matte: new Geo(), gloss: new Geo() };
  const th = THEMES[park];
  if (kind !== 'token') base(parts.matte, th.grass[1], th.grass[3]);
  build(kind, parts, stage, park, boss);
  for (const [k, mat] of [['matte', MATS.matte], ['gloss', MATS.gloss]] as const)
    if (!parts[k].empty) stage.add(new Mesh(parts[k].build(), mat));
  const big = kind === 'boss' || kind === 'finale';
  const d = kind === 'token' ? 1.25 : big ? 2.45 : 2.2;
  cam.position.set(0, d * 0.62, d);
  cam.lookAt(0, kind === 'token' ? 0.08 : big ? 0.34 : 0.26, 0);
  r.render(scene, cam);
  const url = blobUrl(r.domElement.toDataURL('image/png'));
  cache.set(key, url);
  return url;
}

/** A short blob: URL for an image (keeps the map's HTML small). */
function blobUrl(dataUrl: string): string {
  try {
    const bin = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  } catch {
    return dataUrl;
  }
}

/** The round clay token every stop stands on. */
function base(g: Geo, grass: string, edge: string): void {
  g.cyl(M(0, -0.05, 0), 0.62, 0.66, 0.1, shade(edge, -0.25), 28, undefined, true);
  g.cyl(M(0, 0.02, 0), 0.6, 0.62, 0.06, grass, 28, shade(grass, 0.06), true);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3;
    g.sphere(v3(Math.cos(a) * 0.5, 0.06, Math.sin(a) * 0.5), 0.035, shade(grass, -0.12), 1, 0.6, 1, 6, 4, true);
  }
}

type P = { matte: Geo; gloss: Geo };

function figure(stage: Group, look: Look, face: Parameters<typeof personGeo>[1], at: [number, number, number], scale: number, arms = 0): void {
  const g = personGeo(look, face);
  const rig = new Group();
  rig.add(new Mesh(g.body, MATS.figure));
  if (g.leg)
    for (const sx of [-1, 1]) {
      const leg = new Mesh(g.leg, MATS.figure);
      leg.position.set(sx * g.hipX, g.hipY, 0);
      rig.add(leg);
    }
  for (const sx of [-1, 1]) {
    const arm = new Mesh(g.arm, MATS.figure);
    arm.position.set(sx * g.shoulderX, g.shoulderY, 0);
    arm.rotation.z = sx * (0.2 + arms * 2.4);
    rig.add(arm);
  }
  rig.position.set(...at);
  rig.scale.setScalar(scale * g.scale);
  stage.add(rig);
}

function build(kind: MapArt, p: P, stage: Group, park: ParkId, boss?: BossId): void {
  const { matte: m, gloss: gl } = p;
  switch (kind) {
    case 'day':
    case 'storm': {
      // A little loop on its supports.
      const red = kind === 'storm' ? '#45a8e0' : PAL.red;
      const ring = arc(40, (t) => v3(Math.sin(t * Math.PI * 2) * 0.24 + (t - 0.5) * 0.08, 0.36 - Math.cos(t * Math.PI * 2) * 0.28, (t - 0.5) * 0.12));
      for (const dz of [-0.035, 0.035]) gl.pipe(ring.map((q) => q.clone().setZ(q.z + dz)), 0.022, red, 8);
      gl.pipe([v3(-0.5, 0.1, -0.06), v3(-0.04, 0.08, -0.06)], 0.022, red, 8);
      gl.pipe([v3(0.04, 0.08, 0.06), v3(0.5, 0.1, 0.06)], 0.022, red, 8);
      for (const x of [-0.4, -0.2, 0.2, 0.4]) m.post(x, 0.05, 0, 0.018, 0.05, '#2b2140', 6);
      m.post(0, 0.05, 0.14, 0.02, 0.5, '#e7e9f2', 6);
      const car = new Mesh(carGeo('lead'), MATS.gloss);
      car.position.set(-0.3, 0.12, -0.06);
      car.rotation.y = Math.PI / 2;
      car.scale.setScalar(0.9);
      stage.add(car);
      if (kind === 'storm') {
        // A grumpy cloud with a lightning bolt, and rain.
        for (const [x, y, z, r] of [[-0.18, 0.86, 0, 0.16], [0.02, 0.92, 0.02, 0.2], [0.22, 0.85, 0, 0.15], [0.08, 0.8, 0.12, 0.14], [-0.08, 0.78, 0.1, 0.13]] as const)
          m.sphere(v3(x, y, z), r, '#8e98b8', 1, 0.85, 1, 12, 8, true);
        for (const sx of [-1, 1]) {
          m.sphere(v3(sx * 0.06 + 0.02, 0.84, 0.25), 0.022, '#fbf8f0', 1, 1, 0.6, 8, 5, true);
          m.sphere(v3(sx * 0.06 + 0.02, 0.84, 0.27), 0.011, PAL.ink, 1, 1, 0.6, 6, 4, true);
        }
        const bolt = [v3(0.12, 0.7, 0.14), v3(0.02, 0.52, 0.16), v3(0.1, 0.5, 0.16), v3(-0.04, 0.26, 0.18)];
        for (let k = 0; k + 1 < bolt.length; k++) gl.beam(bolt[k], bolt[k + 1], 0.05, PAL.gold, 0.03);
        for (let k = 0; k < 7; k++) gl.sphere(v3(-0.3 + k * 0.1, 0.5 - (k % 3) * 0.1, 0.12 + (k % 2) * 0.1), 0.02, '#8fd8ff', 0.7, 1.6, 0.7, 6, 4, true);
      }
      break;
    }
    case 'vip': {
      // Red carpet, velvet ropes and a crown on a cushion.
      m.cube(0, 0.06, 0.05, 0.3, 0.012, 0.95, '#d6334a', 0.004);
      for (const sx of [-1, 1]) {
        for (const z of [-0.25, 0.35]) {
          m.post(sx * 0.26, 0.05, z, 0.02, 0.22, PAL.gold, 8);
          gl.sphere(v3(sx * 0.26, 0.29, z), 0.03, PAL.gold, 1, 1, 1, 8, 5, true);
        }
        gl.pipe(arc(10, (t) => v3(sx * 0.26, 0.24 - Math.sin(Math.PI * t) * 0.06, -0.25 + t * 0.6)), 0.014, '#8a1c3c', 6);
      }
      m.sphere(v3(0, 0.22, -0.05), 0.2, '#9d6ef0', 1.1, 0.45, 1, 14, 8, true);
      gl.cyl(M(0, 0.36, -0.05), 0.13, 0.14, 0.1, PAL.gold, 16, undefined, true);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        gl.cyl(M(Math.cos(a) * 0.12, 0.46, -0.05 + Math.sin(a) * 0.12), 0.035, 0, 0.1, PAL.gold, 6);
        gl.sphere(v3(Math.cos(a) * 0.12, 0.52, -0.05 + Math.sin(a) * 0.12), 0.018, k % 2 ? '#45a8e0' : PAL.red, 1, 1, 1, 6, 4, true);
      }
      break;
    }
    case 'shop': {
      // A striped tent with a pennant, and a counter of goodies.
      m.cyl(M(0, 0.2, -0.05), 0.3, 0.3, 0.3, PAL.white, 16, undefined, true);
      m.cyl(M(0, 0.47, -0.05), 0.4, 0.0, 0.3, PAL.red, 16, undefined, true);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        m.beam(v3(Math.cos(a) * 0.39, 0.33, -0.05 + Math.sin(a) * 0.39), v3(0, 0.62, -0.05), 0.05, PAL.white, 0.01);
      }
      m.post(0, 0.6, -0.05, 0.012, 0.2, PAL.ink, 6);
      m.box(M(0.06, 0.76, -0.05), 0.12, 0.07, 0.01, PAL.gold, 0.005);
      m.cube(0, 0.14, 0.3, 0.46, 0.16, 0.12, '#b98552', 0.02, '#d3a36c');
      for (let k = 0; k < 4; k++) gl.cyl(M(-0.15 + k * 0.1, 0.23, 0.3), 0.035, 0.035, 0.014, PAL.gold, 12, undefined, true);
      break;
    }
    case 'repair': {
      // A big clay heart with a sticking plaster, and a wrench.
      const h = new Matrix4().makeTranslation(0, 0.4, 0);
      gl.sphere(v3(-0.11, 0.48, 0), 0.16, PAL.heart, 1, 1, 0.8, 14, 9, true);
      gl.sphere(v3(0.11, 0.48, 0), 0.16, PAL.heart, 1, 1, 0.8, 14, 9, true);
      gl.cyl(new Matrix4().copy(h).multiply(new Matrix4().makeRotationZ(Math.PI)).setPosition(0, 0.32, 0), 0.25, 0.0, 0.3, PAL.heart, 16, undefined, true);
      m.box(new Matrix4().makeRotationZ(0.6).setPosition(0.02, 0.44, 0.13), 0.3, 0.08, 0.02, '#f3d9b0', 0.02);
      for (const dx of [-0.02, 0.03]) m.sphere(v3(dx, 0.44 + dx * 0.7, 0.145), 0.008, '#c9a77c', 1, 1, 0.5, 6, 4, true);
      gl.beam(v3(0.25, 0.07, 0.3), v3(0.45, 0.07, -0.05), 0.04, '#a9adc0', 0.03);
      gl.pipe(arc(10, (t) => v3(0.45 + Math.cos(t * Math.PI * 1.6 + 1) * 0.06, 0.07, -0.05 + Math.sin(t * Math.PI * 1.6 + 1) * 0.06)), 0.018, '#a9adc0', 6);
      break;
    }
    case 'treasure': {
      // The capsule machine: a red stand, a glass-ish globe full of eggs, a crank.
      m.cyl(M(0, 0.16, 0), 0.22, 0.26, 0.26, PAL.red, 16, undefined, true);
      m.cube(0, 0.18, 0.2, 0.12, 0.1, 0.06, '#2b2140', 0.02);
      gl.cyl(new Matrix4().makeRotationX(Math.PI / 2).setPosition(0.14, 0.26, 0.23), 0.035, 0.035, 0.04, PAL.gold, 10);
      gl.sphere(v3(0, 0.5, 0), 0.24, '#d8f2ff', 1, 1, 1, 18, 12, true);
      const eggs = ['#ff5d8a', PAL.gold, '#45a8e0', '#72c457', '#9d6ef0', '#ff9a3c'];
      for (let k = 0; k < 9; k++) {
        const a = k * 2.4;
        const y = 0.38 + (k % 3) * 0.08;
        gl.sphere(v3(Math.cos(a) * 0.12, y, Math.sin(a) * 0.12 + 0.08), 0.06, eggs[k % eggs.length], 1, 1.1, 1, 10, 7, true);
      }
      gl.cyl(M(0, 0.76, 0), 0.07, 0.09, 0.04, PAL.red, 12);
      break;
    }
    case 'boss':
    case 'finale': {
      // The boss on a pedestal, flanked by torches.
      const id = boss ?? 'barry';
      m.cyl(M(0, 0.12, 0), 0.34, 0.38, 0.14, '#4e4866', 20, '#6e6886', true);
      gl.cyl(M(0, 0.195, 0), 0.35, 0.35, 0.02, PAL.gold, 20);
      for (const sx of [-1, 1]) {
        m.post(sx * 0.46, 0.05, -0.1, 0.03, 0.34, '#2b2140', 7);
        gl.sphere(v3(sx * 0.46, 0.44, -0.1), 0.07, '#ff9a3c', 0.9, 1.3, 0.9, 10, 7, true);
        gl.sphere(v3(sx * 0.46, 0.5, -0.1), 0.04, PAL.gold, 0.8, 1.4, 0.8, 8, 5, true);
      }
      if (kind === 'finale') for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        gl.sphere(v3(Math.cos(a) * 0.22, 1.05 + Math.sin(a) * 0.22, -0.3), 0.03, ['#ff5d8a', PAL.gold, '#45a8e0'][k % 3], 1, 1, 1, 6, 4, true);
      }
      const look: Look = { skin: 1, hair: 0, hairStyle: 'short', shirt: 0, pants: 1, accessory: 'none', small: false, ...BOSSES[id].look, big: true };
      figure(stage, look, 'cocky', [0, 0.21, 0.02], 0.5, 0.15);
      break;
    }
    case 'gates': {
      // The park gates: two striped towers and an arch.
      for (const sx of [-1, 1]) {
        m.cyl(M(sx * 0.36, 0.25, 0), 0.08, 0.08, 0.42, PAL.white, 12, undefined, true);
        for (let k = 0; k < 3; k++) m.cyl(M(sx * 0.36, 0.1 + k * 0.14, 0), 0.085, 0.085, 0.04, PAL.red, 12);
        m.cyl(M(sx * 0.36, 0.53, 0), 0.12, 0, 0.16, PAL.red, 12);
        gl.sphere(v3(sx * 0.36, 0.63, 0), 0.025, PAL.gold, 1, 1, 1, 6, 4, true);
      }
      gl.pipe(arc(16, (t) => v3(-0.36 + t * 0.72, 0.44 + Math.sin(Math.PI * t) * 0.12, 0)), 0.04, PAL.gold, 8);
      m.box(M(0, 0.5, 0.03), 0.4, 0.1, 0.02, PAL.red, 0.02);
      for (let k = 0; k < 5; k++) gl.sphere(v3(-0.14 + k * 0.07, 0.5, 0.045), 0.012, '#fff1b0', 1, 1, 1, 6, 4);
      break;
    }
    case 'token': {
      // The lead car with a little flag: "you are here".
      const car = new Mesh(carGeo('lead'), MATS.gloss);
      car.rotation.y = -0.6;
      car.scale.setScalar(1.3);
      stage.add(car);
      m.post(-0.08, 0.15, -0.1, 0.008, 0.26, PAL.ink, 6);
      m.box(M(-0.03, 0.37, -0.1), 0.1, 0.06, 0.008, PAL.gold, 0.004);
      break;
    }
  }
  void park;
}

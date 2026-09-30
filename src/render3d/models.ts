import { type BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { HAIRS, MYSTERY, PAL, PANTS, SHIRTS, SKINS, TIER_RAMPS } from '../render/palette';
import type { Look } from '../riders/riders';
import { type Col, Geo, rng, shade, v3 } from './geo';

// Procedural models, built once and cached: piece crates with sculpted icons,
// chibi guests, coaster cars, trees, rocks, ponds, the snack stand, lamps.
// Everything faces +Z (toward the camera); one unit is one board cell.

const cache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (!v) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

const M = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
const RX = (a: number) => new Matrix4().makeRotationX(a);
const RZ = (a: number) => new Matrix4().makeRotationZ(a);
const RY = (a: number) => new Matrix4().makeRotationY(a);

export const CRATE_H = 0.3;
export const CRATE_W = 0.8;

// ---- Crates -------------------------------------------------------------------

/** Icon strokes on a crate top: a polyline tube. */
function icon(g: Geo, pts: Vector3[], color: Col, r = 0.026, closed = false): void {
  g.pipe(pts, r, color, 7, closed);
  if (!closed) {
    g.sphere(pts[0], r, color, 1, 1, 1, 7, 4, true);
    g.sphere(pts[pts.length - 1], r, color, 1, 1, 1, 7, 4, true);
  }
}

function arc(n: number, f: (t: number) => Vector3): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) out.push(f(i / n));
  return out;
}

function star(g: Geo, c: Vector3, r: number, color: Col, depth = 0.04): void {
  const outer: Vector3[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    outer.push(v3(Math.cos(a) * rr, -Math.sin(a) * rr, 0));
  }
  const f = outer.map((p) => p.clone().add(c).setZ(c.z + depth / 2));
  const b = outer.map((p) => p.clone().add(c).setZ(c.z - depth / 2));
  const cf = c.clone().setZ(c.z + depth / 2);
  const cb = c.clone().setZ(c.z - depth / 2);
  for (let i = 0; i < 10; i++) {
    const j = (i + 1) % 10;
    g.tri(cf, f[i], f[j], color, cb.clone().setZ(c.z - 1));
    g.tri(cb, b[i], b[j], shade(color, -0.1), cf.clone().setZ(c.z + 1));
    g.quad(f[i], f[j], b[j], b[i], shade(color, -0.05), c);
  }
}

export function crateGeo(tier: number): BufferGeometry {
  return cached(`crate${tier}`, () => {
    const r = TIER_RAMPS[tier];
    const g = new Geo();
    const h = CRATE_H;
    const w = CRATE_W;
    g.box(M(0, h / 2, 0), w, h, w, r[1], 0.07, r[0]);
    // Slats: two bands around the sides and corner posts.
    for (const y of [0.075, h - 0.085]) {
      g.cube(0, y, w / 2 + 0.004, w - 0.16, 0.045, 0.012, r[2]);
      g.cube(0, y, -w / 2 - 0.004, w - 0.16, 0.045, 0.012, r[2]);
      g.cube(w / 2 + 0.004, y, 0, 0.012, 0.045, w - 0.16, r[2]);
      g.cube(-w / 2 - 0.004, y, 0, 0.012, 0.045, w - 0.16, r[2]);
    }
    // A sculpted icon on the lid.
    const top = h + 0.005;
    const ic = tier === 7 ? PAL.red : PAL.white;
    const dark = r[3];
    switch (tier) {
      case 1:
        icon(g, arc(12, (t) => v3(-0.22 + t * 0.44, top + 0.035 + Math.sin(Math.PI * t) ** 2 * 0.1, 0)), ic);
        break;
      case 2:
        icon(g, arc(16, (t) => v3(-0.24 + t * 0.48, top + 0.035 + Math.sin(Math.PI * t) ** 2 * 0.22, 0)), ic);
        break;
      case 3:
        icon(
          g,
          arc(18, (t) => {
            const y = t < 0.55 ? (t / 0.55) * 0.26 : 0.26 * (1 - Math.min(1, (t - 0.55) / 0.25)) ** 2;
            return v3(-0.24 + t * 0.48, top + 0.035 + y, 0);
          }),
          ic,
        );
        for (let k = 1; k < 5; k++) g.cube(-0.24 + k * 0.05, top + 0.035 + ((k * 0.05) / 0.264) * 0.26 - 0.03, 0, 0.018, 0.03, 0.05, dark);
        break;
      case 4:
        icon(g, arc(60, (t) => v3(Math.cos(t * Math.PI * 5) * 0.15, top + 0.04 + t * 0.2, Math.sin(t * Math.PI * 5) * 0.15)), ic, 0.022);
        g.post(0, top, 0, 0.03, 0.26, dark, 6);
        break;
      case 5:
        icon(g, arc(28, (t) => v3(Math.sin(t * Math.PI * 2) * 0.15, top + 0.18 - Math.cos(t * Math.PI * 2) * 0.15, 0)), ic, 0.03, true);
        g.cube(0, top + 0.015, 0, 0.36, 0.03, 0.08, dark);
        break;
      case 6:
        icon(
          g,
          arc(48, (t) => {
            const a = t * Math.PI * 4;
            return v3(-0.24 + t * 0.48, top + 0.14 + Math.cos(a) * 0.1, Math.sin(a) * 0.1);
          }),
          ic,
          0.024,
        );
        break;
      case 7: {
        icon(g, arc(32, (t) => v3(Math.sin(t * Math.PI * 2) * 0.19, top + 0.21 - Math.cos(t * Math.PI * 2) * 0.19, 0)), PAL.white, 0.034, true);
        star(g, v3(0, top + 0.21, 0), 0.1, ic, 0.05);
        g.cube(0, top + 0.015, 0, 0.44, 0.03, 0.1, dark);
        break;
      }
    }
    return g.build();
  });
}

const QMARK = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];

export function mysteryGeo(): BufferGeometry {
  return cached('mystery', () => {
    const r = MYSTERY;
    const g = new Geo();
    g.box(M(0, CRATE_H / 2, 0), CRATE_W, CRATE_H, CRATE_W, r[1], 0.07, r[0]);
    const s = 0.06;
    QMARK.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '#') g.cube((x - 2) * s, CRATE_H + 0.02, (y - 3) * s, s * 0.92, 0.04, s * 0.92, r[0]);
      }),
    );
    return g.build();
  });
}

// ---- People ---------------------------------------------------------------------

export interface PersonGeo {
  body: BufferGeometry;
  arm: BufferGeometry;
  leg: BufferGeometry | null;
  /** Shoulder height and half width, for placing arms. */
  shoulderY: number;
  shoulderX: number;
  headY: number;
  hipX: number;
  hipY: number;
  scale: number;
}

export type Face = 'smile' | 'meh' | 'scream' | 'sick';

function lookKey(l: Look): string {
  return [l.skin, l.hair, l.hairStyle, l.shirt, l.pants, l.accessory, l.small ? 1 : 0, l.big ? 1 : 0].join('.');
}

/** A chibi guest, feet at the origin. `seated` drops the legs (for riders). */
export function personGeo(look: Look, face: Face, seated = false): PersonGeo {
  return cached(`p${lookKey(look)}:${face}:${seated ? 1 : 0}`, () => buildPerson(look, face, seated));
}

function buildPerson(look: Look, face: Face, seated: boolean): PersonGeo {
  const g = new Geo();
  const ghost = look.pants === 4;
  const skin = face === 'sick' ? '#a6e05a' : SKINS[look.skin];
  const shirt = SHIRTS[look.shirt];
  const pants = PANTS[look.pants];
  const hair = HAIRS[look.hair];
  const kid = look.small;
  const belly = look.big ? 1.25 : 1;
  const legH = kid ? 0.07 : 0.1;
  const torsoH = kid ? 0.1 : 0.13;
  const torsoW = (kid ? 0.14 : 0.16) * belly;
  const headR = kid ? 0.105 : 0.1;
  const y0 = seated ? 0 : legH;
  // Torso: a chamfered box, a little wider at the belly.
  if (ghost) {
    g.cyl(M(0, y0 + torsoH / 2 - 0.02, 0), 0.12, 0.08, torsoH + 0.06, pants, 10);
  } else {
    g.box(M(0, y0 + torsoH / 2, 0), torsoW, torsoH, 0.12 * belly, shirt, 0.035);
    // Belt line.
    g.box(M(0, y0 + 0.012, 0), torsoW + 0.004, 0.024, 0.12 * belly + 0.004, pants, 0.01);
    if (look.big) g.box(M(0, y0 + torsoH * 0.55, 0.06 * belly), 0.05, 0.05, 0.02, PAL.gold, 0.01);
  }
  const hy = y0 + torsoH + headR * 0.92;
  // Everything on the head is tilted back afterwards, so faces look up at the camera.
  const headFrom = g.count;
  g.sphere(v3(0, hy, 0), headR, skin, 1.08, 0.98, 1, 14, 9, true);
  // Face.
  const fz = headR * 0.94;
  const eyeY = hy + 0.005;
  const eyeX = headR * 0.38;
  // Googly clay eyes: white balls with black pupils (tiny and terrified when screaming).
  const skinC = skin;
  const eyeR = 0.026;
  const look2 = (lookKey(look).length * 7919) % 5;
  const gaze = [[0, 0], [0.004, 0.002], [-0.004, 0.002], [0.003, -0.003], [-0.002, 0.004]][look2];
  const googly = (sx: number) => {
    const ex = sx * eyeX * 1.08;
    g.sphere(v3(ex, eyeY + 0.008, fz - 0.006), eyeR, '#fbf8f0', 1, 1.12, 0.75, 12, 8, true);
    const pr = face === 'scream' ? 0.007 : 0.012;
    const px = face === 'scream' ? sx * 0.004 : gaze[0];
    g.sphere(v3(ex + px, eyeY + 0.008 + (face === 'scream' ? 0 : gaze[1]), fz + eyeR * 0.72 - 0.004), pr, '#1a1226', 1, 1, 0.5, 10, 6, true);
    g.sphere(v3(ex + px + 0.004, eyeY + 0.013, fz + eyeR * 0.72), 0.0035, '#ffffff', 1, 1, 0.5, 6, 4, true);
    // Heavy lids when meh or sick.
    if (face === 'meh' || face === 'sick') g.sphere(v3(ex, eyeY + 0.016, fz - 0.004), eyeR * 1.08, skinC, 1, 0.6, 0.8, 12, 6, true);
  };
  if (look.accessory === 'shades') {
    g.box(M(0, eyeY + 0.008, fz + 0.012), headR * 1.6, 0.045, 0.022, PAL.ink, 0.012);
  } else {
    for (const sx of [-1, 1]) googly(sx);
    if (look.accessory === 'glasses')
      for (const sx of [-1, 1]) {
        const ring = arc(12, (t) => v3(sx * eyeX * 1.08 + Math.cos(t * Math.PI * 2) * 0.033, eyeY + 0.008 + Math.sin(t * Math.PI * 2) * 0.033, fz + 0.016));
        g.pipe(ring.slice(0, 12), 0.005, '#e8e8f4', 5, true);
      }
  }
  // A big clay nose.
  g.sphere(v3(0, hy - 0.012, fz + 0.006), 0.018, shade(skin, -0.06), 1.1, 0.9, 0.9, 8, 6, true);
  // Cheeks.
  for (const sx of [-1, 1]) g.sphere(v3(sx * headR * 0.66, hy - 0.028, fz * 0.84), 0.018, face === 'sick' ? '#7fb83e' : '#ff9aa8', 1, 0.7, 0.4, 7, 4, true);
  // Mouths: a wide Aardman grin with teeth, a gaping scream, a queasy wobble.
  if (face === 'scream') {
    g.sphere(v3(0, hy - 0.048, fz * 0.95), 0.032, '#4a1426', 1.1, 1.25, 0.5, 12, 8, true);
    g.sphere(v3(0, hy - 0.058, fz * 0.95 + 0.008), 0.014, '#ff6b8a', 1.2, 0.6, 0.5, 8, 5, true);
  } else if (face === 'sick') {
    for (let k = 0; k < 5; k++) g.sphere(v3(-0.024 + k * 0.012, hy - 0.045 + (k % 2 ? 0.004 : -0.002), fz * 0.97), 0.006, '#3c5a1a', 1, 1, 0.6, 6, 4, true);
    for (const sx of [-1, 1]) g.sphere(v3(sx * headR * 0.5, hy - 0.035, fz * 0.9), 0.022, '#9ad24e', 1, 0.9, 0.6, 8, 5, true);
  } else if (face === 'meh') g.box(M(0, hy - 0.042, fz * 0.99), 0.032, 0.008, 0.01, PAL.ink, 0.003);
  else {
    g.sphere(v3(0, hy - 0.04, fz * 0.94), 0.03, '#4a1426', 1.5, 0.55, 0.5, 12, 6, true);
    g.box(M(0, hy - 0.032, fz * 0.94 + 0.012), 0.05, 0.008, 0.008, '#fbf8f0', 0.002);
  }
  // Hair.
  const cap = (col: Col, back = -0.012, sy = 0.78) => g.sphere(v3(0, hy + 0.02, back), headR * 1.07, col, 1.06, sy, 1.02, 14, 8, true);
  switch (look.hairStyle) {
    case 'short':
      cap(hair);
      break;
    case 'long':
      cap(hair);
      g.box(M(0, hy - 0.05, -0.045), headR * 1.9, 0.16, 0.07, hair, 0.03);
      for (const sx of [-1, 1]) g.box(M(sx * headR * 0.95, hy - 0.04, 0.0), 0.03, 0.12, 0.08, hair, 0.012);
      break;
    case 'bun':
      cap(hair);
      g.sphere(v3(0, hy + headR * 1.05, -0.03), 0.05, hair, 1, 0.9, 1, 9, 6, true);
      break;
    case 'spiky':
      cap(hair, -0.01, 0.7);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const dir = v3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55 - 0.2).normalize();
        const base = v3(0, hy, 0).addScaledVector(dir, headR * 0.9);
        const q = new Quaternion().setFromUnitVectors(v3(0, 1, 0), dir);
        g.cyl(new Matrix4().makeRotationFromQuaternion(q).setPosition(base.addScaledVector(dir, 0.03)), 0.03, 0, 0.07, hair, 5);
      }
      break;
    case 'cap': {
      const cc = SHIRTS[(look.shirt + 3) % SHIRTS.length];
      cap(cc, -0.005, 0.72);
      g.box(M(0, hy + 0.035, headR * 0.95), headR * 1.3, 0.016, 0.09, shade(cc, -0.1), 0.006);
      g.sphere(v3(0, hy + headR * 0.82, 0), 0.015, PAL.white, 1, 1, 1, 6, 4);
      break;
    }
    case 'bald':
      g.sphere(v3(-0.03, hy + headR * 0.8, 0.02), 0.016, shade(skin, 0.5), 1, 0.5, 1, 6, 4, true);
      break;
  }
  if (look.big) {
    // Bosses: a tiny cap and a moustache.
    g.cyl(M(0, hy + headR * 0.95, 0), headR * 0.45, headR * 0.4, 0.05, PAL.red, 10);
    g.box(M(0, hy - 0.022, fz * 1.0), 0.07, 0.018, 0.02, HAIRS[look.hair], 0.008);
  }
  const tiltBack = seated ? 0.15 : 0.42;
  g.transform(new Matrix4().makeTranslation(0, hy, 0).multiply(new Matrix4().makeRotationX(-tiltBack)).multiply(new Matrix4().makeTranslation(0, -hy, 0)), headFrom);
  // Accessories.
  if (look.accessory === 'camera') {
    g.box(M(0.02, y0 + torsoH * 0.55, 0.07), 0.07, 0.05, 0.03, PAL.ink, 0.01);
    g.cyl(new Matrix4().makeRotationX(Math.PI / 2).setPosition(0.02, y0 + torsoH * 0.55, 0.09), 0.016, 0.016, 0.02, '#8c96b8', 8);
  } else if (look.accessory === 'corndog') {
    g.beam(v3(0.13, y0 + 0.02, 0.07), v3(0.15, y0 + 0.2, 0.08), 0.012, '#e8d9b0');
    g.cyl(new Matrix4().makeRotationZ(-0.1).setPosition(0.155, y0 + 0.2, 0.08), 0.03, 0.028, 0.12, '#e0962a', 8);
  } else if (look.accessory === 'balloon' && !seated) {
    g.beam(v3(0.13, y0 + 0.04, 0.03), v3(0.18, y0 + 0.5, 0.0), 0.006, '#e4e4ec');
    g.sphere(v3(0.18, y0 + 0.58, 0), 0.08, PAL.red, 0.95, 1.1, 0.95, 12, 8, true);
    g.sphere(v3(0.155, y0 + 0.61, 0.06), 0.018, '#ffd0c8', 1, 1, 0.5, 6, 4, true);
  }
  // Arm: shoulder at the origin, hanging down -Y.
  const arm = new Geo();
  arm.cyl(M(0, -0.03, 0), 0.03, 0.028, 0.06, ghost ? pants : shirt, 7, undefined, true);
  arm.cyl(M(0, -0.075, 0), 0.026, 0.024, 0.04, ghost ? pants : skin, 7, undefined, true);
  arm.sphere(v3(0, -0.1, 0), 0.03, ghost ? pants : skin, 1, 1, 1, 8, 5, true);
  // Leg: hip at the origin, foot at -legH.
  let leg: Geo | null = null;
  if (!seated && !ghost) {
    leg = new Geo();
    leg.cyl(M(0, -legH / 2 + 0.01, 0), 0.034, 0.03, legH - 0.01, pants, 7, undefined, true);
    leg.box(M(0, -legH + 0.016, 0.012), 0.06, 0.032, 0.085, PAL.ink, 0.012);
  }
  return {
    body: g.build(),
    arm: arm.build(),
    leg: leg?.build() ?? null,
    shoulderY: y0 + torsoH - 0.03,
    shoulderX: torsoW / 2 + 0.02,
    headY: hy + headR,
    hipX: 0.042,
    hipY: y0,
    scale: look.big ? 1.9 : kid ? 0.82 : 1,
  };
}

// ---- Coaster car -------------------------------------------------------------------

export type CarKind = 'lead' | 'mid' | 'tail';

/** A two-seat car on the rails; origin on the track centerline, +Z forward. */
export function carGeo(kind: CarKind): BufferGeometry {
  return cached(`car-${kind}`, () => {
    const g = new Geo();
    const red = PAL.car[1];
    const dark = PAL.car[3];
    const gold = PAL.gold;
    const L = 0.25;
    g.box(M(0, 0.07, 0), 0.2, 0.07, L, red, 0.03, PAL.car[0]);
    // Gold stripe down each side.
    for (const sx of [-1, 1]) g.box(M(sx * 0.101, 0.07, 0), 0.008, 0.02, L - 0.05, gold, 0.004);
    // Seat back and dash.
    g.box(M(0, 0.13, -0.095), 0.19, 0.1, 0.05, PAL.car[2], 0.02, PAL.car[1]);
    g.box(M(0, 0.12, 0.1), 0.19, 0.06, 0.045, red, 0.018);
    // Lap bar.
    g.pipe([v3(-0.085, 0.1, 0.035), v3(-0.085, 0.165, 0.035), v3(0.085, 0.165, 0.035), v3(0.085, 0.1, 0.035)], 0.011, '#e7e9f2', 6);
    // Wheels and bogie.
    g.box(M(0, 0.02, 0), 0.08, 0.03, L * 0.8, '#3a3550');
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) g.cyl(new Matrix4().makeRotationZ(Math.PI / 2).setPosition(sx * 0.05, 0.012, sz * 0.075), 0.026, 0.026, 0.03, '#2b2140', 8, '#8c96b8');
    if (kind === 'lead') {
      // Nose cone with a headlight and a number plate.
      g.sphere(v3(0, 0.08, L / 2 + 0.02), 0.1, red, 1, 0.55, 0.7, 12, 7, true);
      g.sphere(v3(0, 0.1, L / 2 + 0.085), 0.026, '#fff6c8', 1, 1, 0.6, 8, 5, true);
      g.box(M(0, 0.045, L / 2 + 0.07), 0.07, 0.03, 0.02, gold, 0.006);
    } else if (kind === 'tail') {
      g.box(new Matrix4().makeRotationX(-0.35).setPosition(0, 0.2, -0.12), 0.02, 0.11, 0.07, gold, 0.008);
      g.sphere(v3(0, 0.08, -L / 2 - 0.01), 0.08, red, 1, 0.5, 0.35, 10, 6, true);
    }
    return g.build();
  });
}

// ---- Scenery -------------------------------------------------------------------------

export interface Parts {
  matte?: Geo;
  gloss?: Geo;
  leaf?: Geo;
  cloth?: Geo;
  glow?: Geo;
  /** Tiny details (grass tufts, flowers) that draw no ink lines. */
  detail?: Geo;
  figure?: Geo;
  ground?: Geo;
  rail?: Geo;
  steel?: Geo;
}

export type Flora = 'meadow' | 'boardwalk' | 'hollow' | 'finale';

const AUTUMN = ['#e8883a', '#d9542f', '#f2b33d', '#b8472e'];
const GREEN = ['#5cb85c', '#4f9e4f', '#72c457', '#3f8a4a'];
const BLOSSOM = ['#ff9ec4', '#ffb8d6', '#f78fb3', '#ffd1e3'];
const DEAD = ['#6b5a8a', '#57497a', '#7a6a99', '#4a3d6b'];

/** A tree standing at (x, 0, z). The canopy goes to the swaying leaf batch. */
export function tree(p: Parts, x: number, z: number, seed: number, flora: Flora, size = 1): void {
  const r = rng(seed);
  const matte = (p.matte ??= new Geo());
  const leaf = (p.leaf ??= new Geo());
  if (flora === 'boardwalk' && r() < 0.8) {
    // Palm: a curved trunk and drooping fronds.
    const lean = (r() - 0.5) * 0.5;
    const pts = arc(8, (t) => v3(x + lean * t * t * 0.6, t * 0.95 * size, z + lean * 0.2 * t));
    pts.forEach((q, i) => i % 2 === 0 && matte.cyl(M(q.x, q.y + 0.03, q.z), 0.05 - i * 0.003, 0.042 - i * 0.003, 0.08, i % 4 ? '#b0855a' : '#8f6440', 7));
    const top = pts[pts.length - 1];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + r();
      const frond = arc(6, (t) => v3(top.x + Math.cos(a) * t * 0.42 * size, top.y + 0.04 + Math.sin(t * 2.3) * 0.12 - t * t * 0.25, top.z + Math.sin(a) * t * 0.42 * size));
      leaf.pipe(frond, 0.035 * size, GREEN[k % 4], 4);
    }
    leaf.sphere(top.clone().setY(top.y - 0.02), 0.05, '#8f6440', 1, 1, 1, 6, 4);
    return;
  }
  if (flora === 'hollow') {
    // Spooky pine or a bare crooked tree.
    if (r() < 0.6) {
      matte.cyl(M(x, 0.12 * size, z), 0.05, 0.04, 0.24 * size, '#4a3626', 6);
      for (let k = 0; k < 4; k++) {
        const y = (0.22 + k * 0.2) * size;
        leaf.cyl(M(x, y + 0.1 * size, z), (0.3 - k * 0.06) * size, 0.02, 0.28 * size, k % 2 ? '#3d5a4c' : '#34503f', 7);
      }
      return;
    }
    const trunk = arc(5, (t) => v3(x + Math.sin(t * 3 + seed) * 0.06, t * 0.6 * size, z));
    matte.pipe(trunk, 0.04, '#4a3626', 5);
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2;
      const b = trunk[3 + (k % 2)];
      matte.pipe([b, v3(b.x + Math.cos(a) * 0.22, b.y + 0.16, b.z + Math.sin(a) * 0.18)], 0.018, '#4a3626', 4);
    }
    leaf.blob(v3(x, 0.62 * size, z), 0.16 * size, DEAD[seed % 4], seed, 0.3);
    return;
  }
  if (r() < 0.28 && flora === 'meadow') {
    // Stacked pine.
    matte.cyl(M(x, 0.08 * size, z), 0.045, 0.04, 0.16 * size, '#7a4e2f', 6);
    for (let k = 0; k < 3; k++) {
      const y = (0.18 + k * 0.2) * size;
      leaf.cyl(M(x, y + 0.12 * size, z), (0.3 - k * 0.07) * size, 0.03, 0.3 * size, k % 2 ? '#3f8a4a' : '#2f6f45', 8);
    }
    return;
  }
  const colors = flora === 'finale' ? BLOSSOM : r() < 0.55 ? AUTUMN : GREEN;
  const h = (0.3 + r() * 0.12) * size;
  matte.cyl(M(x, h / 2, z), 0.05 * size, 0.035 * size, h, '#7a4e2f', 6);
  matte.beam(v3(x, h * 0.6, z), v3(x + 0.12 * size, h + 0.1 * size, z + 0.03), 0.03 * size, '#7a4e2f');
  const c0 = colors[Math.floor(r() * colors.length)];
  const blobs = 3 + Math.floor(r() * 2);
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + r();
    const d = k === 0 ? 0 : 0.14 * size;
    leaf.blob(
      v3(x + Math.cos(a) * d, h + (0.16 + (k === 0 ? 0.1 : r() * 0.06)) * size, z + Math.sin(a) * d * 0.8),
      (k === 0 ? 0.22 : 0.16) * size,
      k === 0 ? c0 : colors[(Math.floor(r() * 4) + k) % colors.length],
      seed * 7 + k,
      0.18,
    );
  }
}

export function rock(p: Parts, x: number, z: number, seed: number, dark = false): void {
  const r = rng(seed);
  const m = (p.matte ??= new Geo());
  const base = dark ? ['#6d6a86', '#5a5774', '#7d7a96'] : ['#b9bccd', '#a9adc0', '#9499b2'];
  m.blob(v3(x, 0.1, z), 0.2, base[0], seed, 0.2, 1.15, 0.72, 1);
  m.blob(v3(x + 0.16, 0.06, z + 0.1), 0.12, base[1], seed + 1, 0.25, 1, 0.8, 1);
  if (r() < 0.6) m.blob(v3(x - 0.18, 0.05, z + 0.08), 0.09, base[2], seed + 2, 0.25);
  if (!dark) m.blob(v3(x - 0.05, 0.19, z - 0.02), 0.07, '#72c457', seed + 3, 0.3, 1.3, 0.4, 1.3);
}

/** A pond's rim stones and lily pads; the water surface is its own mesh. */
export function pondRim(p: Parts, x: number, z: number, seed: number): void {
  const r = rng(seed);
  const m = (p.matte ??= new Geo());
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    m.blob(v3(x + Math.cos(a) * 0.4, 0.035, z + Math.sin(a) * 0.36), 0.06 + r() * 0.03, k % 3 ? '#b9bccd' : '#a9adc0', seed + k, 0.3, 1.2, 0.6, 1);
  }
  const leaf = (p.leaf ??= new Geo());
  for (let k = 0; k < 3; k++) {
    const a = r() * Math.PI * 2;
    const d = 0.12 + r() * 0.12;
    const c = v3(x + Math.cos(a) * d, 0.012, z + Math.sin(a) * d);
    leaf.cyl(M(c.x, c.y, c.z), 0.06, 0.06, 0.01, '#5cb85c', 9);
    if (k === 0) leaf.sphere(c.clone().setY(0.035), 0.025, '#ff8fb8', 1, 0.8, 1, 6, 4);
  }
  // Cattails.
  for (let k = 0; k < 3; k++) {
    const bx = x + 0.3 + k * 0.04;
    const bz = z - 0.2 + k * 0.03;
    m.beam(v3(bx, 0, bz), v3(bx, 0.24 + k * 0.03, bz), 0.012, '#4f9e4f');
    m.cyl(M(bx, 0.24 + k * 0.03, bz), 0.018, 0.018, 0.06, '#7a4e2f', 5);
  }
}

/** The snack stand: counter, striped awning and a giant corn dog on the roof. */
export function stand(p: Parts, x: number, z: number): void {
  const m = (p.matte ??= new Geo());
  const gl = (p.gloss ??= new Geo());
  const cloth = (p.cloth ??= new Geo());
  m.cube(x, 0.16, z - 0.05, 0.66, 0.32, 0.5, PAL.white, 0.02);
  m.cube(x, 0.1, z + 0.22, 0.7, 0.2, 0.08, '#e0962a', 0.02);
  m.cube(x, 0.205, z + 0.23, 0.74, 0.02, 0.14, '#a8743a');
  // Striped awning, sloping toward the front.
  for (let i = 0; i < 6; i++) {
    const x0 = x - 0.36 + i * 0.12;
    cloth.box(new Matrix4().makeRotationX(0.45).setPosition(x0 + 0.06, 0.4, z + 0.18), 0.12, 0.012, 0.3, i % 2 ? PAL.white : PAL.red);
  }
  for (let i = 0; i < 6; i++) cloth.sphere(v3(x - 0.3 + i * 0.12, 0.33, z + 0.32), 0.045, i % 2 ? PAL.white : PAL.red, 1, 0.6, 0.4, 8, 4);
  for (const sx of [-1, 1]) m.post(x + sx * 0.33, 0, z + 0.3, 0.018, 0.4, '#b83344', 6);
  m.cube(x, 0.36, z - 0.05, 0.7, 0.06, 0.52, '#b83344', 0.02);
  // The corn dog.
  gl.cyl(new Matrix4().makeRotationZ(0.25).setPosition(x - 0.02, 0.6, z - 0.08), 0.1, 0.1, 0.34, '#e0962a', 12, '#f2b33d', true);
  gl.sphere(v3(x - 0.063, 0.765, z - 0.08), 0.1, '#e0962a', 1, 0.55, 1, 12, 6, true);
  m.beam(v3(x + 0.03, 0.39, z - 0.08), v3(x + 0.05, 0.46, z - 0.08), 0.03, '#e8d9b0');
  gl.pipe(arc(8, (t) => v3(x - 0.06 + t * 0.07, 0.72 - t * 0.2, z + 0.02 + Math.sin(t * 9) * 0.015)), 0.014, '#e8484f', 5);
}

export function lamp(p: Parts, x: number, z: number): Vector3 {
  const m = (p.matte ??= new Geo());
  const glow = (p.glow ??= new Geo());
  m.post(x, 0, z, 0.05, 0.05, '#2b2140', 8);
  m.post(x, 0.05, z, 0.02, 0.62, '#3a3550', 6);
  m.cyl(M(x, 0.73, z), 0.07, 0.03, 0.05, '#2b2140', 8);
  glow.sphere(v3(x, 0.68, z), 0.055, '#fff1b0', 1, 1.1, 1, 10, 7, true);
  m.cyl(M(x, 0.62, z), 0.03, 0.06, 0.03, '#2b2140', 8);
  return v3(x, 0.68, z);
}

export function bench(p: Parts, x: number, z: number, rot = 0): void {
  const m = (p.matte ??= new Geo());
  const base = new Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  const at = (lx: number, ly: number, lz: number) => new Matrix4().copy(base).multiply(M(lx, ly, lz));
  m.box(at(0, 0.1, 0), 0.4, 0.025, 0.12, '#c0703a', 0.008);
  m.box(new Matrix4().copy(at(0, 0.17, -0.06)).multiply(RX(-0.25)), 0.4, 0.08, 0.02, '#c0703a', 0.008);
  for (const sx of [-1, 1]) m.box(at(sx * 0.17, 0.05, 0), 0.025, 0.1, 0.12, '#2b2140');
}

export function hedge(p: Parts, x: number, z: number, w: number, d: number, seed: number, flowers: string[]): void {
  const leaf = (p.leaf ??= new Geo());
  const r = rng(seed);
  const n = Math.max(1, Math.round(w / 0.18));
  for (let i = 0; i < n; i++) {
    const cx = x - w / 2 + (i + 0.5) * (w / n);
    leaf.blob(v3(cx, 0.09, z), 0.12, GREEN[i % 4], seed + i, 0.18, 1.1, 0.8, d / 0.24);
    if (flowers.length && r() < 0.8) leaf.sphere(v3(cx + (r() - 0.5) * 0.08, 0.18, z + d * 0.35), 0.022, flowers[i % flowers.length], 1, 1, 1, 6, 4);
  }
}

export function flowerBed(p: Parts, x: number, z: number, w: number, d: number, seed: number, colors: string[]): void {
  const m = (p.matte ??= new Geo());
  const leaf = (p.leaf ??= new Geo());
  const r = rng(seed);
  m.cube(x, 0.035, z, w, 0.07, d, '#a88d66', 0.015, '#8f6440');
  for (let i = 0; i < w * d * 90; i++) {
    const fx = x + (r() - 0.5) * (w - 0.06);
    const fz = z + (r() - 0.5) * (d - 0.06);
    leaf.beam(v3(fx, 0.07, fz), v3(fx, 0.12, fz), 0.01, '#4f9e4f');
    leaf.sphere(v3(fx, 0.125, fz), 0.02, colors[i % colors.length], 1, 0.8, 1, 6, 4);
  }
}

/** A queue barrier: posts with a rope between them. */
export function rope(p: Parts, a: Vector3, b: Vector3, color: string): void {
  const m = (p.matte ??= new Geo());
  for (const q of [a, b]) {
    m.post(q.x, 0, q.z, 0.03, 0.02, '#8c96b8', 8);
    m.post(q.x, 0.02, q.z, 0.012, 0.16, '#d9dbe6', 6);
    m.sphere(v3(q.x, 0.19, q.z), 0.02, PAL.gold, 1, 1, 1, 6, 4, true);
  }
  const sag = arc(8, (t) => a.clone().lerp(b, t).setY(0.16 - Math.sin(Math.PI * t) * 0.04));
  m.pipe(sag, 0.009, color, 4);
}

export { M, RX, RY, RZ, arc };

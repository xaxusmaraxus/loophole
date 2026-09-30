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
//
// Merge tiles are soft clay plinths: a pillowy body of stacked rolls around a
// rounded square, a raised rim framing a recessed lid, tier pips on the front,
// and a chunky little clay model of the coaster element standing on the lid.
// Higher tiers build up: a wider foot, belts, gold trim (Loop on), corner
// studs, gems (Corkscrew) and pearl, rubies and a crown (Mega Loop).

type Ramp4 = readonly [string, string, string, string];
const GOLD: Ramp4 = ['#fff1a8', '#ffc93a', '#e0932a', '#9a5a1c'];
const PEARL: Ramp4 = ['#ffffff', '#fff8ec', '#eadcc4', '#b8a58a'];
const RUBY = '#ff3f6e';
const AQUA = '#4fe0e8';
const HW = CRATE_W / 2;
const CORNER_R = 0.15;

function arc(n: number, f: (t: number) => Vector3): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) out.push(f(i / n));
  return out;
}

/** Catmull-Rom through control points, `per` samples per span. */
function spline(ctrl: Vector3[], per: number): Vector3[] {
  const out: Vector3[] = [];
  const P = (i: number) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let s = 0; s < ctrl.length - 1; s++)
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const [p0, p1, p2, p3] = [P(s - 1), P(s), P(s + 1), P(s + 2)];
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push(v3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z)));
    }
  out.push(ctrl[ctrl.length - 1].clone());
  return out;
}

/** A flat n-pointed star (or sparkle) facing +Z, extruded by depth. */
function star(g: Geo, c: Vector3, r: number, color: Col, depth = 0.04, points = 5, inner = 0.45): void {
  const n = points * 2;
  const outer: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    outer.push(v3(Math.cos(a) * rr, -Math.sin(a) * rr, 0));
  }
  const f = outer.map((p) => p.clone().add(c).setZ(c.z + depth / 2));
  const b = outer.map((p) => p.clone().add(c).setZ(c.z - depth / 2));
  const cf = c.clone().setZ(c.z + depth * 0.9);
  const cb = c.clone().setZ(c.z - depth / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    g.tri(cf, f[i], f[j], color, cb.clone().setZ(c.z - 1));
    g.tri(cb, b[i], b[j], shade(color, -0.1), cf.clone().setZ(c.z + 1));
    g.quad(f[i], f[j], b[j], b[i], shade(color, -0.05), c);
  }
}

/** A faceted clay gem (a stretched octahedron) — the crease keeps its facets. */
function gem(g: Geo, c: Vector3, r: number, color: Col): void {
  g.sphere(c, r, color, 1, 1.25, 1, 4, 2, false);
  g.sphere(c.clone().add(v3(-r * 0.25, r * 0.45, r * 0.3)), r * 0.22, shade(color, 0.7), 1, 1, 1, 4, 2);
}

// Tile body: a profile of (inset, y) points swept around a rounded square.
interface PP {
  i: number;
  y: number;
  c: Col;
}

/** Ring around the rounded square, shrunk by `inset`; points and outward directions. */
function ring(inset: number, y: number, n: number): { p: Vector3[]; d: Vector3[] } {
  const rad = Math.max(CORNER_R - inset, 0.012);
  const c = HW - inset - rad;
  const p: Vector3[] = [];
  const d: Vector3[] = [];
  const corners = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  for (let q = 0; q < 4; q++) {
    const [sx, sz] = corners[q];
    for (let k = 0; k <= n; k++) {
      const a = ((q + k / n) * Math.PI) / 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      p.push(v3(sx * c + dx * rad, y, sz * c + dz * rad));
      d.push(v3(dx, 0, dz));
    }
  }
  return { p, d };
}

function lathe(g: Geo, prof: PP[], cap: Col, n = 5): void {
  const rings = prof.map((pp) => ring(pp.i, pp.y, n));
  const N = rings[0].p.length;
  const up = v3(0, 1, 0);
  for (let s = 0; s < prof.length - 1; s++) {
    const a = rings[s];
    const b = rings[s + 1];
    const nr = prof[s + 1].y - prof[s].y;
    const ny = prof[s + 1].i - prof[s].i;
    if (Math.abs(nr) + Math.abs(ny) < 1e-6) continue;
    const nrm = (k: number) => a.d[k].clone().multiplyScalar(nr).addScaledVector(up, ny).normalize();
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      const n1 = nrm(k);
      const n2 = nrm(k2);
      g.triSmooth(a.p[k], a.p[k2], b.p[k2], n1, n2, n2, prof[s].c);
      g.triSmooth(a.p[k], b.p[k2], b.p[k], n1, n2, n1, prof[s].c);
    }
  }
  const last = rings[rings.length - 1].p;
  const y = prof[prof.length - 1].y;
  const c = v3(0, y, 0);
  const below = v3(0, y - 1, 0);
  for (let k = 0; k < N; k++) g.tri(c, last[k], last[(k + 1) % N], cap, below);
}

class Profile {
  pts: PP[] = [];
  private push(i: number, y: number, c: Col): void {
    const l = this.pts[this.pts.length - 1];
    if (l && Math.abs(l.i - i) < 1e-5 && Math.abs(l.y - y) < 1e-5) {
      l.c = c;
      return;
    }
    this.pts.push({ i, y, c });
  }
  /** A pillowy band from y0 to y1: `inset` at its fattest, `bulge` more at the seams. */
  roll(y0: number, y1: number, inset: number, bulge: number, c: Col, steps = 6): this {
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      this.push(inset + bulge * (1 - Math.sin(Math.PI * u)), y0 + ((y1 - y0) * (1 - Math.cos(Math.PI * u))) / 2, c);
    }
    return this;
  }
  /** The raised lid rim: a half torus (tube center inset iC, radius rr) down to the lid. */
  rim(iC: number, rr: number, c: Col, field: Col): this {
    const yc = CRATE_H + 0.006;
    for (let s = 0; s <= 9; s++) {
      const a = (-70 + (250 * s) / 9) * (Math.PI / 180);
      this.push(iC - rr * Math.cos(a), yc + rr * Math.sin(a), c);
    }
    // The lid itself: a very soft cushion dome inside the rim.
    this.push(iC + rr + 0.006, CRATE_H, field);
    this.push(iC + rr + 0.05, CRATE_H + 0.007, field);
    this.push(0.24, CRATE_H + 0.011, field);
    return this;
  }
  /** The profile's inset at height y (for things stuck on the sides). */
  insetAt(y: number): number {
    const p = this.pts;
    for (let k = 0; k < p.length - 1; k++)
      if (p[k].y <= y && p[k + 1].y >= y && p[k + 1].y > p[k].y) return p[k].i + ((p[k + 1].i - p[k].i) * (y - p[k].y)) / (p[k + 1].y - p[k].y);
    return 0;
  }
}

/** Rim corner point (for studs), at the top of a rim of center inset iC, radius rr. */
function rimCorners(iC: number, rr: number): Vector3[] {
  const rad = Math.max(CORNER_R - iC, 0.012);
  const c = HW - iC - rad + rad * Math.SQRT1_2;
  const y = CRATE_H + 0.006 + rr;
  return [v3(c, y, c), v3(-c, y, c), v3(-c, y, -c), v3(c, y, -c)];
}

/** Tier pips: little pressed clay dots across the front face at height y. */
function pips(g: Geo, prof: Profile, n: number, y: number, color: Col): void {
  const z = HW - prof.insetAt(y);
  const sp = n > 5 ? 0.07 : 0.078;
  for (let k = 0; k < n; k++) {
    const x = (k - (n - 1) / 2) * sp;
    g.sphere(v3(x, y, z - 0.004), 0.025, color, 1, 1, 0.55, 8, 5, true);
  }
}

// Track models: a chunky clay ribbon with two rails, following a path with an
// "up" hint per point (toward the loop center, into the corkscrew, and so on).

interface Frames {
  t: Vector3[];
  l: Vector3[];
  u: Vector3[];
}

function frames(pts: Vector3[], upHint: (i: number) => Vector3): Frames {
  const t: Vector3[] = [];
  const l: Vector3[] = [];
  const u: Vector3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tt = b.clone().sub(a).normalize();
    const h = upHint(i);
    const uu = h.clone().addScaledVector(tt, -h.dot(tt)).normalize();
    t.push(tt);
    u.push(uu);
    l.push(tt.clone().cross(uu).normalize());
  }
  return { t, l, u };
}

const RIB_W = 0.058;
const RIB_T = 0.025;

function track(g: Geo, pts: Vector3[], upHint: (i: number) => Vector3, ribbon: Col, rail: Col): Frames {
  const F = frames(pts, upHint);
  const sides = 10;
  const rings: Vector3[][] = [];
  const nrms: Vector3[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const ring: Vector3[] = [];
    const nr: Vector3[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (Math.PI * 2 * k) / sides;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ring.push(pts[i].clone().addScaledVector(F.l[i], c * RIB_W).addScaledVector(F.u[i], s * RIB_T));
      nr.push(F.l[i].clone().multiplyScalar(c / RIB_W).addScaledVector(F.u[i], s / RIB_T).normalize());
    }
    rings.push(ring);
    nrms.push(nr);
  }
  for (let i = 0; i < pts.length - 1; i++)
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      g.triSmooth(rings[i][k], rings[i][k2], rings[i + 1][k2], nrms[i][k], nrms[i][k2], nrms[i + 1][k2], ribbon);
      g.triSmooth(rings[i][k], rings[i + 1][k2], rings[i + 1][k], nrms[i][k], nrms[i + 1][k2], nrms[i + 1][k], ribbon);
    }
  // Rounded ends.
  for (const i of [0, pts.length - 1]) {
    const m = new Matrix4().makeBasis(F.l[i], F.u[i], F.t[i]);
    g.sphere(pts[i], 1, ribbon, RIB_W, RIB_T, RIB_T * 1.4, 10, 5, true, m);
  }
  // Rails riding on the ribbon's edges.
  for (const side of [-1, 1]) {
    const rp = pts.map((p, i) => p.clone().addScaledVector(F.l[i], side * RIB_W * 0.72).addScaledVector(F.u[i], RIB_T * 0.85));
    g.pipe(rp, 0.014, rail, 6);
    g.sphere(rp[0], 0.014, rail, 1, 1, 1, 6, 3, true);
    g.sphere(rp[rp.length - 1], 0.014, rail, 1, 1, 1, 6, 3, true);
  }
  return F;
}

/** Stubby clay supports from the lid up to the ribbon at the given path indices. */
function supports(g: Geo, pts: Vector3[], at: number[], color: Col): void {
  for (const i of at) {
    const p = pts[i];
    const h = p.y - RIB_T * 0.6 - CRATE_H;
    if (h < 0.01) continue;
    g.post(p.x, CRATE_H, p.z, 0.02, h, color, 8);
    g.sphere(v3(p.x, CRATE_H + 0.004, p.z), 0.032, color, 1, 0.35, 1, 8, 3, true);
  }
}

const UP = () => v3(0, 1, 0);

/** A loop with run-in and run-out, offset sideways so the lanes clear each other. */
function loopPath(R: number, y0: number, lead: number): { pts: Vector3[]; hint: (i: number) => Vector3; c: Vector3 } {
  const pts: Vector3[] = [];
  const hints: Vector3[] = [];
  const zs = (u: number) => -0.065 + 0.13 * u;
  const cy = y0 + R;
  for (let k = 0; k < 5; k++) {
    pts.push(v3(-lead + (lead * k) / 5, y0, zs(0)));
    hints.push(v3(0, 1, 0));
  }
  const n = 36;
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const u = (1 - Math.cos((k / n) * Math.PI)) / 2;
    const p = v3(Math.sin(a) * R, cy - Math.cos(a) * R, zs(u));
    pts.push(p);
    hints.push(v3(0, cy, p.z).sub(p));
  }
  for (let k = 1; k <= 5; k++) {
    pts.push(v3((lead * k) / 5, y0, zs(1)));
    hints.push(v3(0, 1, 0));
  }
  return { pts, hint: (i) => hints[i], c: v3(0, cy, 0) };
}

function tileIcon(g: Geo, tier: number, r: Ramp4): void {
  const top = CRATE_H;
  const rib = tier === 7 ? PEARL[0] : PAL.white;
  const rail = tier === 7 ? PAL.red : r[2];
  const leg = shade(PAL.white, -0.12);
  switch (tier) {
    case 1: {
      const pts = arc(22, (t) => v3(-0.25 + t * 0.5, top + 0.055 + Math.sin(Math.PI * t) ** 2 * 0.11, 0));
      track(g, pts, UP, rib, rail);
      supports(g, pts, [6, 16], leg);
      break;
    }
    case 2: {
      const pts = arc(28, (t) => v3(-0.26 + t * 0.52, top + 0.055 + Math.sin(Math.PI * t) ** 2 * 0.19, 0));
      track(g, pts, UP, rib, rail);
      supports(g, pts, [8, 14, 20], leg);
      break;
    }
    case 3: {
      const y0 = top + 0.055;
      const pts = spline([v3(-0.27, y0, 0), v3(-0.19, y0 + 0.02, 0), v3(0.02, y0 + 0.2, 0), v3(0.08, y0 + 0.2, 0), v3(0.17, y0, 0), v3(0.27, y0, 0)], 7);
      const F = track(g, pts, UP, rib, rail);
      supports(g, pts, [7, 12, 17, 22, 27], leg);
      // Lift chain: dark ticks up the climb.
      for (let i = 8; i < 20; i += 2) {
        const c = pts[i].clone().addScaledVector(F.u[i], RIB_T * 0.9);
        g.sphere(c, 0.013, r[3], 1.1, 0.7, 1.6, 6, 3, true);
      }
      break;
    }
    case 4: {
      const n = 64;
      const pts = arc(n, (t) => {
        const a = -Math.PI / 2 + t * Math.PI * 2 * 1.75;
        return v3(Math.cos(a) * 0.17, top + 0.06 + t * 0.19, Math.sin(a) * 0.15);
      });
      track(g, pts, (i) => v3(-pts[i].x, 0, -pts[i].z).normalize().multiplyScalar(0.7).add(v3(0, 1, 0)), rib, rail);
      g.post(0, top, 0, 0.038, 0.24, r[2], 10);
      g.sphere(v3(0, top + 0.25, 0), 0.05, r[0], 1, 1, 1, 10, 6, true);
      g.sphere(v3(0, top + 0.004, 0), 0.06, r[2], 1, 0.3, 1, 10, 3, true);
      supports(g, pts, [0], leg);
      break;
    }
    case 5: {
      const L = loopPath(0.125, top + 0.05, 0.27);
      track(g, L.pts, L.hint, rib, rail);
      supports(g, L.pts, [1, 44], leg);
      break;
    }
    case 6: {
      const R = 0.1;
      const yc = top + 0.055 + R;
      const off = (t: number) => {
        const s = Math.min(1, Math.max(0, (t - 0.14) / 0.72));
        const a = Math.PI * 2 * s * s * (3 - 2 * s);
        return v3(0, -Math.cos(a) * R, Math.sin(a) * R);
      };
      const n = 56;
      const pts = arc(n, (t) => v3(-0.27 + t * 0.54, yc, 0).add(off(t)));
      track(g, pts, (i) => off(i / n).negate(), rib, rail);
      supports(g, pts, [3, n - 3], leg);
      break;
    }
    case 7: {
      const L = loopPath(0.14, top + 0.05, 0.27);
      track(g, L.pts, L.hint, rib, rail);
      supports(g, L.pts, [1, 44], leg);
      star(g, L.c, 0.085, RUBY, 0.05);
      break;
    }
  }
}

/** A little clay tiara standing on the front rim, facing the camera. */
function crown(g: Geo, c: Vector3): void {
  g.box(M(c.x, c.y + 0.018, c.z), 0.2, 0.036, 0.04, GOLD[1], 0.014, GOLD[0]);
  for (let k = -2; k <= 2; k++) {
    const x = c.x + k * 0.045;
    const h = [0.05, 0.065, 0.085, 0.065, 0.05][k + 2];
    const base = v3(x, c.y + 0.03, c.z);
    const tip = v3(x + k * 0.006, c.y + 0.03 + h, c.z);
    g.cyl(new Matrix4().makeTranslation((base.x + tip.x) / 2, (base.y + tip.y) / 2, c.z).multiply(RZ(-k * 0.12)), 0.022, 0.006, h, GOLD[1], 6);
    g.sphere(tip, k === 0 ? 0.02 : 0.015, k === 0 ? RUBY : PEARL[0], 1, 1, 1, 8, 5, true);
  }
  gem(g, v3(c.x, c.y + 0.018, c.z + 0.026), 0.02, RUBY);
}

export function crateGeo(tier: number): BufferGeometry {
  return cached(`crate${tier}`, () => {
    const r = TIER_RAMPS[tier] as Ramp4;
    const g = new Geo();
    const body = r[1];
    const dark = r[2];
    const light = r[0];
    const field = shade(r[1], 0.04);
    const p = new Profile();
    const trim = tier >= 7 ? PEARL : tier >= 5 ? GOLD : null;
    let pipY = 0.165;
    let rimI = 0.06;
    const rimR = 0.026;
    switch (tier) {
      case 1:
        p.roll(0, 0.275, 0.02, 0.03, body, 10);
        break;
      case 2:
        p.roll(0, 0.085, 0.004, 0.022, dark, 5).roll(0.085, 0.275, 0.02, 0.022, body, 8);
        break;
      case 3:
        p.roll(0, 0.085, -0.012, 0.022, dark, 5).roll(0.085, 0.275, 0.03, 0.02, body, 8);
        rimI = 0.07;
        break;
      case 4:
        p.roll(0, 0.08, -0.012, 0.022, dark, 5)
          .roll(0.08, 0.13, 0.032, 0.014, body, 4)
          .roll(0.13, 0.2, 0.024, 0.012, dark, 5)
          .roll(0.2, 0.275, 0.032, 0.016, body, 5);
        pipY = 0.165;
        rimI = 0.07;
        break;
      default: {
        const t = trim!;
        p.roll(0, 0.055, -0.015, 0.02, dark, 4)
          .roll(0.055, 0.1, tier >= 6 ? 0.008 : 0.018, 0.016, t[1], 4)
          .roll(0.1, 0.135, 0.036, 0.012, body, 3)
          .roll(0.135, 0.205, 0.028, 0.012, tier >= 7 ? PEARL[1] : dark, 5)
          .roll(0.205, 0.275, 0.036, 0.014, body, 5);
        pipY = 0.17;
        rimI = 0.075;
      }
    }
    p.rim(rimI, rimR, trim ? trim[1] : light, field);
    lathe(g, p.pts, field);
    pips(g, p, tier, pipY, tier >= 7 ? RUBY : tier >= 5 ? GOLD[0] : PAL.white);
    // Corner studs: clay balls, gold balls, then gems in gold settings.
    const cs = rimCorners(rimI, rimR);
    if (tier === 4) for (const c of cs) g.sphere(c, 0.034, light, 1, 0.85, 1, 10, 6, true);
    if (tier === 5) for (const c of cs) g.sphere(c, 0.038, GOLD[1], 1, 0.85, 1, 10, 6, true);
    if (tier >= 6)
      for (const c of cs) {
        g.sphere(c, 0.042, trim![1], 1, 0.5, 1, 10, 4, true);
        gem(g, c.clone().setY(c.y + 0.035), 0.036, tier >= 7 ? RUBY : AQUA);
      }
    if (tier >= 7) crown(g, v3(0, CRATE_H + 0.006 + rimR, HW - rimI));
    tileIcon(g, tier, r);
    return g.build();
  });
}

export function mysteryGeo(): BufferGeometry {
  return cached('mystery', () => {
    const r = MYSTERY;
    const g = new Geo();
    const p = new Profile().roll(0, 0.085, -0.012, 0.022, r[2], 5).roll(0.085, 0.275, 0.03, 0.02, r[1], 8).rim(0.07, 0.03, r[0], shade(r[1], -0.08));
    lathe(g, p.pts, shade(r[1], -0.08));
    // A chunky "?" standing on the lid, tipped back a little toward the camera.
    const top = CRATE_H;
    const qc = '#f4ecff';
    const from = g.count;
    const qs = spline(
      [v3(-0.08, 0.2, 0), v3(-0.062, 0.258, 0), v3(0, 0.285, 0), v3(0.064, 0.26, 0), v3(0.078, 0.207, 0), v3(0.038, 0.162, 0), v3(0.006, 0.135, 0), v3(0, 0.1, 0)],
      4,
    );
    g.pipe(qs, 0.04, qc, 10);
    g.sphere(qs[0], 0.04, qc, 1, 1, 1, 10, 6, true);
    g.sphere(qs[qs.length - 1], 0.04, qc, 1, 1, 1, 10, 6, true);
    g.sphere(v3(0, 0.035, 0), 0.042, qc, 1, 1, 1, 10, 6, true);
    g.transform(M(0, top + 0.005, 0).multiply(RX(-0.3)), from);
    // Sparkles.
    star(g, v3(-0.22, top + 0.17, 0.08), 0.05, '#fff3b0', 0.025, 4, 0.3);
    star(g, v3(0.23, top + 0.24, -0.06), 0.04, '#fff3b0', 0.025, 4, 0.3);
    star(g, v3(0.2, top + 0.07, 0.17), 0.032, '#ffd6f4', 0.02, 4, 0.3);
    g.sphere(v3(-0.2, top + 0.05, -0.15), 0.018, '#fff3b0', 1, 1, 1, 6, 4, true);
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

/**
 * Clay expressions. In line: smile, grin (excited), cocky, nervous, meh.
 * On the ride: joy (laughing, hands up), scream, terror, sick.
 */
export type Face = 'smile' | 'grin' | 'cocky' | 'nervous' | 'meh' | 'joy' | 'scream' | 'terror' | 'sick';

function lookKey(l: Look): string {
  return [l.skin, l.hair, l.hairStyle, l.shirt, l.pants, l.accessory, l.small ? 1 : 0, l.big ? 1 : 0].join('.');
}

/** A chibi guest, feet at the origin. `seated` drops the legs (for riders). */
export function personGeo(look: Look, face: Face, seated = false): PersonGeo {
  return cached(`p${lookKey(look)}:${face}:${seated ? 1 : 0}`, () => buildPerson(look, face, seated));
}

/** A little clay sausage along a few points, with rounded ends (brows, lips, lids). */
function sausage(g: Geo, pts: Vector3[], r: number, col: Col): void {
  g.pipe(pts, r, col, 6);
  g.sphere(pts[0], r, col, 1, 1, 1, 6, 4, true);
  g.sphere(pts[pts.length - 1], r, col, 1, 1, 1, 6, 4, true);
}

/** A quadratic curve through three points, sampled. */
function curve(a: Vector3, b: Vector3, c: Vector3, n = 6): Vector3[] {
  return arc(n, (t) => a.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(b, 2 * (1 - t) * t).addScaledVector(c, t * t));
}

const SHOES = ['#2b2140', '#f0584e', '#fbf8f0', '#45a8e0', '#72c457', '#ffd23f'];

function buildPerson(look: Look, face: Face, seated: boolean): PersonGeo {
  const g = new Geo();
  const ghost = look.pants === 4;
  const skin = face === 'sick' ? '#a6e05a' : SKINS[look.skin];
  const shirt = SHIRTS[look.shirt];
  const pants = PANTS[look.pants];
  const hair = HAIRS[look.hair];
  const kid = look.small;
  const belly = look.big ? 1.3 : 1;
  const legH = kid ? 0.07 : 0.095;
  const torsoH = kid ? 0.105 : 0.135;
  const torsoW = (kid ? 0.145 : 0.165) * belly;
  const headR = kid ? 0.125 : 0.116;
  const y0 = seated ? 0 : legH;
  // Body: a soft clay bean (shirt) over a rounder bottom (trousers).
  if (ghost) {
    g.sphere(v3(0, y0 + torsoH * 0.45, 0), 0.085, pants, 1.05, 1.15, 0.9, 12, 8, true);
    for (let k = 0; k < 4; k++) g.sphere(v3(-0.045 + k * 0.03, y0 - 0.02, 0.01), 0.022, pants, 1, 1.3, 1, 6, 4, true);
  } else {
    g.sphere(v3(0, y0 + torsoH * 0.56, 0), torsoH * 0.62, shirt, (torsoW / torsoH) * 0.82, 0.95, 0.8 * belly, 14, 9, true);
    g.sphere(v3(0, y0 + torsoH * 0.18, 0), torsoH * 0.5, pants, (torsoW / torsoH) * 0.95, 0.72, 0.82 * belly, 12, 7, true);
    // A collar and a button: little tells that it's a costume, not a blob.
    g.sphere(v3(0, y0 + torsoH * 0.98, 0.0), torsoW * 0.34, shade(shirt, 0.12), 1, 0.35, 0.9, 10, 5, true);
    if (look.big) g.sphere(v3(0, y0 + torsoH * 0.55, 0.07 * belly), 0.018, PAL.gold, 1, 1, 0.6, 8, 5, true);
  }
  const hy = y0 + torsoH + headR * 0.86;
  // Everything on the head is tilted back afterwards, so faces look up at the camera.
  const headFrom = g.count;
  g.sphere(v3(0, hy, 0), headR, skin, 1.08, 0.98, 1, 16, 10, true);
  // Ears.
  for (const sx of [-1, 1]) g.sphere(v3(sx * headR * 1.02, hy - 0.004, -0.004), 0.024, skin, 0.6, 1, 0.9, 8, 5, true);
  const fz = headR * 0.93;
  const eyeY = hy + 0.008;
  const eyeX = headR * 0.4;
  const eyeR = kid ? 0.034 : 0.031;
  const ink = '#1a1226';
  const brow = look.hairStyle === 'bald' || look.hairStyle === 'cap' ? shade(skin, -0.35) : shade(hair, -0.15);
  const hash = (lookKey(look).length * 7919 + look.skin * 31 + look.shirt * 7) % 5;
  const gaze = [[0, 0.004], [0.004, 0.005], [-0.004, 0.005], [0.003, 0.002], [-0.002, 0.006]][hash];
  // Eyes: googly clay balls. Squeezed shut (^ ^) when laughing, wide with pin pupils in terror.
  const eye = (sx: number) => {
    const ex = sx * eyeX;
    const ez = fz - 0.004;
    if (face === 'joy') {
      sausage(g, curve(v3(ex - 0.022, eyeY - 0.004, ez + 0.02), v3(ex, eyeY + 0.02, ez + 0.026), v3(ex + 0.022, eyeY - 0.004, ez + 0.02)), 0.0065, ink);
      return;
    }
    const big = face === 'terror' || face === 'scream' ? 1.22 : face === 'grin' ? 1.08 : 1;
    g.sphere(v3(ex, eyeY + 0.006, ez), eyeR * big, '#fbf8f0', 1, 1.1, 0.75, 12, 8, true);
    const pin = face === 'terror' || face === 'scream';
    const pr = pin ? 0.006 : face === 'nervous' ? 0.009 : 0.0135;
    const shy = face === 'nervous' ? [sx > 0 ? 0.012 : 0.012, -0.004] : face === 'cocky' ? [0.006, 0] : pin ? [sx * 0.002, 0.002] : gaze;
    const pz = ez + eyeR * big * 0.74;
    g.sphere(v3(ex + shy[0], eyeY + 0.006 + shy[1], pz), pr, ink, 1, 1, 0.5, 10, 6, true);
    if (!pin) g.sphere(v3(ex + shy[0] + 0.005, eyeY + 0.012 + shy[1], pz + 0.003), 0.0038, '#ffffff', 1, 1, 0.5, 6, 4, true);
    // Lids: heavy when meh or sick, one lazy lid when cocky, pushed up by the cheeks when grinning.
    const lid = (drop: number) => g.sphere(v3(ex, eyeY + 0.006 + eyeR * (1 - drop) * 0.9, ez + 0.002), eyeR * big * 1.1, skin, 1, drop, 0.8, 12, 6, true);
    if (face === 'meh' || face === 'sick') lid(0.7);
    else if (face === 'cocky' && sx < 0) lid(0.6);
    if (face === 'grin' || face === 'smile')
      g.sphere(v3(ex, eyeY - eyeR * 0.95, ez + 0.004), eyeR * 1.05, skin, 1.1, face === 'grin' ? 0.55 : 0.35, 0.8, 10, 5, true);
  };
  if (look.accessory === 'shades') {
    g.box(M(0, eyeY + 0.008, fz + 0.012), headR * 1.7, 0.05, 0.024, PAL.ink, 0.014);
    g.box(M(-headR * 0.3, eyeY + 0.018, fz + 0.026), 0.02, 0.008, 0.004, '#8c96b8', 0.002);
  } else {
    for (const sx of [-1, 1]) eye(sx);
    if (look.accessory === 'glasses')
      for (const sx of [-1, 1]) {
        const ring = arc(14, (t) => v3(sx * eyeX + Math.cos(t * Math.PI * 2) * 0.038, eyeY + 0.006 + Math.sin(t * Math.PI * 2) * 0.038, fz + 0.02));
        g.pipe(ring.slice(0, 14), 0.0055, '#e8e8f4', 5, true);
      }
  }
  // Eyebrows: thick clay sausages, the loudest part of the expression.
  // [inner height, outer height] above the eye, per side (left, right).
  const B: Record<Face, [[number, number], [number, number]]> = {
    smile: [[0.01, 0.006], [0.01, 0.006]],
    grin: [[0.02, 0.012], [0.02, 0.012]],
    cocky: [[0.0, 0.002], [0.024, 0.03]],
    nervous: [[0.022, -0.002], [0.022, -0.002]],
    meh: [[0.002, 0.002], [0.002, 0.002]],
    joy: [[0.026, 0.016], [0.026, 0.016]],
    scream: [[0.034, 0.022], [0.034, 0.022]],
    terror: [[0.038, 0.012], [0.038, 0.012]],
    sick: [[0.016, -0.004], [0.016, -0.004]],
  };
  if (look.accessory !== 'shades' || face === 'scream' || face === 'terror')
    B[face].forEach(([inner, outer], k) => {
      const sx = k === 0 ? -1 : 1;
      const base = eyeY + eyeR * 1.05 + 0.012;
      const a = v3(sx * eyeX * 0.35, base + inner, fz + 0.006);
      const c = v3(sx * eyeX * 1.45, base + outer - 0.004, fz - 0.018);
      const b = a.clone().lerp(c, 0.5).add(v3(0, 0.008, 0.006));
      sausage(g, curve(a, b, c, 5), look.big ? 0.011 : 0.0085, brow);
    });
  // A big clay nose.
  g.sphere(v3(0, hy - 0.014, fz + 0.008), 0.02, shade(skin, -0.06), 1.1, 0.9, 0.9, 8, 6, true);
  // Cheeks: rosy, green when sick, puffed out when about to blow.
  const cheek = face === 'sick' ? '#7fb83e' : '#ff8fa3';
  for (const sx of [-1, 1]) g.sphere(v3(sx * headR * 0.64, hy - 0.03, fz * 0.84), face === 'sick' ? 0.03 : 0.02, cheek, 1, 0.75, 0.45, 8, 5, true);
  // Mouths.
  const my = hy - 0.05;
  const mz = fz * 0.95;
  const dark = '#4a1426';
  const teeth = '#fbf8f0';
  const tongue = '#ff6b8a';
  switch (face) {
    case 'smile':
      g.sphere(v3(0, my + 0.006, mz), 0.03, dark, 1.5, 0.55, 0.5, 12, 6, true);
      g.box(M(0, my + 0.014, mz + 0.012), 0.05, 0.009, 0.008, teeth, 0.002);
      break;
    case 'grin':
      // Ear-to-ear, all teeth.
      g.sphere(v3(0, my + 0.004, mz), 0.034, dark, 1.9, 0.75, 0.5, 14, 7, true);
      g.box(M(0, my + 0.014, mz + 0.014), 0.074, 0.014, 0.008, teeth, 0.003);
      g.sphere(v3(0, my - 0.01, mz + 0.01), 0.014, tongue, 1.6, 0.6, 0.5, 8, 5, true);
      break;
    case 'joy':
      // A big laughing D.
      g.sphere(v3(0, my - 0.004, mz), 0.038, dark, 1.45, 1.05, 0.55, 14, 8, true);
      g.box(M(0, my + 0.022, mz + 0.016), 0.06, 0.012, 0.008, teeth, 0.003);
      g.sphere(v3(0, my - 0.022, mz + 0.012), 0.018, tongue, 1.4, 0.7, 0.5, 8, 5, true);
      break;
    case 'cocky': {
      // A lopsided smirk.
      sausage(g, curve(v3(-0.03, my + 0.004, mz + 0.008), v3(0.004, my - 0.006, mz + 0.012), v3(0.036, my + 0.018, mz + 0.004)), 0.0065, dark);
      g.sphere(v3(0.038, my + 0.02, mz), 0.008, shade(skin, -0.12), 1, 1, 0.6, 6, 4, true);
      break;
    }
    case 'nervous': {
      // Gritted teeth: a grimace.
      g.box(M(0, my + 0.004, mz + 0.006), 0.068, 0.026, 0.014, teeth, 0.008);
      g.box(M(0, my + 0.004, mz + 0.0125), 0.066, 0.0035, 0.004, '#c9c2d6', 0.001);
      for (const x of [-0.022, 0, 0.022]) g.box(M(x, my + 0.004, mz + 0.0125), 0.0035, 0.022, 0.004, '#c9c2d6', 0.001);
      // And a bead of sweat.
      g.sphere(v3(headR * 0.78, hy + 0.04, fz * 0.55), 0.014, '#9fd8ff', 0.8, 1.35, 0.8, 8, 6, true);
      break;
    }
    case 'meh':
      sausage(g, [v3(-0.02, my + 0.004, mz + 0.008), v3(0.02, my + 0.001, mz + 0.008)], 0.005, dark);
      break;
    case 'scream':
      g.sphere(v3(0, my - 0.006, mz), 0.034, dark, 1.1, 1.35, 0.5, 12, 8, true);
      g.sphere(v3(0, my - 0.02, mz + 0.01), 0.015, tongue, 1.2, 0.6, 0.5, 8, 5, true);
      g.sphere(v3(0, my + 0.024, mz + 0.004), 0.006, tongue, 1, 1.4, 0.5, 6, 4, true);
      break;
    case 'terror':
      // A tall wobbly wail, teeth top and bottom, and a sweat bead.
      g.sphere(v3(0, my - 0.012, mz), 0.036, dark, 1.35, 1.55, 0.5, 14, 8, true);
      g.box(M(0, my + 0.034, mz + 0.012), 0.05, 0.01, 0.008, teeth, 0.003);
      g.box(M(0, my - 0.058, mz + 0.012), 0.04, 0.009, 0.008, teeth, 0.003);
      g.sphere(v3(-headR * 0.8, hy + 0.035, fz * 0.55), 0.015, '#9fd8ff', 0.8, 1.35, 0.8, 8, 6, true);
      break;
    case 'sick':
      // Puffed cheeks and a clamped wobbly mouth: here it comes.
      for (let k = 0; k < 5; k++) g.sphere(v3(-0.024 + k * 0.012, my + 0.004 + (k % 2 ? 0.004 : -0.002), mz), 0.006, '#3c5a1a', 1, 1, 0.6, 6, 4, true);
      for (const sx of [-1, 1]) g.sphere(v3(sx * headR * 0.52, hy - 0.035, fz * 0.88), 0.028, '#9ad24e', 1, 0.9, 0.6, 8, 5, true);
      break;
  }
  // Hair.
  const cap = (col: Col, back = -0.014, sy = 0.78) => g.sphere(v3(0, hy + 0.024, back), headR * 1.07, col, 1.06, sy, 1.02, 16, 9, true);
  switch (look.hairStyle) {
    case 'short':
      cap(hair);
      // A little front curl.
      g.sphere(v3(0.02, hy + headR * 0.86, headR * 0.5), 0.028, hair, 1.3, 0.8, 1, 8, 5, true);
      break;
    case 'long':
      cap(hair);
      g.sphere(v3(0, hy - 0.035, -0.05), headR * 1.02, hair, 1.08, 1.05, 0.7, 14, 8, true);
      for (const sx of [-1, 1]) g.sphere(v3(sx * headR * 0.92, hy - 0.05, 0.0), 0.034, hair, 0.8, 1.9, 1, 8, 6, true);
      break;
    case 'bun':
      cap(hair);
      g.sphere(v3(0, hy + headR * 1.08, -0.03), 0.055, hair, 1, 0.9, 1, 10, 7, true);
      break;
    case 'spiky':
      cap(hair, -0.01, 0.7);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const dir = v3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55 - 0.2).normalize();
        const base = v3(0, hy, 0).addScaledVector(dir, headR * 0.9);
        const q = new Quaternion().setFromUnitVectors(v3(0, 1, 0), dir);
        g.cyl(new Matrix4().makeRotationFromQuaternion(q).setPosition(base.addScaledVector(dir, 0.03)), 0.032, 0, 0.08, hair, 6);
      }
      break;
    case 'cap': {
      const cc = SHIRTS[(look.shirt + 3) % SHIRTS.length];
      cap(cc, -0.005, 0.72);
      g.box(M(0, hy + 0.04, headR * 0.95), headR * 1.3, 0.016, 0.1, shade(cc, -0.1), 0.006);
      g.sphere(v3(0, hy + headR * 0.82, 0), 0.016, PAL.white, 1, 1, 1, 6, 4);
      break;
    }
    case 'bald':
      // A fringe round the back and a shine on top.
      g.sphere(v3(0, hy - 0.01, -0.03), headR * 1.02, hair, 1.08, 0.5, 0.85, 12, 6, true);
      g.sphere(v3(-0.03, hy + headR * 0.82, 0.02), 0.018, shade(skin, 0.5), 1, 0.5, 1, 6, 4, true);
      break;
  }
  if (look.big) {
    // Bosses: a tiny top hat and a handlebar moustache.
    g.cyl(M(0, hy + headR * 1.02, 0), headR * 0.5, headR * 0.44, 0.07, PAL.ink, 12);
    g.cyl(M(0, hy + headR * 0.97, 0), headR * 0.72, headR * 0.72, 0.012, PAL.ink, 12);
    g.cyl(M(0, hy + headR * 1.0, 0), headR * 0.51, headR * 0.51, 0.018, PAL.red, 12);
    for (const sx of [-1, 1])
      sausage(g, curve(v3(sx * 0.006, hy - 0.03, fz + 0.012), v3(sx * 0.03, hy - 0.04, fz + 0.004), v3(sx * 0.05, hy - 0.022, fz - 0.01)), 0.009, HAIRS[look.hair]);
  }
  const tiltBack = seated ? 0.15 : 0.42;
  g.transform(new Matrix4().makeTranslation(0, hy, 0).multiply(new Matrix4().makeRotationX(-tiltBack)).multiply(new Matrix4().makeTranslation(0, -hy, 0)), headFrom);
  // Accessories.
  if (look.accessory === 'camera') {
    g.box(M(0.02, y0 + torsoH * 0.55, 0.07), 0.07, 0.05, 0.03, PAL.ink, 0.01);
    g.cyl(new Matrix4().makeRotationX(Math.PI / 2).setPosition(0.02, y0 + torsoH * 0.55, 0.09), 0.016, 0.016, 0.02, '#8c96b8', 8);
  } else if (look.accessory === 'corndog') {
    g.beam(v3(0.15, y0 + 0.0, 0.08), v3(0.17, y0 + 0.12, 0.09), 0.012, '#e8d9b0');
    g.cyl(new Matrix4().makeRotationZ(-0.25).setPosition(0.185, y0 + 0.16, 0.09), 0.028, 0.026, 0.1, '#e0962a', 8);
    // A bite out of it.
    g.sphere(v3(0.2, y0 + 0.215, 0.1), 0.014, '#f3d9a0', 1, 1, 1, 6, 4, true);
  } else if (look.accessory === 'balloon' && !seated) {
    g.beam(v3(0.13, y0 + 0.04, 0.03), v3(0.18, y0 + 0.5, 0.0), 0.006, '#e4e4ec');
    g.sphere(v3(0.18, y0 + 0.58, 0), 0.08, PAL.red, 0.95, 1.1, 0.95, 12, 8, true);
    g.sphere(v3(0.155, y0 + 0.61, 0.06), 0.018, '#ffd0c8', 1, 1, 0.5, 6, 4, true);
  }
  // Arm: shoulder at the origin, hanging down -Y.
  const arm = new Geo();
  const sleeve = ghost ? pants : shirt;
  arm.sphere(v3(0, -0.012, 0), 0.03, sleeve, 1, 1, 1, 8, 5, true);
  arm.cyl(M(0, -0.04, 0), 0.028, 0.025, 0.06, sleeve, 8, undefined, true);
  arm.cyl(M(0, -0.08, 0), 0.022, 0.021, 0.03, ghost ? pants : skin, 8, undefined, true);
  // A mitten hand with a thumb.
  arm.sphere(v3(0, -0.102, 0.004), 0.032, ghost ? pants : skin, 1, 1.05, 0.85, 10, 6, true);
  arm.sphere(v3(0.02, -0.092, 0.014), 0.012, ghost ? pants : skin, 1, 1.4, 1, 6, 4, true);
  // Leg: hip at the origin, a chunky round shoe at -legH.
  let leg: Geo | null = null;
  if (!seated && !ghost) {
    leg = new Geo();
    leg.cyl(M(0, -legH / 2 + 0.012, 0), 0.034, 0.03, legH - 0.008, pants, 8, undefined, true);
    const shoe = SHOES[(look.shirt + look.pants * 2) % SHOES.length];
    leg.sphere(v3(0, -legH + 0.018, 0.016), 0.036, shoe, 0.95, 0.6, 1.4, 10, 6, true);
    leg.box(M(0, -legH + 0.006, 0.016), 0.062, 0.012, 0.09, shade(shoe, -0.3), 0.005);
  }
  return {
    body: g.build(),
    arm: arm.build(),
    leg: leg?.build() ?? null,
    shoulderY: y0 + torsoH * 0.84,
    shoulderX: torsoW * 0.47 + 0.012,
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

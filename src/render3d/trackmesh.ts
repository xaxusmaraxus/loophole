import { Matrix4, Vector3 } from 'three';
import { PAL } from '../render/palette';
import type { Flavor } from '../puzzle/pieces';
import { Geo, shade, v3 } from './geo';
import type { Parts } from './models';
import type { TrackPath, TrackPt } from './track';

// Rails, spine, ties, lift chain and supports for one chain cell of the track.
// Ties, columns and bulbs are spaced by the whole track's arc length, so they
// run on evenly across cell joints instead of bunching up where cells meet.

const RAIL_GAP = 0.066;
const RAIL_R = 0.021;
/** The box spine under the rails: how far below the rail line, and its half size (to a corner). */
const SPINE_DROP = 0.056;
const SPINE_R = 0.031;
const TIE_STEP = 0.072;
const SUPPORT_STEP = 0.36;
const CONCRETE = '#ddd5c4';

export interface TrackStyle {
  support: string;
  tie: string;
  /** One rail and spine colour for the whole ride (the park's paint). */
  rail: string;
  spine: string;
}

export function buildCellTrack(path: TrackPath, i: number, style: TrackStyle): Parts {
  const pts = path.seg[i];
  const cell = path.cells[i];
  const parts: Parts = { gloss: new Geo(), matte: new Geo() };
  const gl = parts.gloss!;
  const mt = parts.matte!;
  if (pts.length < 2) return parts;
  let rail = style.rail;
  let spine = style.spine;
  const fl = cell.station ? null : cell.flavor ?? null;
  if (fl === 'hang') [rail, spine] = [shade(rail, -0.1).getStyle(), HANG_IRON];
  if (fl === 'water') spine = FLUME;
  // Spinning pieces get candy-striped rails: resample evenly so the stripes come out even.
  const rp = fl === 'spin' ? resample(pts, 0.032) : decimate(pts);
  const ups = rp.map((p) => p.up);
  const rights = rp.map((p) => p.right);
  const stripe = (i: number) => (i % 2 ? SPIN_PINK : SPIN_WHITE);
  for (const side of [-1, 1]) gl.tube(rp.map((p) => p.p.clone().addScaledVector(p.right, side * RAIL_GAP)), rights, ups, RAIL_R * (fl === 'spin' ? 1.15 : 1), fl === 'spin' ? stripe : rail, 8);
  // A chunky box spine (four sides, pillowed by the smooth normals).
  gl.tube(rp.map((p) => p.p.clone().addScaledVector(p.up, -SPINE_DROP)), rights, ups, SPINE_R, fl === 'spin' ? SPIN_MINT : spine, 4);
  // Ties: a V of struts from each rail down onto a clamp on the spine.
  const tieCol = fl === 'spin' ? SPIN_PINK : fl === 'hang' ? HANG_IRON : style.tie;
  forEvery(pts, TIE_STEP, (q) => {
    const top = q.p.clone().addScaledVector(q.up, -SPINE_DROP + SPINE_R * 0.62);
    for (const side of [-1, 1])
      mt.beam(q.p.clone().addScaledVector(q.right, side * RAIL_GAP).addScaledVector(q.up, -0.008), top.clone().addScaledVector(q.right, side * 0.016), 0.015, tieCol, 0.012);
    mt.box(frame(q, top), 0.056, 0.014, 0.022, tieCol);
  }, 0.5);
  // Lift chain: a dark trough of links clattering up the middle, gold anti-rollback dogs
  // by each rail, and a catwalk with a handrail down one side.
  const lifts = pts.filter((q) => q.lift);
  if (lifts.length > 1) {
    forEvery(pts, 0.024, (q, k) => {
      if (!q.lift) return;
      mt.box(frame(q, q.p.clone().addScaledVector(q.up, -0.004)), 0.024, 0.012, 0.02, k % 2 ? '#2b2140' : '#7d8199');
    }, 0.5);
    forEvery(pts, 0.075, (q) => {
      if (!q.lift) return;
      for (const side of [-1, 1]) {
        const a = q.p.clone().addScaledVector(q.right, side * (RAIL_GAP - 0.03)).addScaledVector(q.up, -0.006);
        mt.beam(a, a.clone().addScaledVector(q.t, -0.026).addScaledVector(q.up, 0.016), 0.01, PAL.gold);
      }
    }, 0.5);
    const sd = cellSide(cell.x, cell.y);
    const walk = (q: TrackPt, out: number, up: number) => q.p.clone().addScaledVector(q.right, sd * out).addScaledVector(q.up, up);
    forEvery(pts, 0.05, (q) => {
      if (!q.lift) return;
      mt.box(frame(q, walk(q, 0.15, -0.05)), 0.085, 0.01, 0.042, '#9aa0b8');
      mt.beam(walk(q, 0.1, -0.052), walk(q, 0.04, -0.06), 0.008, '#7d8199');
    }, 0.5);
    forEvery(pts, 0.16, (q) => {
      if (!q.lift) return;
      mt.beam(walk(q, 0.19, -0.05), walk(q, 0.19, 0.05), 0.01, '#e7e9f2');
    }, 0.5);
    const hand = lifts.map((q) => walk(q, 0.19, 0.05));
    if (hand.length > 1) gl.pipe(hand, 0.008, '#e7e9f2', 5);
  }
  if (!cell.station) supports(path, i, pts, mt, style);
  extras(path, i, pts, parts);
  if (fl) flavorExtras(path, i, pts, parts, fl);
  // Bulbs round the big showpieces (the Vertical Loop and the Top Hat), and round
  // any element a lift chain powers up (more of them, the bigger the payoff).
  const lv = path.levels[i];
  const boosted = !cell.station && lv && lv.mult > 1;
  if (!cell.station && (cell.tier === 4 || cell.tier === 7 || boosted)) {
    parts.glow ??= new Geo();
    const step = boosted ? Math.max(0.07, 0.12 - lv.mult * 0.01) : 0.11;
    forEvery(pts, step, (q, k) => {
      if (q.ang < 0 && !boosted) return;
      for (const side of [-1, 1]) {
        const b = q.p.clone().addScaledVector(q.up, -SPINE_DROP).addScaledVector(q.right, side * (SPINE_R + 0.004));
        parts.glow!.sphere(b, 0.012, (k + (side > 0 ? 1 : 0)) % 2 ? '#fff1b0' : boosted ? '#ffd23f' : '#ffc4e0', 1, 1, 1, 6, 4, true);
      }
    }, 0.5);
  }
  // A buffer stop where the track ends.
  const n = path.cells.length;
  if (!path.closed && (i === 0 || i === n - 1)) {
    const q = i === 0 ? pts[0] : pts[pts.length - 1];
    const dir = i === 0 ? -1 : 1;
    const c = q.p.clone().addScaledVector(q.t, dir * 0.01);
    for (const [k, col] of [[0, PAL.red], [1, PAL.white], [2, PAL.red]] as const)
      mt.box(frame(q, c.clone().addScaledVector(q.up, 0.02 + k * 0.035)), 0.16, 0.035, 0.04, col, 0.008);
    const gy = path.groundAt(cell.x, cell.y);
    mt.beam(c.clone().addScaledVector(q.up, -0.01), v3(c.x, gy, c.z), 0.03, style.support);
    footer(mt, c.x, gy, c.z, q.t);
  }
  return parts;
}

/** Which side of a lift its catwalk runs on (fixed per cell). */
function cellSide(x: number, y: number): number {
  return (x * 7 + y * 13) % 2 ? 1 : -1;
}

const SPIN_PINK = '#ff7eb6';
const SPIN_WHITE = '#fbf6ec';
const SPIN_MINT = '#7fe0c8';
const HANG_IRON = '#3c3550';
const FLUME = '#2f8fd0';

/**
 * Tube rings only where the track bends or rolls: a ring is kept once the
 * heading or the up vector has turned about 3.5 degrees since the last one
 * (or after a long straight run). Ends are always kept so cells join exactly.
 */
function decimate(pts: TrackPt[]): TrackPt[] {
  if (pts.length < 3) return pts;
  const out: TrackPt[] = [pts[0]];
  const cos = Math.cos((3.5 * Math.PI) / 180);
  for (let k = 1; k < pts.length - 1; k++) {
    const last = out[out.length - 1];
    const q = pts[k];
    const nx = pts[k + 1];
    if (nx.t.dot(last.t) < cos || nx.up.dot(last.up) < cos || nx.s - last.s > 0.22) out.push(q);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Samples spaced evenly (about `step` apart) along the arc, end points included. */
function resample(pts: TrackPt[], step: number): TrackPt[] {
  const out: TrackPt[] = [pts[0]];
  forEvery(pts, step, (q) => out.push(q));
  out.push(pts[pts.length - 1]);
  return out;
}

/** Park pieces: a flume trough, candy swirls, or a steel gantry for the hanging run. */
function flavorExtras(path: TrackPath, i: number, pts: TrackPt[], parts: Parts, fl: Flavor): void {
  const cell = path.cells[i];
  const mt = parts.matte!;
  const gl = parts.gloss!;
  if (fl === 'water') {
    // A clay flume: a trough under the rails, full of water. Only where the track is upright.
    const qs = resample(pts, 0.028).filter((q) => q.up.y > 0.35);
    const W = 0.165;
    const floor = -SPINE_DROP - 0.05;
    const top = 0.035;
    const wat = (parts.water ??= new Geo());
    for (let k = 0; k < qs.length - 1; k++) {
      const a = qs[k];
      const b = qs[k + 1];
      if (a.p.distanceTo(b.p) > 0.08) continue;
      const P = (q: TrackPt, x: number, y: number) => q.p.clone().addScaledVector(q.right, x).addScaledVector(q.up, y);
      const mid = a.p.clone().add(b.p).multiplyScalar(0.5).addScaledVector(a.up, -0.02);
      // Floor and outer walls.
      mt.quad(P(a, -W, floor), P(a, W, floor), P(b, W, floor), P(b, -W, floor), shade(FLUME, -0.1), mid.clone().addScaledVector(a.up, 1));
      for (const sd of [-1, 1]) {
        mt.quad(P(a, sd * W, floor), P(a, sd * W, top), P(b, sd * W, top), P(b, sd * W, floor), k % 6 < 3 ? FLUME : shade(FLUME, 0.06), mid);
        mt.quad(P(a, sd * (W - 0.02), floor), P(a, sd * (W - 0.02), top), P(b, sd * (W - 0.02), top), P(b, sd * (W - 0.02), floor), '#9fe3ff', mid.clone().addScaledVector(a.right, sd * 1));
      }
      // The water: ripples of two blues, just under the rails.
      const y = -0.03;
      wat.quad(P(a, -W + 0.02, y), P(a, W - 0.02, y), P(b, W - 0.02, y), P(b, -W + 0.02, y), k % 4 < 2 ? '#6fd0f5' : '#8fdcf6', mid.clone().addScaledVector(a.up, -1));
    }
    // A rounded white lip along both walls.
    for (const sd of [-1, 1]) {
      const run = qs.map((q) => q.p.clone().addScaledVector(q.right, sd * (W - 0.01)).addScaledVector(q.up, top));
      if (run.length > 1) gl.pipe(run, 0.018, '#e8fbff', 6);
    }
    // Foam caps on the water.
    forEvery(pts, 0.12, (q) => {
      if (q.up.y < 0.35) return;
      const off = (Math.round(q.s * 37) % 3) - 1;
      wat.sphere(q.p.clone().addScaledVector(q.right, off * 0.1).addScaledVector(q.up, -0.025), 0.022, '#fbf6ec', 1.4, 0.4, 1, 8, 4, true);
    });
  } else if (fl === 'spin') {
    // Swirl lollipops either side, and candy dots on the ties.
    const mids = [pts[Math.floor(pts.length * 0.25)], pts[Math.floor(pts.length * 0.75)]];
    mids.forEach((q, k) => {
      const side = k ? 1 : -1;
      const out = q.right.clone().setY(0);
      if (out.lengthSq() < 1e-4) return;
      out.normalize();
      const base = v3(q.p.x + out.x * side * 0.22, 0, q.p.z + out.z * side * 0.22);
      const h = Math.max(0.2, q.p.y + 0.08);
      for (let j = 0; j < 5; j++) mt.post(base.x, (h * j) / 5, base.z, 0.014, h / 5, j % 2 ? SPIN_PINK : SPIN_WHITE, 6);
      swirl(gl, v3(base.x, h + 0.07, base.z), 0.075, k ? SPIN_MINT : SPIN_PINK);
    });
    forEvery(pts, 0.1, (q) => gl.sphere(q.p.clone().addScaledVector(q.up, -SPINE_DROP - 0.025), 0.02, '#ffd23f', 1, 1, 1, 6, 4, true));
  } else {
    // A dark steel gantry: portal frames carrying the rail from above.
    const frames: TrackPt[] = [];
    forEvery(pts, 0.32, (q) => {
      if (q.up.y > 0.6) frames.push(q);
    });
    if (!frames.length) frames.push(pts[Math.floor(pts.length / 2)]);
    frames.forEach((q, k) => {
      const out = q.right.clone().setY(0);
      if (out.lengthSq() < 1e-4) return;
      out.normalize();
      const topY = q.p.y + 0.15;
      const L = q.p.clone().addScaledVector(out, -0.24).setY(topY);
      const R = q.p.clone().addScaledVector(out, 0.24).setY(topY);
      const gy = path.groundAt(cell.x, cell.y);
      for (const c of [L, R]) {
        mt.post(c.x, gy, c.z, 0.024, topY - gy + 0.02, HANG_IRON, 6);
        mt.post(c.x, gy, c.z, 0.05, 0.03, '#2b2140', 8);
        mt.sphere(v3(c.x, topY + 0.02, c.z), 0.026, '#c9a05a', 1, 1, 1, 6, 4, true);
      }
      mt.beam(L, R, 0.04, HANG_IRON);
      // Cross bracing on one side.
      mt.beam(L.clone().setY(topY - 0.25), R.clone().setY(topY), 0.012, '#5a5270');
      // The hanger rod down to the rail.
      mt.beam(q.p.clone().setY(topY), q.p.clone().addScaledVector(q.up, 0.02), 0.022, HANG_IRON);
      // A bat roosting on every other frame.
      if (k % 2 === 0) bat(mt, L.clone().lerp(R, 0.72).setY(topY - 0.02));
    });
  }
}

/** A flat swirl disc facing the camera (+Z, tipped back a touch). */
function swirl(g: Geo, c: Vector3, R: number, color: string): void {
  const from = g.count;
  g.cyl(new Matrix4().makeRotationX(Math.PI / 2), R, R, 0.03, color, 18, color, true);
  const sp: Vector3[] = [];
  for (let k = 0; k <= 30; k++) {
    const t = k / 30;
    const a = t * Math.PI * 4;
    const r = 0.01 + t * (R - 0.018);
    sp.push(v3(Math.cos(a) * r, Math.sin(a) * r, 0.017));
  }
  g.pipe(sp, 0.011, SPIN_WHITE, 5);
  g.transform(new Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new Matrix4().makeRotationX(-0.4)), from);
}

/** A little bat hanging upside down from a beam. */
function bat(g: Geo, at: Vector3): void {
  const body = '#2b2140';
  g.sphere(at.clone().setY(at.y - 0.045), 0.03, body, 1, 1.3, 0.9, 8, 5, true);
  g.sphere(at.clone().setY(at.y - 0.085), 0.024, body, 1, 1, 1, 8, 5, true);
  for (const sx of [-1, 1]) {
    g.sphere(v3(at.x + sx * 0.01, at.y - 0.085, at.z + 0.021), 0.006, '#ffd23f', 1, 1, 0.6, 5, 3, true);
    g.beam(v3(at.x + sx * 0.02, at.y - 0.03, at.z), v3(at.x + sx * 0.06, at.y - 0.075, at.z - 0.005), 0.02, '#4a3d6b', 0.008);
  }
}

function frame(q: TrackPt, at: Vector3): Matrix4 {
  // Local X = right, Y = up, Z = forward.
  return new Matrix4().makeBasis(q.right, q.up, q.t).setPosition(at);
}

/**
 * Calls f at points spaced `step` apart along the samples' arc length. With a
 * `phase`, the points sit on one grid over the whole track (s = (k + phase) * step),
 * so neighbouring cells continue each other's rhythm; `k` is the grid index.
 */
function forEvery(pts: TrackPt[], step: number, f: (q: TrackPt, k: number) => void, phase?: number): void {
  const s0 = pts[0].s;
  const s1 = pts[pts.length - 1].s;
  const at: [number, number][] = [];
  if (phase === undefined) {
    const n = Math.max(1, Math.round((s1 - s0) / step));
    for (let k = 0; k < n; k++) at.push([s0 + ((k + 0.5) / n) * (s1 - s0), k]);
  } else for (let k = Math.ceil(s0 / step - phase); (k + phase) * step < s1; k++) at.push([(k + phase) * step, k]);
  let j = 0;
  for (const [s, k] of at) {
    while (j < pts.length - 2 && pts[j + 1].s < s) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const t = Math.min(1, Math.max(0, (s - a.s) / Math.max(1e-6, b.s - a.s)));
    const p = a.p.clone().lerp(b.p, t);
    const up = a.up.clone().lerp(b.up, t).normalize();
    const tt = a.t.clone().lerp(b.t, t).normalize();
    const right = up.clone().cross(tt).normalize();
    f({ ...a, p, up, t: tt, right, s }, k);
  }
}

/** A clay concrete footing, squared to the track. */
function footer(g: Geo, x: number, y: number, z: number, along: Vector3, size = 1): void {
  const a = Math.atan2(along.x, along.z);
  g.box(new Matrix4().makeRotationY(a).setPosition(x, y + 0.022 * size, z), 0.095 * size, 0.05 * size, 0.095 * size, CONCRETE, 0.014 * size, shade(CONCRETE, 0.06));
}

/** Arc-length distance between two points of the track (round the loop when closed). */
function gap(path: TrackPath, a: number, b: number): number {
  const d = Math.abs(a - b);
  return path.closed ? Math.min(d, path.length - d) : d;
}

/** Can a column stand at (x, z) up to `top` without spearing another pass of the track below it? */
function clearBelow(path: TrackPath, x: number, z: number, top: number, s: number, r = 0.12): boolean {
  for (const o of path.pts) {
    if (o.p.y > top - 0.03 || gap(path, o.s, s) < 0.3) continue;
    const dx = o.p.x - x;
    const dz = o.p.z - z;
    if (dx * dx + dz * dz < r * r) return false;
  }
  return true;
}

function supports(path: TrackPath, i: number, pts: TrackPt[], g: Geo, style: TrackStyle): void {
  const cell = path.cells[i];
  const col = style.support;
  const dark = shade(col, -0.22);
  const gy = path.groundAt(cell.x, cell.y);
  const flatT = (q: TrackPt) => {
    const t = q.t.clone().setY(0);
    return t.lengthSq() > 1e-6 ? t.normalize() : v3(0, 0, 1);
  };
  /** A chunky column from a footing up to a saddle under the spine. */
  const column = (q: TrackPt, top: Vector3, r = 0.024) => {
    const h = top.y - gy;
    if (h < 0.07 || !clearBelow(path, top.x, top.z, top.y, q.s)) return false;
    g.post(top.x, gy, top.z, r, h, col, 8);
    g.post(top.x, top.y - 0.028, top.z, r * 1.4, 0.028, dark, 8);
    footer(g, top.x, gy, top.z, flatT(q));
    return true;
  };
  const base = (q: TrackPt) => q.p.clone().addScaledVector(q.up, -SPINE_DROP - SPINE_R * 0.6);
  // Where two passes cross, keep the middle of the cell clear of columns.
  const crossed = path.cells.some((o, j) => j !== i && !o.station && o.x === cell.x && o.y === cell.y);
  const nearMiddle = (q: TrackPt) => crossed && Math.hypot(q.p.x - cell.x - 0.5, q.p.z - cell.y - 0.5) < 0.24;
  // Plain columns under upright track (a hanging run stands on its gantry instead).
  forEvery(pts, SUPPORT_STEP, (q) => {
    if (cell.flavor === 'hang') return;
    if (q.elem || q.up.y < 0.75 || nearMiddle(q)) return;
    const top = base(q);
    const h = top.y - gy;
    if (h > 0.5) {
      // High track (a lift chain and the run along its top) stands on a braced trestle.
      if (!clearBelow(path, top.x, top.z, top.y, q.s, 0.2)) return;
      const out = q.right.clone().setY(0);
      if (out.lengthSq() < 1e-6) return;
      out.normalize();
      const spread = 0.06 + h * 0.07;
      const legTop = (sd: number) => top.clone().addScaledVector(out, sd * 0.045);
      const legFoot = (sd: number) => v3(top.x + out.x * sd * spread, gy, top.z + out.z * sd * spread);
      for (const sd of [-1, 1]) {
        g.beam(legTop(sd), legFoot(sd), 0.03, col);
        footer(g, legFoot(sd).x, gy, legFoot(sd).z, flatT(q), 0.85);
      }
      g.beam(legTop(-1), legTop(1), 0.034, dark);
      // Horizontal ties and one diagonal.
      for (const f of [0.36, 0.7]) {
        const a = legTop(-1).lerp(legFoot(-1), f);
        const b = legTop(1).lerp(legFoot(1), f);
        g.beam(a, b, 0.016, col);
      }
      g.beam(legTop(-1).lerp(legFoot(-1), 0.36), legTop(1).lerp(legFoot(1), 0.7), 0.012, col);
      return;
    }
    if (column(q, top)) {
      // A saddle under the spine.
      const r = q.right.clone().setY(0);
      if (r.lengthSq() > 1e-6) {
        r.normalize();
        g.beam(top.clone().addScaledVector(r, -0.04), top.clone().addScaledVector(r, 0.04), 0.024, dark);
      }
    }
  }, 0.5);
  if (path.crossKind.get(i) === 'bridge')
    // Bridge piers either side of the track it crosses.
    for (const q of pts)
      if (Math.abs(Math.hypot(q.p.x - cell.x - 0.5, q.p.z - cell.y - 0.5) - 0.3) < 0.02) {
        const b = base(q);
        const out = q.right.clone().setY(0).normalize().multiplyScalar(0.09);
        for (const side of [-1, 1]) {
          const top = b.clone().addScaledVector(out, side);
          const ft = v3(top.x + out.x * side * 0.6, gy, top.z + out.z * side * 0.6);
          g.beam(top, ft, 0.026, col);
          footer(g, ft.x, gy, ft.z, flatT(q), 0.8);
        }
      }
  if (cell.tier === 4) {
    // A-frame legs from the loop's flanks.
    const flank = pts.filter((q) => q.ang > 0).reduce<TrackPt[]>((acc, q) => {
      for (const target of [Math.PI / 2, (3 * Math.PI) / 2]) if (Math.abs(q.ang - target) < 0.08 && !acc.some((a) => Math.abs(a.ang - target) < 0.5)) acc.push(q);
      return acc;
    }, []);
    for (const q of flank) {
      const b = q.p.clone().addScaledVector(q.up, -SPINE_DROP - SPINE_R * 0.5);
      const out = q.right.clone().setY(0).normalize();
      for (const side of [-1, 1]) {
        const ground = v3(b.x + out.x * side * 0.16, gy, b.z + out.z * side * 0.16);
        g.beam(b.clone().addScaledVector(out, side * 0.03), ground, 0.03, col);
        footer(g, ground.x, gy, ground.z, flatT(q), 0.9);
      }
      g.beam(b.clone().addScaledVector(out, -0.04), b.clone().addScaledVector(out, 0.04), 0.03, dark);
    }
  } else if (cell.tier === 3) {
    // A central pylon with spokes out to the helix.
    const e = pts.filter((q) => q.elem);
    if (e.length) {
      const c = e.reduce((s, q) => s.add(q.p), v3(0, 0, 0)).divideScalar(e.length);
      const top = Math.max(...e.map((q) => q.p.y)) - 0.02;
      g.post(c.x, gy, c.z, 0.042, top - gy, col, 10);
      g.post(c.x, top - 0.03, c.z, 0.056, 0.04, dark, 10);
      footer(g, c.x, gy, c.z, v3(0, 0, 1), 1.5);
      for (let k = 0; k < e.length; k += Math.max(1, Math.floor(e.length / 6))) {
        const q = e[k];
        g.beam(v3(c.x, Math.min(top, q.p.y - 0.06), c.z), q.p.clone().addScaledVector(q.up, -SPINE_DROP - SPINE_R * 0.5), 0.02, col);
      }
    }
  } else if (cell.tier === 6) {
    // The cobra's hood: a leg from the outer flank of each lobe, and a post where they meet.
    const lobes = [pts.filter((q) => q.ang > 0.3 && q.ang < Math.PI * 2 - 0.3), pts.filter((q) => q.ang > Math.PI * 2 + 0.3 && q.ang < Math.PI * 4 - 0.3)];
    for (const lobe of lobes) {
      if (!lobe.length) continue;
      const c = lobe.reduce((s, q) => s.add(q.p), v3(0, 0, 0)).divideScalar(lobe.length);
      const far = lobe.reduce((a, q) => (Math.hypot(q.p.x - c.x, q.p.z - c.z) + q.p.y * 0.2 > Math.hypot(a.p.x - c.x, a.p.z - c.z) + a.p.y * 0.2 ? q : a), lobe[0]);
      const b = base(far);
      const out = v3(far.p.x - c.x, 0, far.p.z - c.z);
      if (out.lengthSq() < 1e-6) continue;
      out.normalize();
      const ground = v3(b.x + out.x * 0.16, gy, b.z + out.z * 0.16);
      g.beam(far.p.clone().addScaledVector(far.up, -SPINE_DROP), ground, 0.028, col);
      footer(g, ground.x, gy, ground.z, out, 0.9);
    }
    const mid = pts.find((q) => Math.abs(q.ang - Math.PI * 2) < 0.12);
    if (mid) column(mid, base(mid), 0.028);
  } else if (cell.tier === 7) {
    // The Top Hat stands on a lattice tower under its crown.
    const hat = pts.filter((q) => q.ang >= 0);
    if (hat.length) {
      const top = hat.reduce((a, q) => (q.p.y > a.p.y ? q : a), hat[0]);
      const legs = hat.filter((q) => Math.abs(q.t.y) > 0.9);
      const lo = legs.length ? Math.min(...legs.map((q) => q.p.y)) : 0.2;
      const across = legs.length ? legs[0].p.clone().sub(legs[legs.length - 1].p).setY(0) : v3(1, 0, 0);
      const ax = across.lengthSq() > 1e-6 ? across.normalize() : v3(1, 0, 0);
      const side = v3(-ax.z, 0, ax.x).multiplyScalar(0.11);
      const H = top.p.y - SPINE_DROP - SPINE_R;
      for (const sd of [-1, 1]) {
        const fx = top.p.x + side.x * sd;
        const fz = top.p.z + side.z * sd;
        g.post(fx, gy, fz, 0.026, H - gy, col, 8);
        footer(g, fx, gy, fz, ax);
      }
      g.beam(v3(top.p.x - side.x, H, top.p.z - side.z), v3(top.p.x + side.x, H, top.p.z + side.z), 0.032, dark);
      // Cross bracing up the tower, and struts out to the legs.
      for (let y = gy + 0.15; y < H - 0.1; y += 0.22) {
        g.beam(v3(top.p.x - side.x, y, top.p.z - side.z), v3(top.p.x + side.x, y + 0.2, top.p.z + side.z), 0.012, col);
        g.beam(v3(top.p.x + side.x, y, top.p.z + side.z), v3(top.p.x - side.x, y + 0.2, top.p.z - side.z), 0.012, col);
      }
      for (const q of legs.filter((_, k) => k % 14 === 7)) {
        if (q.p.y < lo + 0.1) continue;
        g.beam(v3(top.p.x, q.p.y, top.p.z), q.p.clone().addScaledVector(q.up, -SPINE_DROP), 0.016, col);
      }
    }
  } else if (cell.tier === 5) {
    const e = pts.filter((q) => q.elem);
    if (e.length) {
      const mid = e[Math.floor(e.length / 2)];
      // The inverted middle hangs from a gantry.
      const top = mid.p.y + 0.13;
      const l = mid.right.clone().setY(0).normalize().multiplyScalar(0.21);
      for (const side of [-1, 1]) {
        g.post(mid.p.x + l.x * side, gy, mid.p.z + l.z * side, 0.024, top - gy, col, 8);
        footer(g, mid.p.x + l.x * side, gy, mid.p.z + l.z * side, flatT(mid));
      }
      g.beam(v3(mid.p.x - l.x, top, mid.p.z - l.z), v3(mid.p.x + l.x, top, mid.p.z + l.z), 0.036, dark);
      g.beam(v3(mid.p.x, top, mid.p.z), mid.p.clone().addScaledVector(mid.up, -SPINE_DROP - SPINE_R * 0.5), 0.022, col);
    }
  }
}

/** Pier planks, bridge railings, tunnel tubes and special pieces. */
function extras(path: TrackPath, i: number, pts: TrackPt[], parts: Parts): void {
  const cell = path.cells[i];
  const mt = parts.matte!;
  const gl = parts.gloss!;
  const kind = path.crossKind.get(i);
  if (cell.pier) {
    // A plank walkway under the rails, out over the water.
    forEvery(pts, 0.06, (q) => mt.box(frame(q, q.p.clone().addScaledVector(q.up, -SPINE_DROP - 0.035)), 0.3, 0.018, 0.052, '#b98552', 0.006));
    forEvery(pts, 0.3, (q) => {
      for (const side of [-1, 1]) {
        const at = q.p.clone().addScaledVector(q.right, side * 0.13);
        mt.post(at.x, 0, at.z, 0.02, Math.max(0.05, at.y - SPINE_DROP - 0.04), '#8a5a2e', 7);
      }
    });
  }
  if (kind === 'bridge')
    // Handrails.
    for (const side of [-1, 1])
      gl.pipe(
        pts.map((q) => q.p.clone().addScaledVector(q.right, side * 0.12).addScaledVector(q.up, 0.07)),
        0.01,
        '#e7e9f2',
        6,
      );
  if (kind === 'tunnel') {
    // A clay tube over the middle of the pass, with stone portals: the train disappears inside.
    const mid = pts.filter((q) => Math.hypot(q.p.x - cell.x - 0.5, q.p.z - cell.y - 0.5) < 0.34);
    if (mid.length > 2) {
      const flat = (q: TrackPt) => ({ up: new Vector3(0, 1, 0), right: q.right.clone().setY(0).normalize() });
      mt.tube(
        mid.map((q) => q.p.clone().setY(q.p.y + 0.04)),
        mid.map((q) => flat(q).right),
        mid.map((q) => flat(q).up),
        0.19,
        '#7cc25c',
        16,
      );
      for (const q of [mid[0], mid[mid.length - 1]]) {
        const r = flat(q).right;
        const ring = [];
        for (let k = 0; k <= 16; k++) {
          const a = (k / 16) * Math.PI;
          ring.push(q.p.clone().setY(q.p.y + 0.04).addScaledVector(r, Math.cos(a) * 0.2).add(new Vector3(0, Math.sin(a) * 0.2, 0)));
        }
        mt.pipe(ring, 0.035, '#a9adc0', 6);
      }
    }
  }
  const sp = cell.special;
  if (sp === 'launch') {
    // Glowing launch fins down the middle, and arrows.
    parts.glow ??= new Geo();
    forEvery(pts, 0.05, (q) => parts.glow!.box(frame(q, q.p.clone().addScaledVector(q.up, -0.012)), 0.03, 0.02, 0.028, '#7ff2ff', 0.004));
    forEvery(pts, 0.25, (q) => {
      for (const side of [-1, 1]) {
        const a = q.p.clone().addScaledVector(q.up, 0.004).addScaledVector(q.right, side * 0.03);
        parts.glow!.beam(a, a.clone().addScaledVector(q.t, -0.04).addScaledVector(q.right, side * 0.02), 0.008, '#ffd23f');
      }
    });
  } else if (sp === 'brakes') {
    // Red brake fins on both sides, and a hazard-striped plate.
    forEvery(pts, 0.045, (q) => {
      for (const side of [-1, 1]) mt.box(frame(q, q.p.clone().addScaledVector(q.up, -0.03).addScaledVector(q.right, side * 0.035)), 0.012, 0.03, 0.03, '#e0484e', 0.003);
    });
    forEvery(pts, 0.08, (q) => mt.box(frame(q, q.p.clone().addScaledVector(q.up, -SPINE_DROP - 0.03)), 0.2, 0.012, 0.04, Math.round(q.s * 12.5) % 2 ? PAL.gold : PAL.ink, 0.004));
  } else if (sp === 'splash') {
    // A splash pool under the track.
    const c = pts[Math.floor(pts.length / 2)].p;
    mt.cyl(new Matrix4().makeTranslation(c.x, 0.03, c.z), 0.36, 0.38, 0.05, '#e2dccb', 20, undefined, true);
    gl.cyl(new Matrix4().makeTranslation(c.x, 0.05, c.z), 0.32, 0.32, 0.02, '#5cc8f0', 20, '#8fdcf6');
  }
}
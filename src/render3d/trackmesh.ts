import { Matrix4, Vector3 } from 'three';
import { PAL, TIER_RAMPS } from '../render/palette';
import { Geo, shade, v3 } from './geo';
import type { Parts } from './models';
import type { TrackPath, TrackPt } from './track';

// Rails, spine, ties, lift chain and supports for one chain cell of the track.

const RAIL_GAP = 0.052;
const RAIL_R = 0.017;
const SPINE_DROP = 0.045;
const STATION_RAIL = '#aab2cc';

export interface TrackStyle {
  support: string;
  tie: string;
}

export function railColor(tier: number, station: boolean): [string, string] {
  if (station) return [STATION_RAIL, '#6b7496'];
  if (tier === 0) return ['#d9dbe6', '#7f889c'];
  const r = TIER_RAMPS[tier];
  return [r[1], r[2]];
}

export function buildCellTrack(path: TrackPath, i: number, style: TrackStyle): Parts {
  const pts = path.seg[i];
  const cell = path.cells[i];
  const parts: Parts = { gloss: new Geo(), matte: new Geo() };
  const gl = parts.gloss!;
  const mt = parts.matte!;
  if (pts.length < 2) return parts;
  const [rail, spine] = railColor(cell.tier, cell.station);
  const ups = pts.map((p) => p.up);
  const rights = pts.map((p) => p.right);
  for (const side of [-1, 1]) gl.tube(pts.map((p) => p.p.clone().addScaledVector(p.right, side * RAIL_GAP)), rights, ups, RAIL_R, rail, 7);
  gl.tube(pts.map((p) => p.p.clone().addScaledVector(p.up, -SPINE_DROP)), rights, ups, 0.022, spine, 7);
  // Ties: little C-brackets from each rail to the spine, evenly spaced along the arc.
  const tieCol = cell.station ? '#4a4a5c' : style.tie;
  forEvery(pts, 0.062, (q) => {
    const sp = q.p.clone().addScaledVector(q.up, -SPINE_DROP);
    for (const side of [-1, 1]) mt.beam(q.p.clone().addScaledVector(q.right, side * RAIL_GAP), sp, 0.013, tieCol);
  });
  // Lift chain on the climb.
  forEvery(pts, 0.03, (q) => {
    if (!q.lift) return;
    const c = q.p.clone().addScaledVector(q.up, 0.012);
    mt.beam(c.clone().addScaledVector(q.t, -0.01), c.clone().addScaledVector(q.t, 0.01), 0.018, '#2b2140');
  });
  if (!cell.station) supports(path, i, pts, mt, style);
  // Bulbs around the Mega Loop.
  if (cell.tier === 7) {
    parts.glow = new Geo();
    forEvery(pts, 0.09, (q) => {
      if (q.ang < 0) return;
      const b = q.p.clone().addScaledVector(q.up, -SPINE_DROP - 0.03);
      parts.glow!.sphere(b, 0.017, '#fff1b0', 1, 1, 1, 6, 4, true);
    });
  }
  // A buffer stop where the track ends.
  const n = path.cells.length;
  if (!path.closed && (i === 0 || i === n - 1)) {
    const q = i === 0 ? pts[0] : pts[pts.length - 1];
    const dir = i === 0 ? -1 : 1;
    const c = q.p.clone().addScaledVector(q.t, dir * 0.01);
    for (const [k, col] of [[0, PAL.red], [1, PAL.white], [2, PAL.red]] as const)
      mt.box(frame(q, c.clone().addScaledVector(q.up, 0.02 + k * 0.035)), 0.16, 0.035, 0.04, col, 0.008);
    mt.beam(c.clone().addScaledVector(q.up, -0.01), v3(c.x, 0, c.z), 0.025, style.support);
  }
  return parts;
}

function frame(q: TrackPt, at: Vector3): Matrix4 {
  // Local X = right, Y = up, Z = forward.
  return new Matrix4().makeBasis(q.right, q.up, q.t).setPosition(at);
}

/** Calls f at points spaced `step` apart along the samples' arc length. */
function forEvery(pts: TrackPt[], step: number, f: (q: TrackPt) => void): void {
  const s0 = pts[0].s;
  const s1 = pts[pts.length - 1].s;
  const n = Math.max(1, Math.round((s1 - s0) / step));
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = s0 + ((k + 0.5) / n) * (s1 - s0);
    while (j < pts.length - 2 && pts[j + 1].s < s) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
    const p = a.p.clone().lerp(b.p, t);
    const up = a.up.clone().lerp(b.up, t).normalize();
    const tt = a.t.clone().lerp(b.t, t).normalize();
    const right = up.clone().cross(tt).normalize();
    f({ ...a, p, up, t: tt, right, s });
  }
}

function supports(path: TrackPath, i: number, pts: TrackPt[], g: Geo, style: TrackStyle): void {
  const cell = path.cells[i];
  const col = style.support;
  const foot = shade(col, -0.25);
  const column = (top: Vector3, r = 0.017) => {
    if (top.y < 0.05) return;
    g.post(top.x, 0, top.z, r, top.y, col, 6);
    g.post(top.x, 0, top.z, r * 2.2, 0.03, foot, 6);
  };
  const base = (q: TrackPt) => q.p.clone().addScaledVector(q.up, -SPINE_DROP - 0.02);
  // Plain columns under upright track.
  forEvery(pts, 0.3, (q) => {
    if (q.elem || q.up.y < 0.75) return;
    column(base(q));
  });
  if (cell.tier === 5 || cell.tier === 7) {
    // A-frame legs from the loop's flanks.
    const flank = pts.filter((q) => q.ang > 0).reduce<TrackPt[]>((acc, q) => {
      for (const target of [Math.PI / 2, (3 * Math.PI) / 2]) if (Math.abs(q.ang - target) < 0.12 && !acc.some((a) => Math.abs(a.ang - target) < 0.5)) acc.push(q);
      return acc;
    }, []);
    for (const q of flank) {
      const b = base(q).addScaledVector(q.up, 0.01);
      const out = q.right.clone().setY(0).normalize();
      for (const side of [-1, 1]) {
        const ground = v3(b.x + out.x * side * 0.14, 0, b.z + out.z * side * 0.14);
        g.beam(b, ground, 0.024, col);
        g.post(ground.x, 0, ground.z, 0.035, 0.03, foot, 6);
      }
    }
  } else if (cell.tier === 4) {
    // A central pylon with spokes out to the helix.
    const e = pts.filter((q) => q.elem);
    if (e.length) {
      const c = e.reduce((s, q) => s.add(q.p), v3(0, 0, 0)).divideScalar(e.length);
      const top = Math.max(...e.map((q) => q.p.y)) - 0.02;
      g.post(c.x, 0, c.z, 0.035, top, col, 8);
      g.post(c.x, 0, c.z, 0.07, 0.035, foot, 8);
      for (let k = 0; k < e.length; k += Math.max(1, Math.floor(e.length / 5))) {
        const q = e[k];
        g.beam(v3(c.x, Math.min(top, q.p.y - 0.06), c.z), base(q), 0.016, col);
      }
    }
  } else if (cell.tier === 6) {
    const e = pts.filter((q) => q.elem);
    if (e.length) {
      const mid = e[Math.floor(e.length / 2)];
      // The inverted middle hangs from a gantry.
      const top = mid.p.y + 0.12;
      for (const side of [-1, 1]) {
        const off = mid.right.clone().setY(0).normalize().multiplyScalar(side * 0.2);
        g.post(mid.p.x + off.x, 0, mid.p.z + off.z, 0.02, top, col, 6);
      }
      const l = mid.right.clone().setY(0).normalize().multiplyScalar(0.2);
      g.beam(v3(mid.p.x - l.x, top, mid.p.z - l.z), v3(mid.p.x + l.x, top, mid.p.z + l.z), 0.03, col);
      g.beam(v3(mid.p.x, top, mid.p.z), mid.p.clone().addScaledVector(mid.up, 0.05), 0.016, col);
    }
  }
}

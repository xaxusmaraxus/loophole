import { Vector3 } from 'three';
import type { Board } from '../puzzle/board';

// The coaster as one continuous 3D centerline with a frame (tangent, up,
// right) at every sample. The laid track forms a single chain through the
// station: the blue end's cells reversed, the station U-turn, then the red
// end's cells, closed into a loop once the circuit opens. Each cell draws its
// own piece: humps, a lift hill and drop, a banked helix, teardrop loops that
// drift sideways so the exit clears the entry, and a heartline corkscrew.
// The train rides the very same samples, so it always sits on the rails.

/** Deck height of each tier's track, in cells. */
export const DECK_H = [0.14, 0.17, 0.2, 0.3, 0.2, 0.2, 0.24, 0.22];
export const STATION_H = 0.13;
/** How far the station U reaches below the station row's top edge. */
const U_LEG = 0.3;
const U_R = 0.5;

export interface ChainCell {
  x: number;
  y: number;
  tier: number;
  station: boolean;
}

export interface TrackPt {
  p: Vector3;
  t: Vector3;
  up: Vector3;
  right: Vector3;
  /** Arc length from the chain start. */
  s: number;
  /** Chain cell index. */
  cell: number;
  lift: boolean;
  /** Inside an element (loop, helix, corkscrew): supports skip these. */
  elem: boolean;
  /** Loop angle (0..2π) inside a loop element, else -1. */
  ang: number;
}

interface ES {
  s: number;
  al?: number;
  la?: number;
  dh?: number;
  /** Up in the local (T, S, Y) frame. */
  up?: [number, number, number];
  lift?: boolean;
  elem?: boolean;
  ang?: number;
}

type Elem = (t: number) => ES;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function cellHash(x: number, y: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000) / 1000;
}

/** A planar loop (along, height) = f(θ) with a lateral drift, between two approach runs. */
function loopElem(shape: (th: number) => [number, number], w0: number, w1: number, drift: number): Elem {
  return (t) => {
    if (t < w0) {
      const u = t / w0;
      return { s: 0.5 * u, la: (-drift / 2) * smooth(0, 1, u) };
    }
    if (t > w1) {
      const u = (t - w1) / (1 - w1);
      return { s: 0.5 + 0.5 * u, la: (drift / 2) * (1 - smooth(0, 1, u)) };
    }
    const u = (t - w0) / (w1 - w0);
    const th = u * Math.PI * 2;
    const [al, dh] = shape(th);
    const e = 1e-3;
    const [a1, h1] = shape(th + e);
    const [a0, h0] = shape(th - e);
    const ta = a1 - a0;
    const th2 = h1 - h0;
    const l = Math.hypot(ta, th2) || 1;
    return { s: 0.5, al, dh, la: drift * (u - 0.5), up: [-th2 / l, 0, ta / l], elem: u > 0.08 && u < 0.92, ang: th };
  };
}

function teardrop(R: number, Ry: number, pinch: number): (th: number) => [number, number] {
  return (th) => {
    const s2 = Math.sin(th / 2) ** 2;
    return [R * Math.sin(th) * (1 - pinch * s2), Ry * (1 - Math.cos(th)) * (1 + 0.08 * s2)];
  };
}

function elemFor(tier: number, turn: number): Elem {
  switch (tier) {
    case 1:
      return (t) => ({ s: t, dh: 0.09 * Math.sin(Math.PI * t) ** 2 });
    case 2:
      return (t) => ({ s: t, dh: 0.28 * Math.sin(Math.PI * t) ** 2 });
    case 3: {
      const top = 0.58;
      return (t) => {
        if (t < 0.46) return { s: t, dh: top * smooth(0.02, 0.44, t), lift: t > 0.04 && t < 0.4 };
        const u = (t - 0.46) / 0.54;
        return { s: t, dh: top * (1 - smooth(0, 0.62, u)) - 0.1 * Math.sin(Math.PI * u) ** 2 };
      };
    }
    case 4: {
      const r = 0.27;
      const climb = 0.3;
      const side = turn || 1;
      return (t) => {
        if (t < 0.18) return { s: (0.5 * t) / 0.18 };
        if (t > 0.82) {
          const u = (t - 0.82) / 0.18;
          return { s: 0.5 + 0.5 * u, dh: climb * (1 - smooth(0, 1, u)) };
        }
        const u = (t - 0.18) / 0.64;
        const ph = u * Math.PI * 2;
        const b = 0.62 * Math.min(1, Math.min(u, 1 - u) * 5);
        const inT = -Math.sin(ph);
        const inS = side * Math.cos(ph);
        return {
          s: 0.5,
          al: r * Math.sin(ph),
          la: side * r * (1 - Math.cos(ph)),
          dh: climb * smooth(0, 1, u),
          up: [inT * Math.sin(b), inS * Math.sin(b), Math.cos(b)],
          elem: true,
        };
      };
    }
    case 5:
      return loopElem(teardrop(0.26, 0.31, 0.2), 0.2, 0.8, 0.15);
    case 6: {
      const hr = 0.09;
      return (t) => {
        if (t < 0.1 || t > 0.9) return { s: t };
        const u = (t - 0.1) / 0.8;
        const ph = Math.PI * 2 * (u * u * u * (u * (u * 6 - 15) + 10));
        const hump = 0.22 * Math.sin(Math.PI * u) ** 2;
        return {
          s: t,
          dh: hump + hr - hr * Math.cos(ph),
          la: -hr * Math.sin(ph),
          up: [0, Math.sin(ph), Math.cos(ph)],
          elem: u > 0.15 && u < 0.85,
        };
      };
    }
    case 7:
      return loopElem(teardrop(0.44, 0.58, 0.3), 0.12, 0.88, 0.24);
    default:
      return (t) => ({ s: t });
  }
}

const SAMPLES = [8, 12, 16, 26, 72, 64, 60, 100];

export class TrackPath {
  cells: ChainCell[];
  closed: boolean;
  pts: TrackPt[] = [];
  /** Per cell: its own samples (sharing end points with its neighbors). */
  seg: TrackPt[][] = [];
  ranges: [number, number][] = [];
  length = 0;

  constructor(cells: ChainCell[], closed: boolean) {
    this.cells = cells;
    this.closed = closed;
    this.build();
  }

  static fromBoard(b: Board): TrackPath {
    const [A, B] = b.ends;
    const st = (end: 0 | 1): ChainCell => ({ x: b.station.x + end, y: b.station.y, tier: 0, station: true });
    const cells: ChainCell[] = [
      ...[...B].reverse().map((c) => ({ x: c.x, y: c.y, tier: c.tier, station: false })),
      st(1),
      st(0),
      ...A.map((c) => ({ x: c.x, y: c.y, tier: c.tier, station: false })),
    ];
    return new TrackPath(cells, b.opened === 'circuit');
  }

  deck(i: number): number {
    const c = this.cells[i];
    return c.station ? STATION_H : DECK_H[c.tier];
  }

  private neighbor(i: number, d: -1 | 1): number {
    const j = i + d;
    const n = this.cells.length;
    if (j >= 0 && j < n) return j;
    return this.closed ? (j + n) % n : -1;
  }

  private build(): void {
    const n = this.cells.length;
    type Raw = { p: Vector3; up: Vector3 | null; lift: boolean; elem: boolean; ang: number; bank: Vector3 | null };
    const raws: Raw[][] = [];
    for (let i = 0; i < n; i++) raws.push(this.cellSamples(i));
    // Frames over the whole chain, so tangents agree at the joints.
    const flat: { r: Raw; cell: number; k: number }[] = [];
    raws.forEach((rs, i) => rs.forEach((r, k) => (i > 0 && k === 0 ? null : flat.push({ r, cell: i, k }))));
    if (this.closed) flat.pop();
    const m = flat.length;
    const tangent = (j: number) => {
      const a = this.closed ? flat[(j - 1 + m) % m].r.p : flat[Math.max(0, j - 1)].r.p;
      const b = this.closed ? flat[(j + 1) % m].r.p : flat[Math.min(m - 1, j + 1)].r.p;
      return b.clone().sub(a).normalize();
    };
    const Y = new Vector3(0, 1, 0);
    const frames = flat.map(({ r }, j) => {
      const t = tangent(j);
      const hint = r.up ?? (r.bank ? Y.clone().add(r.bank).normalize() : Y.clone());
      let right = hint.clone().cross(t);
      if (right.lengthSq() < 1e-8) right = new Vector3(1, 0, 0).cross(t);
      right.normalize();
      const up = t.clone().cross(right).normalize();
      return { t, up, right };
    });
    // One smoothing pass on up vectors takes the edge off element joins.
    const ups = frames.map((f, j) => {
      const a = frames[this.closed ? (j - 1 + m) % m : Math.max(0, j - 1)].up;
      const b = frames[this.closed ? (j + 1) % m : Math.min(m - 1, j + 1)].up;
      return f.up.clone().multiplyScalar(2).add(a).add(b).normalize();
    });
    let s = 0;
    this.pts = flat.map(({ r, cell }, j) => {
      if (j > 0) s += r.p.distanceTo(flat[j - 1].r.p);
      const t = frames[j].t;
      const right = ups[j].clone().cross(t).normalize();
      const up = t.clone().cross(right).normalize();
      return { p: r.p, t, up, right, s, cell, lift: r.lift, elem: r.elem, ang: r.ang };
    });
    this.length = s + (this.closed ? this.pts[m - 1].p.distanceTo(this.pts[0].p) : 0);
    // Per-cell sample lists, sharing joint points with their neighbors.
    this.seg = [];
    this.ranges = [];
    let prevLast: TrackPt | null = null;
    for (let i = 0; i < n; i++) {
      const own = this.pts.filter((p) => p.cell === i);
      const list = prevLast ? [prevLast, ...own] : [...own];
      if (this.closed && i === n - 1) list.push({ ...this.pts[0], s: this.length });
      prevLast = own[own.length - 1] ?? prevLast;
      this.seg.push(list);
      this.ranges.push([list[0].s, list[list.length - 1].s]);
    }
  }

  /** Raw centerline samples for one cell, from its entry edge to its exit edge. */
  private cellSamples(i: number) {
    const c = this.cells[i];
    const pi = this.neighbor(i, -1);
    const ni = this.neighbor(i, 1);
    const hC = this.deck(i);
    const hE = pi >= 0 ? (this.deck(pi) + hC) / 2 : hC;
    const hX = ni >= 0 ? (this.deck(ni) + hC) / 2 : hC;
    if (c.station) return this.stationSamples(i, pi, ni, hE, hX);
    const cx = c.x + 0.5;
    const cz = c.y + 0.5;
    const dirTo = (j: number) => ({ x: Math.sign(this.cells[j].x - c.x), z: Math.sign(this.cells[j].y - c.y) });
    let dout = ni >= 0 ? dirTo(ni) : null;
    let din = pi >= 0 ? (({ x, z }) => ({ x: -x, z: -z }))(dirTo(pi)) : null;
    din ??= dout ?? { x: 0, z: -1 };
    dout ??= din;
    const E = new Vector3(cx - din.x * 0.5, 0, cz - din.z * 0.5);
    const X = new Vector3(cx + dout.x * 0.5, 0, cz + dout.z * 0.5);
    const straight = din.x === dout.x && din.z === dout.z;
    const turn = straight ? (cellHash(c.x, c.y) < 0.5 ? -1 : 1) : Math.sign(din.x * dout.z - din.z * dout.x);
    // Base curve B(σ) with tangent T(σ).
    let base: (s: number) => { p: Vector3; T: Vector3 };
    let L: number;
    let K: Vector3 | null = null;
    if (straight) {
      L = 1;
      base = (s) => ({ p: E.clone().lerp(X, s), T: new Vector3(dout.x, 0, dout.z) });
    } else {
      L = Math.PI / 4;
      K = new Vector3(cx + (dout.x - din.x) * 0.5, 0, cz + (dout.z - din.z) * 0.5);
      const a0 = Math.atan2(E.z - K.z, E.x - K.x);
      let da = Math.atan2(X.z - K.z, X.x - K.x) - a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const k = K;
      base = (s) => {
        const a = a0 + da * s;
        const p = new Vector3(k.x + Math.cos(a) * 0.5, 0, k.z + Math.sin(a) * 0.5);
        const T = new Vector3(-Math.sin(a) * Math.sign(da), 0, Math.cos(a) * Math.sign(da));
        return { p, T };
      };
    }
    const h0 = (s: number) => (s < 0.5 ? hE + (hC - hE) * smooth(0, 1, s / 0.5) : hC + (hX - hC) * smooth(0, 1, (s - 0.5) / 0.5));
    // A helix or loop on a corner is laid along the corner's diagonal.
    const turnSide = turn;
    const elem = elemFor(c.tier, turnSide);
    const N = SAMPLES[c.tier];
    const Y = new Vector3(0, 1, 0);
    const out = [];
    for (let k = 0; k <= N; k++) {
      const e = elem(k / N);
      const { p, T } = base(e.s);
      const S = Y.clone().cross(T);
      const pos = p
        .clone()
        .addScaledVector(T, (e.al ?? 0) * (straight ? 1 : 0.9))
        .addScaledVector(S, e.la ?? 0)
        .setY(h0(e.s) + (e.dh ?? 0));
      const up = e.up ? T.clone().multiplyScalar(e.up[0]).addScaledVector(S, e.up[1]).addScaledVector(Y, e.up[2]) : null;
      // Plain corners bank into the turn.
      let bank: Vector3 | null = null;
      if (!straight && K && c.tier <= 3) bank = K.clone().sub(p).setY(0).normalize().multiplyScalar(0.42 * Math.sin(Math.PI * e.s));
      out.push({ p: pos, up, lift: !!e.lift, elem: !!e.elem, ang: e.ang ?? -1, bank });
    }
    return out;
  }

  /** The station U: straight legs down from each station cell's top edge, joined by a half circle. */
  private stationSamples(i: number, _pi: number, _ni: number, hE: number, hX: number) {
    const c = this.cells[i];
    const n = c.y;
    // st1 (the right cell) comes first in the chain: down its leg, then half the U.
    const right = this.cells[i + 1]?.station === true;
    const xc = right ? c.x : c.x + 1; // the U's center line, between the two cells
    const top = n;
    const out = [];
    const legN = 6;
    const arcN = 14;
    const hEdge = right ? hE : hX;
    const hAt = (s: number) => STATION_H + (hEdge - STATION_H) * (1 - smooth(0, 1, s));
    if (right) {
      for (let k = 0; k <= legN; k++) {
        const s = k / legN;
        out.push(new Vector3(xc + 0.5, hAt(s), top + U_LEG * s));
      }
      for (let k = 1; k <= arcN; k++) {
        const a = (Math.PI / 2) * (k / arcN);
        out.push(new Vector3(xc + Math.cos(a) * U_R, STATION_H, top + U_LEG + Math.sin(a) * U_R));
      }
    } else {
      for (let k = 0; k <= arcN; k++) {
        const a = Math.PI / 2 + (Math.PI / 2) * (k / arcN);
        out.push(new Vector3(xc + Math.cos(a) * U_R, STATION_H, top + U_LEG + Math.sin(a) * U_R));
      }
      for (let k = 1; k <= legN; k++) {
        const s = 1 - k / legN;
        out.push(new Vector3(xc - 0.5, hAt(s), top + U_LEG * s));
      }
    }
    return out.map((p) => ({ p, up: null, lift: false, elem: false, ang: -1, bank: null }));
  }

  /** Frame at arc length s (wraps on a closed track, clamps on an open one). */
  sample(s: number): { p: Vector3; t: Vector3; up: Vector3; right: Vector3; cell: number; lift: boolean } {
    const L = this.length;
    if (this.closed) s = ((s % L) + L) % L;
    else s = Math.max(0, Math.min(this.pts[this.pts.length - 1].s, s));
    const pts = this.pts;
    let lo = 0;
    let hi = pts.length - 1;
    if (s >= pts[hi].s) {
      if (!this.closed) {
        const q = pts[hi];
        return { p: q.p.clone(), t: q.t.clone(), up: q.up.clone(), right: q.right.clone(), cell: q.cell, lift: q.lift };
      }
      // Between the last sample and the first, around the closing joint.
      const a = pts[hi];
      const b = pts[0];
      const k = (s - a.s) / Math.max(1e-6, L - a.s);
      return this.mix(a, b, k);
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    return this.mix(a, b, (s - a.s) / Math.max(1e-6, b.s - a.s));
  }

  private mix(a: TrackPt, b: TrackPt, k: number) {
    const p = a.p.clone().lerp(b.p, k);
    const t = a.t.clone().lerp(b.t, k).normalize();
    const upH = a.up.clone().lerp(b.up, k);
    const right = upH.cross(t).normalize();
    const up = t.clone().cross(right).normalize();
    return { p, t, up, right, cell: k < 0.5 ? a.cell : b.cell, lift: a.lift && b.lift };
  }

  /** Arc length where the given chain cell's samples start and end. */
  range(i: number): [number, number] {
    return this.ranges[i];
  }

  /** Chain index of a grid cell (or -1). */
  indexOf(x: number, y: number): number {
    return this.cells.findIndex((c) => c.x === x && c.y === y);
  }

  /** Highest point of the track. */
  maxHeight(): number {
    return this.pts.reduce((m, p) => Math.max(m, p.p.y), 0);
  }
}

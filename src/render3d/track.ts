import { Vector3 } from 'three';
import type { Board } from '../puzzle/board';
import { type Flavor, LIFT, PIECES, type SpecialId, liftPlan } from '../puzzle/pieces';

// The coaster as one continuous 3D centerline with a frame (tangent, up,
// right) at every sample. The laid track forms a single chain through the
// station: the blue end's cells reversed, the station U-turn, then the red
// end's cells, closed into a loop once the circuit opens. The train rides the
// chain in index order (from the left platform cell round to the right one).
//
// The track cruises at one steady height; only named elements leave it (v0.25):
// a smooth airtime hump, a chain lift that climbs and stays up (consecutive
// lifts stack), a banked helix, a big vertical loop, a heartline corkscrew, a
// cobra roll (two leaning half-loops, a hood seen head on) and a tall top hat.
// The element after a lift chain dives off the stored height and is drawn
// bigger; height nobody cashes in dives into the station as a finale drop.
// The train rides the very same samples, so it always sits on the rails.

/** The steady cruising height of all track, in cells. */
export const CRUISE_H = 0.24;
/** Deck height of each tier's track, in cells: one cruising height for all (no spikes between cells). */
export const DECK_H = PIECES.map(() => CRUISE_H);
/** Each Lift Hill in a chain climbs this much higher, up to LIFT_MAX. */
export const LIFT_STEP = 0.34;
export const LIFT_MAX = 1.45;
const liftH = (lv: number) => Math.min(LIFT_MAX, lv * LIFT_STEP);
/** How much bigger the element after a lift chain is drawn, by its multiplier (capped). */
export const payoffScale = (mult: number) => Math.min(1.45, 1 + 0.15 * Math.max(0, mult - 1));
export const STATION_H = 0.15;
/**
 * The station runs the full width of the board's bottom edge: the track comes
 * down from the blue end's cell, runs along an upper lane to the right end,
 * turns, runs back along a long lower lane (where the train waits), turns up
 * and runs along the upper lane again into the red end's cell.
 */
export interface StationLayout {
  xL: number;
  xR: number;
  zU: number;
  zD: number;
  R: number;
  rc: number;
  x0: number;
  x1: number;
}

/** How far the pieces next to the station already lean into its turns. */
const STATION_LEAN = 0.3;

export function stationLayout(stationX: number, n: number): StationLayout {
  const rc = 0.2;
  const zU = n + 0.42;
  const zD = n + 1.0;
  const R = (zD - zU) / 2;
  const x0 = stationX + 0.5;
  const x1 = stationX + 1.5;
  const xL = Math.min(0.3, x0 - rc - 0.08);
  const xR = Math.max(n - 0.3, x1 + rc + 0.08);
  return { xL, xR, zU, zD, R, rc, x0, x1 };
}

export interface ChainCell {
  x: number;
  y: number;
  tier: number;
  station: boolean;
  cross?: boolean;
  pier?: boolean;
  special?: SpecialId;
  /** A park piece: spinning cars, a flume, or a suspended (hanging) run. */
  flavor?: Flavor | null;
}

/** A hanging run is carried high on its gantry, so the train can hang under the rail. */
export const HANG_LIFT = 0.42;

/** How a crossing pass gets past the track it crosses: over it, or under it. */
export type CrossKind = 'bridge' | 'tunnel';

/** A bridge clears the flat track below it by this much. */
const BRIDGE_RISE = 0.44;
/** A tunnel runs this high above the ground. */
const TUNNEL_H = 0.07;

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

export function teardrop(R: number, Ry: number, pinch: number): (th: number) => [number, number] {
  return (th) => {
    const s2 = Math.sin(th / 2) ** 2;
    return [R * Math.sin(th) * (1 - pinch * s2), Ry * (1 - Math.cos(th)) * (1 + 0.08 * s2)];
  };
}

/**
 * A planar loop shape (along, height) whose top leans over by up to `lean`
 * radians (+ leans back), easing in from upright at the bottom so the run in
 * and out stay level. Returns the position and the (inward) up vector.
 */
export function leaningLoop(shape: (th: number) => [number, number], th: number, lean: number): { al: number; dh: number; up: [number, number, number] } {
  const at = (a: number): [number, number] => {
    const [al, h] = shape(a);
    const b = lean * Math.sin(a / 2) ** 2;
    return [al * Math.cos(b) - h * Math.sin(b), al * Math.sin(b) + h * Math.cos(b)];
  };
  const [al, dh] = at(th);
  const e = 1e-3;
  const [a1, h1] = at(th + e);
  const [a0, h0] = at(th - e);
  const ta = a1 - a0;
  const tY = h1 - h0;
  const l = Math.hypot(ta, tY) || 1;
  return { al, dh, up: [-tY / l, 0, ta / l] };
}

/** The Top Hat's profile: run in, curve up into a vertical climb, round the crown, straight down, run out. */
export function topHatProfile(H: number): (t: number) => { s: number; dh: number; ts: number; tY: number; hat: boolean } {
  const rq = 0.13;
  const rt = 0.22;
  const x0 = 0.5 - rt - rq;
  const xL = 0.5 - rt;
  const xR = 0.5 + rt;
  const leg = Math.max(0.05, H - rt - rq);
  type Seg = { len: number; at: (u: number) => [number, number, number, number] };
  const segs: Seg[] = [
    { len: x0, at: (u) => [x0 * u, 0, 1, 0] },
    { len: (Math.PI / 2) * rq, at: (u) => { const a = (u * Math.PI) / 2; return [x0 + rq * Math.sin(a), rq - rq * Math.cos(a), Math.cos(a), Math.sin(a)]; } },
    { len: leg, at: (u) => [xL, rq + leg * u, 0, 1] },
    { len: Math.PI * rt, at: (u) => { const a = Math.PI - u * Math.PI; return [0.5 + rt * Math.cos(a), rq + leg + rt * Math.sin(a), Math.sin(a), -Math.cos(a)]; } },
    { len: leg, at: (u) => [xR, rq + leg * (1 - u), 0, -1] },
    { len: (Math.PI / 2) * rq, at: (u) => { const a = (u * Math.PI) / 2; return [xR + rq - rq * Math.cos(a), rq - rq * Math.sin(a), Math.sin(a), -Math.cos(a)]; } },
    { len: 1 - xR - rq, at: (u) => [xR + rq + (1 - xR - rq) * u, 0, 1, 0] },
  ];
  const total = segs.reduce((a, g) => a + g.len, 0);
  return (t) => {
    let d = t * total;
    for (const [k, g] of segs.entries()) {
      if (d <= g.len || k === segs.length - 1) {
        const [s, dh, ts, tY] = g.at(Math.min(1, d / g.len));
        return { s, dh, ts, tY, hat: k >= 1 && k <= 5 };
      }
      d -= g.len;
    }
    return { s: 1, dh: 0, ts: 1, tY: 0, hat: false };
  };
}

/** Each tier's element on its cell, `k` times its normal size (the payoff after a lift chain). */
function elemFor(tier: number, turn: number, k = 1): Elem {
  switch (tier) {
    case 1:
      // Airtime Hill: one smooth, gentle camel hump.
      return (t) => ({ s: t, dh: 0.24 * k * Math.sin(Math.PI * t) ** 2 });
    case 2:
      // Lift Hill: the climb is in the base height (see TrackPath.levels); here it's the chain.
      return (t) => ({ s: t, lift: t > 0.03 && t < 0.97 });
    case 3: {
      // Helix: one banked turn spiralling up round the cell and back down.
      const r = 0.32 * Math.min(1.15, k);
      const climb = 0.24 * k;
      const side = turn || 1;
      return (t) => {
        if (t < 0.14) return { s: (0.39 * t) / 0.14 };
        if (t > 0.86) return { s: 0.61 + (0.39 * (t - 0.86)) / 0.14 };
        const u = (t - 0.14) / 0.72;
        const ph = u * Math.PI * 2;
        const b = 1.05 * Math.min(1, Math.min(u, 1 - u) * 4);
        const inT = -Math.sin(ph);
        const inS = side * Math.cos(ph);
        return {
          s: 0.39 + 0.22 * u,
          al: r * Math.sin(ph),
          la: side * r * (1 - Math.cos(ph)),
          dh: climb * Math.sin(Math.PI * u) ** 2,
          up: [inT * Math.sin(b), inS * Math.sin(b), Math.cos(b)],
          elem: true,
        };
      };
    }
    case 4:
      // Vertical Loop: a big round teardrop loop.
      return loopElem(teardrop(0.42 * k, 0.66 * k, 0.24), 0.18, 0.82, 0.2 * Math.min(1.2, k));
    case 5: {
      // Corkscrew: a heartline barrel roll over a low hump.
      const hr = 0.19 * Math.min(1.25, k);
      return (t) => {
        if (t < 0.08 || t > 0.92) return { s: t };
        const u = (t - 0.08) / 0.84;
        const ph = Math.PI * 2 * (u * u * u * (u * (u * 6 - 15) + 10));
        const hump = 0.3 * k * Math.sin(Math.PI * u) ** 2;
        return {
          s: t,
          dh: hump + hr - hr * Math.cos(ph),
          la: -hr * Math.sin(ph),
          up: [0, Math.sin(ph), Math.cos(ph)],
          elem: u > 0.12 && u < 0.88,
          ang: u > 0.12 && u < 0.88 ? ph : -1,
        };
      };
    }
    case 6: {
      // Cobra Roll: two loops back to back, their tops leaning apart like a cobra's hood.
      const lobe = teardrop(0.25 * k, 0.5 * k, 0.3);
      const lean = 0.45;
      return (t) => {
        if (t < 0.1) return { s: (0.26 * t) / 0.1 };
        if (t > 0.9) return { s: 0.74 + (0.26 * (t - 0.9)) / 0.1 };
        const u = (t - 0.1) / 0.8;
        const second = u >= 0.5;
        const v = second ? (u - 0.5) * 2 : u * 2;
        const th = v * Math.PI * 2;
        const L = leaningLoop(lobe, th, second ? -lean : lean);
        // A little sideways drift keeps each lobe's way in clear of its way out.
        const la = 0.1 * Math.min(1, k) * Math.sin(Math.PI * u);
        return { s: 0.26 + 0.48 * u, al: L.al, la, dh: L.dh, up: L.up, elem: v > 0.1 && v < 0.9, ang: th + (second ? Math.PI * 2 : 0) };
      };
    }
    case 7: {
      // Top Hat: straight up, over a round crown, straight down. The one tall spike, and it has a name.
      const hat = topHatProfile(1.2 * Math.min(k, 1.15));
      return (t) => {
        const q = hat(t);
        const l = Math.hypot(q.ts, q.tY) || 1;
        return { s: q.s, dh: q.dh, up: q.hat ? [-q.tY / l, 0, q.ts / l] : undefined, elem: q.hat && Math.abs(q.tY / l) > 0.6, ang: q.hat ? t * Math.PI * 2 : -1 };
      };
    }
    default:
      return (t) => ({ s: t });
  }
}

const SAMPLES = [10, 20, 18, 72, 80, 76, 120, 110];

/** Where the stored lift height stands on each cell (its entry, middle and exit), and what it does there. */
export interface CellLevel {
  hIn: number;
  hMid: number;
  hOut: number;
  /** The lift-chain multiplier this element cashes in (1: none). */
  mult: number;
  /** Lifts paid off as a finale drop into the station (on the last lift of a chain). */
  finale: number;
  /** Lift cells: is the cell before / after this one also climbing? (For a straight ramp through the chain.) */
  liftIn: boolean;
  liftOut: boolean;
}

export class TrackPath {
  cells: ChainCell[];
  closed: boolean;
  pts: TrackPt[] = [];
  /** Per cell: its own samples (sharing end points with its neighbors). */
  seg: TrackPt[][] = [];
  ranges: [number, number][] = [];
  length = 0;
  /** Where the lead car waits: the left end of the station's lower lane. */
  parkAt = 0;

  /** Crossing passes (chain index) and whether each goes over or under. */
  crossKind = new Map<number, CrossKind>();
  /** Ground under the board (hills) and how high the station stands. */
  private ground: (x: number, y: number) => number;
  private lift: number;

  /** Per chain cell: the lift height it carries and what it cashes in (see levels()). */
  levels: CellLevel[] = [];

  constructor(cells: ChainCell[], closed: boolean, ground: (x: number, y: number) => number = () => 0, lift = 0) {
    this.cells = cells;
    this.closed = closed;
    this.ground = ground;
    this.lift = lift;
    this.levels = this.computeLevels();
    // Crossings: over flat track the second pass is a bridge; under any piece, a tunnel.
    cells.forEach((c, i) => {
      if (!c.cross) return;
      const under = cells.find((o) => !o.cross && !o.station && o.x === c.x && o.y === c.y);
      this.crossKind.set(i, under && under.tier > 0 ? 'tunnel' : 'bridge');
    });
    this.build();
  }

  static fromBoard(b: Board, ground?: (x: number, y: number) => number, lift = 0): TrackPath {
    const [A, B] = b.ends;
    const st = (end: 0 | 1): ChainCell => ({ x: b.station.x + end, y: b.station.y, tier: 0, station: true });
    const cells: ChainCell[] = [
      ...[...B].reverse().map((c) => ({ ...c, station: false })),
      st(1),
      st(0),
      ...A.map((c) => ({ ...c, station: false })),
    ];
    // The always-running loop (v0.23) is closed from the start: the last piece runs back down into the platform.
    return new TrackPath(cells, b.opened === 'circuit' || !!b.loop, ground, lift);
  }

  /** Ground height under a board cell (hills). */
  groundAt(x: number, y: number): number {
    return this.ground(x, y);
  }

  deck(i: number): number {
    const c = this.cells[i];
    if (c.station) return STATION_H + this.lift;
    const g = this.ground(c.x, c.y);
    const k = this.crossKind.get(i);
    if (k === 'bridge') return DECK_H[0] + g + BRIDGE_RISE;
    if (k === 'tunnel') return TUNNEL_H + g;
    return DECK_H[c.tier] + g + (c.flavor === 'hang' ? HANG_LIFT : 0);
  }

  /** Chain indices in the order the train rides them: from the left platform cell (st0) round to the right one. */
  rideOrder(): number[] {
    const n = this.cells.length;
    let s0 = -1;
    for (let i = 0; i < n; i++) if (this.cells[i].station && !this.cells[i + 1]?.station) s0 = i;
    if (s0 < 0) return this.cells.map((_, i) => i).filter((i) => !this.cells[i].station);
    const out: number[] = [];
    for (let k = 1; k < n; k++) {
      const i = (s0 + k) % n;
      if (!this.cells[i].station) out.push(i);
    }
    return out;
  }

  /**
   * Lift Hills store height (liftPlan): each lift in a chain climbs a step and the
   * track stays up there (over Flats too) until the next proper element dives off
   * it, drawn bigger for the multiplier it cashes in. Height left at the end of the
   * ride: the last lift crests and dives into the station (the finale).
   */
  private computeLevels(): CellLevel[] {
    const lv: CellLevel[] = this.cells.map(() => ({ hIn: 0, hMid: 0, hOut: 0, mult: 1, finale: 0, liftIn: false, liftOut: false }));
    const order = this.rideOrder();
    const plan = liftPlan(order.map((i) => this.cells[i]));
    let level = 0;
    const isLift = (i: number | undefined) => i !== undefined && this.cells[i].tier === LIFT && !this.cells[i].station;
    order.forEach((i, k) => {
      const c = this.cells[i];
      const L = lv[i];
      L.hIn = liftH(level);
      if (c.tier === LIFT) {
        L.finale = plan.finale[k];
        if (L.finale) {
          L.hMid = liftH(level + 1) + 0.12;
          L.hOut = 0;
          level = 0;
        } else {
          level++;
          L.hOut = liftH(level);
          L.hMid = (L.hIn + L.hOut) / 2;
        }
        L.liftIn = isLift(order[k - 1]) && L.hIn > 0;
        L.liftOut = !L.finale && isLift(order[k + 1]);
      } else if (c.tier > 0) {
        L.mult = plan.mult[k];
        L.hMid = 0;
        L.hOut = 0;
        level = 0;
      } else {
        L.hMid = L.hIn;
        L.hOut = L.hIn;
      }
    });
    return lv;
  }

  private neighbor(i: number, d: -1 | 1): number {
    const j = i + d;
    const n = this.cells.length;
    if (j >= 0 && j < n) return j;
    return this.closed ? (j + n) % n : -1;
  }

  private build(): void {
    const n = this.cells.length;
    type Raw = { p: Vector3; up: Vector3 | null; lift: boolean; elem: boolean; ang: number; bank: Vector3 | null; park?: boolean };
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
    const pk = flat.findIndex((f) => f.r.park);
    this.parkAt = pk >= 0 ? this.pts[pk].s : 0;
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
    const dC = this.deck(i);
    if (c.station) return this.stationSamples(i, pi, ni, dC, dC);
    const lv = this.levels[i];
    const hC = dC + lv.hMid;
    const hE = (pi >= 0 ? (this.deck(pi) + dC) / 2 : dC) + lv.hIn;
    const hX = (ni >= 0 ? (this.deck(ni) + dC) / 2 : dC) + lv.hOut;
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
    // Cubic Hermite from a to b with end slopes m0, m1 (in height per unit of x).
    const herm = (a: number, b: number, m0: number, m1: number, x: number) => {
      const x2 = x * x;
      const x3 = x2 * x;
      return (2 * x3 - 3 * x2 + 1) * a + (x3 - 2 * x2 + x) * m0 + (-2 * x3 + 3 * x2) * b + (x3 - x2) * m1;
    };
    let h0 = (s: number) => (s < 0.5 ? hE + (hC - hE) * smooth(0, 1, s / 0.5) : hC + (hX - hC) * smooth(0, 1, (s - 0.5) / 0.5));
    const isLift = c.tier === LIFT;
    if (isLift && lv.finale) {
      // The finale: one last climb on the chain, a crest, and a big dive down into the station.
      const m0 = lv.liftIn ? LIFT_STEP : 0;
      h0 = (s) => (s < 0.55 ? herm(hE, hC, m0 * 0.55, 0, s / 0.55) : hC + (hX - hC) * smooth(0, 1, (s - 0.55) / 0.45) ** 1.4);
    } else if (isLift) {
      // A straight chain ramp: easing in and out only where the chain starts and stops.
      const d = hX - hE;
      h0 = (s) => herm(hE, hX, lv.liftIn ? d : 0, lv.liftOut ? d : 0, s);
    }
    // A helix or loop on a corner is laid along the corner's diagonal.
    const turnSide = turn;
    const big = payoffScale(lv.mult);
    const elem = elemFor(c.tier, turnSide, big);
    const N = SAMPLES[c.tier] + (lv.mult > 1 ? 16 : 0);
    const Y = new Vector3(0, 1, 0);
    // Into st1 the station turns toward +x; out of st0 it comes from -x.
    const stationLean =
      ni >= 0 && this.cells[ni].station ? { into: true, dx: 1 } : pi >= 0 && this.cells[pi].station ? { into: false, dx: -1 } : null;
    const out = [];
    for (let j = 0; j <= N; j++) {
      const e = elem(j / N);
      // The finale lift's chain stops at the crest.
      if (isLift && lv.finale && e.s > 0.5) e.lift = false;
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
      if (!straight && K && !e.up) bank = K.clone().sub(p).setY(0).normalize().multiplyScalar(0.42 * Math.sin(Math.PI * e.s));
      // The piece into (or out of) the station already leans toward the station's turn.
      if (stationLean && !e.up) {
        const k = STATION_LEAN * (stationLean.into ? smooth(0.15, 1, e.s) : 1 - smooth(0, 0.85, e.s));
        bank = (bank ?? new Vector3()).add(new Vector3(stationLean.dx * k, 0, 0));
      }
      out.push({ p: pos, up, lift: !!e.lift, elem: !!e.elem, ang: e.ang ?? -1, bank });
    }
    return out;
  }

  /** The long station loop, split between the two station cells at the middle of the lower lane. */
  private stationSamples(i: number, _pi: number, _ni: number, hE: number, hX: number) {
    const c = this.cells[i];
    const n = c.y;
    // st1 (the right cell) comes first in the chain.
    const first = this.cells[i + 1]?.station === true;
    const stX = first ? c.x - 1 : c.x;
    const L = stationLayout(stX, n);
    const { xL, xR, zU, zD, R, rc, x0, x1 } = L;
    // Edge heights: st1's top edge (blue end) and st0's top edge (red end).
    const j1 = first ? i : i - 1;
    const j0 = first ? i + 1 : i;
    const hTop1 = this.edgeHeight(j1, -1);
    const hTop0 = this.edgeHeight(j0, 1);
    // b: bank toward a turn's centre (cx, cz) by k, so the train leans into the station's turns.
    type S = { p: Vector3; park?: boolean; b?: { cx: number; cz: number; k: number } };
    const pts: S[] = [];
    const H = STATION_H + this.lift;
    const ramp = (h: number, k: number) => H + (h - H) * (1 - smooth(0, 1, k));
    type Bank = { cx: number; cz: number; k0: number; k1: number };
    const line = (ax: number, az: number, bx: number, bz: number, steps: number, h0?: number, bank?: Bank) => {
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const b = bank ? { cx: bank.cx, cz: bank.cz, k: bank.k0 + (bank.k1 - bank.k0) * smooth(0, 1, t) } : undefined;
        pts.push({ p: new Vector3(ax + (bx - ax) * t, h0 === undefined ? H : ramp(h0, t), az + (bz - az) * t), b });
      }
    };
    const arc = (cx: number, cz: number, r: number, a0: number, a1: number, steps: number, k = 0.5, soft = false) => {
      for (let j = 1; j <= steps; j++) {
        const u = j / steps;
        const a = a0 + (a1 - a0) * u;
        pts.push({ p: new Vector3(cx + Math.cos(a) * r, H, cz + Math.sin(a) * r), b: { cx, cz, k: soft ? k * Math.sin(Math.PI * u) : k } });
      }
    };
    const BK = 0.55;
    // Down from the blue end, onto the upper lane heading right.
    pts.push({ p: new Vector3(x1, hTop1, n) });
    // The drop into the station already leans into the turn.
    line(x1, n, x1, zU - rc, 5, hTop1, { cx: x1 + rc, cz: zU - rc, k0: STATION_LEAN, k1: BK });
    arc(x1 + rc, zU - rc, rc, Math.PI, Math.PI / 2, 6, BK);
    const out1 = Math.min(0.3, (xR - x1 - rc) * 0.5);
    line(x1 + rc, zU, x1 + rc + out1, zU, 3, undefined, { cx: x1 + rc, cz: zU - rc, k0: BK, k1: 0 });
    line(x1 + rc + out1, zU, xR, zU, Math.max(2, Math.round((xR - x1 - rc - out1) * 8)));
    // Round the right end and back along the lower lane.
    arc(xR, zU + R, R, -Math.PI / 2, Math.PI / 2, 12, 0.4, true);
    const mid = (xL + xR) / 2;
    line(xR, zD, mid, zD, Math.max(2, Math.round((xR - mid) * 8)));
    const split = pts.length - 1;
    line(mid, zD, xL + 0.12, zD, Math.max(2, Math.round((mid - xL) * 8)));
    pts[pts.length - 1].park = true;
    line(xL + 0.12, zD, xL, zD, 1);
    // Round the left end, along the upper lane, and up into the red end.
    arc(xL, zU + R, R, Math.PI / 2, (3 * Math.PI) / 2, 12, 0.4, true);
    const in0 = Math.min(0.3, (x0 - rc - xL) * 0.5);
    line(xL, zU, x0 - rc - in0, zU, Math.max(2, Math.round((x0 - rc - in0 - xL) * 8)));
    line(x0 - rc - in0, zU, x0 - rc, zU, 3, undefined, { cx: x0 - rc, cz: zU - rc, k0: 0, k1: BK });
    arc(x0 - rc, zU - rc, rc, Math.PI / 2, 0, 6, BK);
    for (let k = 1; k <= 5; k++) {
      const t = k / 5;
      pts.push({ p: new Vector3(x0, ramp(hTop0, 1 - t), zU - rc + (n - (zU - rc)) * t), b: { cx: x0 - rc, cz: zU - rc, k: BK * (1 - smooth(0, 1, t)) + STATION_LEAN * smooth(0, 1, t) } });
    }
    const part = first ? pts.slice(0, split + 1) : pts.slice(split);
    void hE;
    void hX;
    return part.map(({ p, park, b }) => ({
      p,
      up: null,
      lift: false,
      elem: false,
      ang: -1,
      bank: b && b.k > 0.001 ? new Vector3(b.cx - p.x, 0, b.cz - p.z).normalize().multiplyScalar(b.k) : null,
      park: !!park,
    }));
  }

  /** Height where a station cell meets its neighbour up in the board (dir -1: previous, 1: next). */
  private edgeHeight(i: number, dir: -1 | 1): number {
    const j = this.neighbor(i, dir);
    const h = STATION_H + this.lift;
    return j >= 0 && !this.cells[j].station ? (this.deck(j) + h) / 2 : h;
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

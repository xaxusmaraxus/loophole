import type { Rng } from '../core/rng';
import { MAX_TIER } from './pieces';

// Two separate actions:
//  - Swipe: 2048 rules. Loose tiles slide and merge, fresh merges chain.
//  - Build: turn the tile next to one of the two track ends into track.
// The track grows from both sides of the station. When the two ends meet,
// the circuit can open as a full ride; before that, as a half-price shuttle.
// Laid track is a wall that loose tiles can't pass.

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
export const DELTA: Record<Dir, Pt> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export interface Pt {
  x: number;
  y: number;
}

export interface TrackCell extends Pt {
  tier: number;
}

export type ObstacleKind = 'tree' | 'rock' | 'pond' | 'stand';
export type End = 0 | 1;

export interface Board {
  size: number;
  /** Tile tier per cell; 0 = empty. */
  tiles: number[];
  obstacles: (ObstacleKind | null)[];
  station: Pt;
  /** Track grown out of each side of the station, in build order. */
  ends: [TrackCell[], TrackCell[]];
  opened: 'circuit' | 'shuttle' | null;
}

/** Track cells needed before the circuit may close (smallest loop is 2x2). */
export const MIN_LOOP = 3;

export function idx(b: Board, x: number, y: number): number {
  return y * b.size + x;
}

export function inBounds(b: Board, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < b.size && y < b.size;
}

export function samePt(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y;
}

export function adjacent(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

export function trackCells(b: Board): TrackCell[] {
  return [...b.ends[0], ...b.ends[1]];
}

export function trackAt(b: Board, x: number, y: number): TrackCell | undefined {
  return b.ends[0].find((c) => c.x === x && c.y === y) ?? b.ends[1].find((c) => c.x === x && c.y === y);
}

export function trackLength(b: Board): number {
  return b.ends[0].length + b.ends[1].length;
}

export function isWall(b: Board, x: number, y: number): boolean {
  if (!inBounds(b, x, y)) return true;
  if (b.obstacles[idx(b, x, y)]) return true;
  if (b.station.x === x && b.station.y === y) return true;
  return !!trackAt(b, x, y);
}

export function head(b: Board, end: End): Pt {
  const e = b.ends[end];
  return e.length ? e[e.length - 1] : b.station;
}

export function step(p: Pt, dir: Dir): Pt {
  return { x: p.x + DELTA[dir].x, y: p.y + DELTA[dir].y };
}

export interface BuildTarget extends Pt {
  end: End;
}

/** Cells the given end (or either end) could build into next. */
export function buildTargets(b: Board, only?: End): BuildTarget[] {
  if (b.opened) return [];
  const out: BuildTarget[] = [];
  for (const end of [0, 1] as End[]) {
    if (only !== undefined && end !== only) continue;
    for (const d of DIRS) {
      const t = step(head(b, end), d);
      if (!isWall(b, t.x, t.y)) out.push({ ...t, end });
    }
  }
  return out;
}

/** The two ends meet: the ride can open as a full circuit. */
export function canConnect(b: Board): boolean {
  if (b.opened || trackLength(b) < MIN_LOOP) return false;
  const [a, c] = [head(b, 0), head(b, 1)];
  return !samePt(a, c) && adjacent(a, c);
}

export function canShuttle(b: Board): boolean {
  return !b.opened && trackLength(b) >= 1;
}

export function isBoxedIn(b: Board): boolean {
  return !b.opened && !canConnect(b) && buildTargets(b).length === 0;
}

/** Lays the tile at (x, y) into the track from the given end. */
export function build(b: Board, end: End, x: number, y: number): TrackCell | null {
  if (!buildTargets(b, end).some((t) => t.x === x && t.y === y)) return null;
  const i = idx(b, x, y);
  const laid: TrackCell = { x, y, tier: b.tiles[i] };
  b.tiles[i] = 0;
  b.ends[end].push(laid);
  return laid;
}

export interface RideStop extends Pt {
  tier: number;
  station: boolean;
}

/** The order the train visits cells, from station back to station. */
export function rideOrder(b: Board, kind: 'circuit' | 'shuttle'): RideStop[] {
  const st: RideStop = { ...b.station, tier: 0, station: true };
  const cells = (e: TrackCell[]) => e.map((c) => ({ ...c, station: false }));
  const [a, c] = [cells(b.ends[0]), cells(b.ends[1])];
  if (kind === 'circuit') return [st, ...a, ...[...c].reverse(), st];
  // Shuttle: out along each end and back again.
  const out: RideStop[] = [st];
  for (const e of [a, c]) if (e.length) out.push(...e, ...[...e].reverse().slice(1), st);
  return out;
}

/** Neighbors each track cell (and the station) is connected to, for drawing rails. */
export function trackLinks(b: Board): Map<string, Pt[]> {
  const key = (p: Pt) => `${p.x},${p.y}`;
  const links = new Map<string, Pt[]>();
  const link = (p: Pt, q: Pt) => {
    for (const [u, v] of [
      [p, q],
      [q, p],
    ]) {
      const l = links.get(key(u)) ?? [];
      l.push(v);
      links.set(key(u), l);
    }
  };
  for (const e of b.ends) e.forEach((c, i) => link(i === 0 ? b.station : e[i - 1], c));
  if (b.opened === 'circuit') link(head(b, 0), head(b, 1));
  return links;
}

export function cloneBoard(b: Board): Board {
  return {
    ...b,
    tiles: [...b.tiles],
    obstacles: [...b.obstacles],
    station: { ...b.station },
    ends: [b.ends[0].map((c) => ({ ...c })), b.ends[1].map((c) => ({ ...c }))],
  };
}

// ---- Swiping ----------------------------------------------------------------

export interface SlideMove {
  from: Pt;
  to: Pt;
  tier: number;
  merged: boolean;
}

export interface SlideResult {
  tiles: number[];
  slides: SlideMove[];
  merges: TrackCell[];
  moved: boolean;
}

export function slide(b: Board, dir: Dir): SlideResult {
  const n = b.size;
  const d = DELTA[dir];
  const tiles = new Array<number>(n * n).fill(0);
  const slides: SlideMove[] = [];
  const merges: TrackCell[] = [];
  const reversed = d.x === 1 || d.y === 1;
  let moved = false;

  for (let lane = 0; lane < n; lane++) {
    // Leading edge first, so tiles pile up against it.
    const line: Pt[] = [];
    for (let k = 0; k < n; k++) {
      const s = reversed ? n - 1 - k : k;
      line.push(d.x !== 0 ? { x: s, y: lane } : { x: lane, y: s });
    }
    let dest = 0;
    let last: { pos: number; tier: number; merged: boolean } | null = null;
    for (let i = 0; i < n; i++) {
      const p = line[i];
      if (isWall(b, p.x, p.y)) {
        dest = i + 1;
        last = null;
        continue;
      }
      const tier = b.tiles[idx(b, p.x, p.y)];
      if (!tier) continue;
      if (last && !last.merged && last.tier === tier && tier < MAX_TIER) {
        const q = line[last.pos];
        last.tier = tier + 1;
        last.merged = true;
        tiles[idx(b, q.x, q.y)] = last.tier;
        slides.push({ from: p, to: q, tier, merged: true });
        merges.push({ x: q.x, y: q.y, tier: last.tier });
        moved = true;
      } else {
        const q = line[dest];
        tiles[idx(b, q.x, q.y)] = tier;
        slides.push({ from: p, to: q, tier, merged: false });
        if (!samePt(p, q)) moved = true;
        last = { pos: dest, tier, merged: false };
        dest++;
      }
    }
  }
  return { tiles, slides, merges, moved };
}

export interface ChainStep {
  from: Pt;
  to: Pt;
  /** Tier of the merged tile at `to`. */
  tier: number;
}

export interface ChainResult {
  /** Each wave is one link of the chain; waves resolve one after another. */
  waves: ChainStep[][];
  /** Tile state after each wave. */
  frames: number[][];
}

/**
 * Cascades: a freshly merged tile grabs a matching orthogonal neighbor and
 * merges again. The result can grab again in the next wave, and so on.
 */
export function resolveChains(b: Board, seeds: readonly Pt[]): ChainResult {
  const waves: ChainStep[][] = [];
  const frames: number[][] = [];
  let frontier: Pt[] = seeds.map((s) => ({ x: s.x, y: s.y }));
  while (frontier.length) {
    const wave: ChainStep[] = [];
    const next: Pt[] = [];
    const used = new Set<number>();
    for (const c of frontier) {
      const ci = idx(b, c.x, c.y);
      const t = b.tiles[ci];
      if (!t || t >= MAX_TIER || used.has(ci)) continue;
      for (const d of DIRS) {
        const n = step(c, d);
        if (isWall(b, n.x, n.y)) continue;
        const ni = idx(b, n.x, n.y);
        if (used.has(ni) || b.tiles[ni] !== t) continue;
        b.tiles[ci] = t + 1;
        b.tiles[ni] = 0;
        used.add(ci);
        used.add(ni);
        wave.push({ from: n, to: c, tier: t + 1 });
        next.push(c);
        break;
      }
    }
    if (!wave.length) break;
    waves.push(wave);
    frames.push([...b.tiles]);
    frontier = next;
  }
  return { waves, frames };
}

export function emptyCells(b: Board): Pt[] {
  const out: Pt[] = [];
  for (let y = 0; y < b.size; y++)
    for (let x = 0; x < b.size; x++) if (!isWall(b, x, y) && !b.tiles[idx(b, x, y)]) out.push({ x, y });
  return out;
}

export function spawnTile(b: Board, rng: Rng, hillChance: number): TrackCell | undefined {
  const cells = emptyCells(b);
  if (!cells.length) return undefined;
  const c = rng.pick(cells);
  const tier = rng.chance(hillChance) ? 2 : 1;
  b.tiles[idx(b, c.x, c.y)] = tier;
  return { ...c, tier };
}

export interface SwipeResult {
  dir: Dir;
  slides: SlideMove[];
  merges: TrackCell[];
  /** Tile state right after the slide, before any chain. */
  slid: number[];
  chain: ChainResult;
  spawned: TrackCell[];
  /** Slide merges plus chain merges. */
  mergeCount: number;
}

export interface SwipeOptions {
  hillChance: number;
  spawns: number;
}

/** Applies a swipe in place. Returns null if nothing would move (like 2048). */
export function swipe(b: Board, dir: Dir, rng: Rng, opts: SwipeOptions): SwipeResult | null {
  if (b.opened) return null;
  const s = slide(b, dir);
  if (!s.moved) return null;
  b.tiles = s.tiles;
  const slid = [...b.tiles];
  const chain = resolveChains(b, s.merges);
  const spawned: TrackCell[] = [];
  for (let k = 0; k < opts.spawns; k++) {
    const t = spawnTile(b, rng, opts.hillChance);
    if (t) spawned.push(t);
  }
  const mergeCount = s.merges.length + chain.waves.reduce((a, w) => a + w.length, 0);
  return { dir, slides: s.slides, merges: s.merges, slid, chain, spawned, mergeCount };
}

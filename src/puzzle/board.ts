import type { Rng } from '../core/rng';
import { MAX_TIER } from './pieces';

// The core rule: every swipe first lays the tile in front of the track head
// into the track, then slides/merges the loose tiles 2048-style. Laid track
// becomes a wall that loose tiles can't pass.

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

export interface Board {
  size: number;
  /** Tile tier per cell; 0 = empty. */
  tiles: number[];
  obstacles: (ObstacleKind | null)[];
  station: Pt;
  /** Laid track, in order, starting next to the station. */
  path: TrackCell[];
  closed: boolean;
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

export function isTrack(b: Board, x: number, y: number): boolean {
  return b.path.some((c) => c.x === x && c.y === y);
}

export function isWall(b: Board, x: number, y: number): boolean {
  if (!inBounds(b, x, y)) return true;
  if (b.obstacles[idx(b, x, y)]) return true;
  if (b.station.x === x && b.station.y === y) return true;
  return isTrack(b, x, y);
}

export function head(b: Board): Pt {
  return b.path.length ? b.path[b.path.length - 1] : b.station;
}

export function step(p: Pt, dir: Dir): Pt {
  return { x: p.x + DELTA[dir].x, y: p.y + DELTA[dir].y };
}

export type LayKind = 'lay' | 'close';

export function layKind(b: Board, dir: Dir): LayKind | null {
  if (b.closed) return null;
  const t = step(head(b), dir);
  if (samePt(t, b.station)) return b.path.length >= MIN_LOOP ? 'close' : null;
  return isWall(b, t.x, t.y) ? null : 'lay';
}

export function validDirs(b: Board): Dir[] {
  return DIRS.filter((d) => layKind(b, d) !== null);
}

export function isStuck(b: Board): boolean {
  return !b.closed && validDirs(b).length === 0;
}

export function canClose(b: Board): Dir | null {
  return DIRS.find((d) => layKind(b, d) === 'close') ?? null;
}

export function cloneBoard(b: Board): Board {
  return {
    ...b,
    tiles: [...b.tiles],
    obstacles: [...b.obstacles],
    station: { ...b.station },
    path: b.path.map((c) => ({ ...c })),
  };
}

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
}

export function slide(b: Board, dir: Dir): SlideResult {
  const n = b.size;
  const d = DELTA[dir];
  const tiles = new Array<number>(n * n).fill(0);
  const slides: SlideMove[] = [];
  const merges: TrackCell[] = [];
  const reversed = d.x === 1 || d.y === 1;

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
      } else {
        const q = line[dest];
        tiles[idx(b, q.x, q.y)] = tier;
        slides.push({ from: p, to: q, tier, merged: false });
        last = { pos: dest, tier, merged: false };
        dest++;
      }
    }
  }
  return { tiles, slides, merges };
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

export interface MoveResult {
  kind: LayKind;
  dir: Dir;
  laid?: TrackCell;
  slides: SlideMove[];
  merges: TrackCell[];
  /** Tile state right after the slide, before any chain. */
  slid: number[];
  chain: ChainResult;
  spawned: TrackCell[];
  /** Slide merges plus chain merges. */
  mergeCount: number;
}

export interface MoveOptions {
  hillChance: number;
  spawns: number;
}

/** Applies a swipe in place. Returns null if the head can't move that way. */
export function applyMove(b: Board, dir: Dir, rng: Rng, opts: MoveOptions): MoveResult | null {
  const kind = layKind(b, dir);
  if (!kind) return null;
  if (kind === 'close') {
    b.closed = true;
    return { kind, dir, slides: [], merges: [], slid: [...b.tiles], chain: { waves: [], frames: [] }, spawned: [], mergeCount: 0 };
  }
  const t = step(head(b), dir);
  const i = idx(b, t.x, t.y);
  const laid: TrackCell = { ...t, tier: b.tiles[i] };
  b.tiles[i] = 0;
  b.path.push(laid);
  const s = slide(b, dir);
  b.tiles = s.tiles;
  const slid = [...b.tiles];
  const chain = resolveChains(b, s.merges);
  const spawned: TrackCell[] = [];
  for (let k = 0; k < opts.spawns; k++) {
    const t = spawnTile(b, rng, opts.hillChance);
    if (t) spawned.push(t);
  }
  const mergeCount = s.merges.length + chain.waves.reduce((a, w) => a + w.length, 0);
  return { kind, dir, laid, slides: s.slides, merges: s.merges, slid, chain, spawned, mergeCount };
}

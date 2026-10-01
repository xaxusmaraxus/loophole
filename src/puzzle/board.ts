import type { Rng } from '../core/rng';
import { type Flavor, MAX_TIER, type SpecialId } from './pieces';

// Two separate actions:
//  - Swipe: 2048 rules. Loose tiles slide and merge, fresh merges chain.
//  - Build: turn the tile next to one of the two track ends into track.
// The station is a two-cell platform just below the board. The red end (0)
// climbs in from its left cell, the blue end (1) from its right cell. When the
// two ends meet, the circuit can open as a full ride; before that, as a
// half-price shuttle. Laid track is a wall that loose tiles can't pass.
//
// Crossings: the track may cross itself at right angles through a straight,
// low piece (Flat, Bump or Hill) that nothing crosses yet. Over flat track it's
// a bridge, under a Bump or Hill a tunnel. A crossing pass runs straight on.
// Piers: where the park allows it (the Boardwalk), track can be built out over
// ponds: a flat pier run.

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
  /** A second pass through a cell the track already runs through (a bridge or tunnel). */
  cross?: boolean;
  /** Built out over a pond. */
  pier?: boolean;
  /** A special piece fitted onto this track. */
  special?: SpecialId;
  /** A park piece (spinning, water, hanging), from a flavored tile. */
  flavor?: Flavor | null;
}

export type ObstacleKind = 'tree' | 'rock' | 'pond' | 'stand';
export type End = 0 | 1;

export interface Board {
  size: number;
  /** Tile tier per cell; 0 = empty. */
  tiles: number[];
  obstacles: (ObstacleKind | null)[];
  /** Left platform cell, just below the board: { x, y: size }. The right cell is x + 1. */
  station: Pt;
  /** Track grown out of each side of the station, in build order. */
  ends: [TrackCell[], TrackCell[]];
  opened: 'circuit' | 'shuttle' | null;
  /** Sand or mud: a loose tile resting here after a swipe sinks one tier. */
  soft: boolean[];
  /** Track may be built out over ponds (Boardwalk piers). */
  piers?: boolean;
  /** Park-piece flavor per cell, riding along with its tile (missing = none anywhere). */
  flav?: (Flavor | null)[];
}

/** The flavor of the tile at cell i. */
export const flavorAt = (b: Board, i: number): Flavor | null => b.flav?.[i] ?? null;

/** Track cells needed before the circuit may close (smallest ride is a U: up, across, down). */
export const MIN_LOOP = 2;

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
  return !!trackAt(b, x, y);
}

/** The platform cell each end starts from. */
export function stationPoint(b: Board, end: End): Pt {
  return { x: b.station.x + end, y: b.station.y };
}

export function isStation(b: Board, p: Pt): boolean {
  return p.y === b.station.y && (p.x === b.station.x || p.x === b.station.x + 1);
}

export function head(b: Board, end: End): Pt {
  const e = b.ends[end];
  return e.length ? e[e.length - 1] : stationPoint(b, end);
}

export function step(p: Pt, dir: Dir): Pt {
  return { x: p.x + DELTA[dir].x, y: p.y + DELTA[dir].y };
}

export interface BuildTarget extends Pt {
  end: End;
}

/** A fresh cell track can be laid into: free, or a pond where piers are allowed. */
export function buildable(b: Board, x: number, y: number): boolean {
  if (!inBounds(b, x, y) || trackAt(b, x, y)) return false;
  const ob = b.obstacles[idx(b, x, y)];
  return !ob || (!!b.piers && ob === 'pond');
}

/** Every pass of the track through (x, y), as [end, index]. */
export function passesAt(b: Board, x: number, y: number): [End, number][] {
  const out: [End, number][] = [];
  b.ends.forEach((e, end) => e.forEach((c, i) => c.x === x && c.y === y && out.push([end as End, i])));
  return out;
}

/** The cell a track cell was entered from (the platform for the first one). */
function prevOf(b: Board, end: End, i: number): Pt {
  return i === 0 ? stationPoint(b, end) : b.ends[end][i - 1];
}

/** Can the track, arriving from `from`, cross straight over (or under) the track at (x, y)? */
export function crossable(b: Board, x: number, y: number, from: Pt): boolean {
  const passes = passesAt(b, x, y);
  if (passes.length !== 1) return false;
  const [end, i] = passes[0];
  const c = b.ends[end][i];
  const next = b.ends[end][i + 1];
  if (c.cross || c.pier || c.special || c.flavor || c.tier > 2 || !next) return false;
  const prev = prevOf(b, end, i);
  // The crossed piece runs straight through, and the new pass meets it at right angles.
  if (prev.x - c.x !== c.x - next.x || prev.y - c.y !== c.y - next.y) return false;
  const d = { x: x - from.x, y: y - from.y };
  if (d.x * (next.x - c.x) + d.y * (next.y - c.y) !== 0) return false;
  // There must be somewhere to go on the far side.
  const beyond = { x: x + d.x, y: y + d.y };
  const other = [head(b, 0), head(b, 1)].some((h) => samePt(h, beyond));
  return buildable(b, beyond.x, beyond.y) || other;
}

/** A crossing pass must run straight on: the only way out of it. */
function straightOn(b: Board, end: End): Dir | null {
  const e = b.ends[end];
  const h = e[e.length - 1];
  if (!h?.cross) return null;
  const p = prevOf(b, end, e.length - 1);
  return DIRS.find((d) => DELTA[d].x === h.x - p.x && DELTA[d].y === h.y - p.y) ?? null;
}

/** Cells the given end (or either end) could build into next. */
export function buildTargets(b: Board, only?: End): BuildTarget[] {
  if (b.opened) return [];
  const out: BuildTarget[] = [];
  for (const end of [0, 1] as End[]) {
    if (only !== undefined && end !== only) continue;
    const h = head(b, end);
    const on = straightOn(b, end);
    for (const d of on ? [on] : DIRS) {
      const t = step(h, d);
      if (buildable(b, t.x, t.y) || crossable(b, t.x, t.y, h)) out.push({ ...t, end });
    }
  }
  return out;
}

/** The two ends meet: the ride can open as a full circuit. */
export function canConnect(b: Board): boolean {
  if (b.opened || trackLength(b) < MIN_LOOP) return false;
  const [a, c] = [head(b, 0), head(b, 1)];
  if (samePt(a, c) || !adjacent(a, c)) return false;
  // A head on a crossing can only join straight ahead.
  for (const [end, other] of [
    [0, c],
    [1, a],
  ] as [End, Pt][]) {
    const on = straightOn(b, end);
    if (on && !samePt(step(head(b, end), on), other)) return false;
  }
  return true;
}

export function canShuttle(b: Board): boolean {
  return !b.opened && trackLength(b) >= 1;
}

export function isBoxedIn(b: Board): boolean {
  return !b.opened && !canConnect(b) && buildTargets(b).length === 0;
}

/** Lays the tile at (x, y) into the track from the given end (a crossing or pier is flat track). */
export function build(b: Board, end: End, x: number, y: number): TrackCell | null {
  if (!buildTargets(b, end).some((t) => t.x === x && t.y === y)) return null;
  const i = idx(b, x, y);
  const laid: TrackCell = { x, y, tier: b.tiles[i] };
  const fl = flavorAt(b, i);
  if (fl) laid.flavor = fl;
  if (b.flav) b.flav[i] = null;
  if (trackAt(b, x, y)) {
    laid.tier = 0;
    laid.cross = true;
    delete laid.flavor;
  } else if (b.obstacles[i] === 'pond') {
    laid.tier = 0;
    laid.pier = true;
    delete laid.flavor;
  }
  b.tiles[i] = 0;
  b.ends[end].push(laid);
  return laid;
}

export interface RideStop extends Pt {
  tier: number;
  station: boolean;
  cross?: boolean;
  pier?: boolean;
  special?: SpecialId;
  flavor?: Flavor | null;
}

/** The order the train visits cells, from the platform back to the platform. */
export function rideOrder(b: Board, kind: 'circuit' | 'shuttle'): RideStop[] {
  const st = (end: End): RideStop => ({ ...stationPoint(b, end), tier: 0, station: true });
  const cells = (e: TrackCell[]) => e.map((c) => ({ ...c, station: false }));
  const [a, c] = [cells(b.ends[0]), cells(b.ends[1])];
  if (kind === 'circuit') return [st(0), ...a, ...[...c].reverse(), st(1)];
  // Shuttle: out along each end and back again, crossing the platform in between.
  const out: RideStop[] = [st(0)];
  if (a.length) out.push(...a, ...[...a].reverse().slice(1), st(0));
  out.push(st(1));
  if (c.length) out.push(...c, ...[...c].reverse().slice(1), st(1));
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
  b.ends.forEach((e, end) => e.forEach((c, i) => link(i === 0 ? stationPoint(b, end as End) : e[i - 1], c)));
  if (b.opened === 'circuit') link(head(b, 0), head(b, 1));
  return links;
}

export function cloneBoard(b: Board): Board {
  return {
    ...b,
    tiles: [...b.tiles],
    obstacles: [...b.obstacles],
    station: { ...b.station },
    soft: [...b.soft],
    flav: b.flav ? [...b.flav] : undefined,
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
  flav: (Flavor | null)[];
  slides: SlideMove[];
  merges: TrackCell[];
  moved: boolean;
}

export function slide(b: Board, dir: Dir): SlideResult {
  const n = b.size;
  const d = DELTA[dir];
  const tiles = new Array<number>(n * n).fill(0);
  const flav = new Array<Flavor | null>(n * n).fill(null);
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
        // A merge keeps any flavor either tile had.
        flav[idx(b, q.x, q.y)] ??= flavorAt(b, idx(b, p.x, p.y));
        slides.push({ from: p, to: q, tier, merged: true });
        merges.push({ x: q.x, y: q.y, tier: last.tier });
        moved = true;
      } else {
        const q = line[dest];
        tiles[idx(b, q.x, q.y)] = tier;
        flav[idx(b, q.x, q.y)] = flavorAt(b, idx(b, p.x, p.y));
        slides.push({ from: p, to: q, tier, merged: false });
        if (!samePt(p, q)) moved = true;
        last = { pos: dest, tier, merged: false };
        dest++;
      }
    }
  }
  return { tiles, flav, slides, merges, moved };
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
export function resolveChains(b: Board, seeds: readonly Pt[], parkFlavor: () => Flavor | null = () => null): ChainResult {
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
        // Chain reactions make park pieces: from the second link on, the merged tile takes the park's flavor (or keeps its own).
        if (b.flav) {
          b.flav[ci] = b.flav[ci] ?? b.flav[ni] ?? (waves.length >= 1 ? parkFlavor() : null);
          b.flav[ni] = null;
        }
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

export function spawnTile(b: Board, rng: Rng, hillChance: number, flavor: Flavor | null = null): TrackCell | undefined {
  const cells = emptyCells(b);
  if (!cells.length) return undefined;
  const c = rng.pick(cells);
  const tier = rng.chance(hillChance) ? 2 : 1;
  b.tiles[idx(b, c.x, c.y)] = tier;
  if (b.flav) b.flav[idx(b, c.x, c.y)] = flavor;
  return { ...c, tier, ...(flavor ? { flavor } : {}) };
}

export interface SwipeResult {
  dir: Dir;
  slides: SlideMove[];
  merges: TrackCell[];
  /** Tile state right after the slide, before any chain. */
  slid: number[];
  chain: ChainResult;
  spawned: TrackCell[];
  /** Tiles that sank a tier on sand (tier is the new tier; 0 = gone). */
  sunk: TrackCell[];
  /** Slide merges plus chain merges. */
  mergeCount: number;
}

export interface SwipeOptions {
  hillChance: number;
  spawns: number;
  /** False on Blackout days: merges don't chain. */
  chains?: boolean;
  /** The park's flavor, for tiles made by chain reactions (null: none). Called per chain merge. */
  parkFlavor?: () => Flavor | null;
  /** Chance a fresh tile spawns with the park's flavor. */
  flavorSpawn?: number;
}

/** Applies a swipe in place. Returns null if nothing would move (like 2048). */
export function swipe(b: Board, dir: Dir, rng: Rng, opts: SwipeOptions): SwipeResult | null {
  if (b.opened) return null;
  const s = slide(b, dir);
  if (!s.moved) return null;
  b.tiles = s.tiles;
  if (b.flav) b.flav = s.flav;
  const slid = [...b.tiles];
  const chain = opts.chains === false ? { waves: [], frames: [] } : resolveChains(b, s.merges, opts.parkFlavor);
  const sunk = sink(b);
  const spawned: TrackCell[] = [];
  for (let k = 0; k < opts.spawns; k++) {
    const fl = opts.parkFlavor && opts.flavorSpawn && rng.chance(opts.flavorSpawn) ? opts.parkFlavor() : null;
    const t = spawnTile(b, rng, opts.hillChance, fl);
    if (t) spawned.push(t);
  }
  const mergeCount = s.merges.length + chain.waves.reduce((a, w) => a + w.length, 0);
  return { dir, slides: s.slides, merges: s.merges, slid, chain, spawned, sunk, mergeCount };
}

/** Loose tiles on sand sink one tier; a tier-1 tile sinks away. */
export function sink(b: Board): TrackCell[] {
  const out: TrackCell[] = [];
  for (let i = 0; i < b.tiles.length; i++)
    if (b.soft[i] && b.tiles[i] > 0) {
      b.tiles[i]--;
      if (!b.tiles[i] && b.flav) b.flav[i] = null;
      out.push({ x: i % b.size, y: Math.floor(i / b.size), tier: b.tiles[i] });
    }
  return out;
}

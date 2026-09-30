import type { Rng } from '../core/rng';
import { type Board, type ObstacleKind, idx, isWall } from '../puzzle/board';

export type PerkId =
  | 'latenight'
  | 'lumber'
  | 'wrench'
  | 'hype'
  | 'barfbags'
  | 'billboard'
  | 'dynamite'
  | 'scenic'
  | 'tipjar';

export interface PerkDef {
  name: string;
  desc: string;
}

export const PERKS: Record<PerkId, PerkDef> = {
  latenight: { name: 'Late Closing', desc: '5 more actions of daylight every day.' },
  lumber: { name: 'Better Lumber', desc: 'New tiles are Hills more often.' },
  wrench: { name: 'Spare Wrench', desc: '+1 undo every day.' },
  hype: { name: 'Hype Guy', desc: 'Rides count +25% thrill.' },
  barfbags: { name: 'Barf Bags', desc: 'Everyone stomachs 3 more nausea.' },
  billboard: { name: 'Billboard', desc: '2 extra riders are waiting each morning.' },
  dynamite: { name: 'Dynamite', desc: 'Parks have 2 fewer obstacles.' },
  scenic: { name: 'Scenic Route', desc: 'Flat track is worth 1 thrill.' },
  tipjar: { name: 'Tip Jar', desc: 'Riders whose wish you meet pay triple instead of double.' },
};

export interface Mods {
  thrillMult: number;
  flatThrill: number;
  toleranceBonus: number;
  hillChance: number;
  undos: number;
  obstacleDelta: number;
  spawns: number;
  daylightBonus: number;
  extraRiders: number;
  tipMult: number;
}

export function modsFor(perks: readonly PerkId[]): Mods {
  const n = (id: PerkId) => perks.filter((p) => p === id).length;
  return {
    thrillMult: 1 + 0.25 * n('hype'),
    flatThrill: n('scenic'),
    toleranceBonus: 3 * n('barfbags'),
    hillChance: Math.min(0.6, 0.1 + 0.15 * n('lumber')),
    undos: 1 + n('wrench'),
    obstacleDelta: -2 * n('dynamite'),
    spawns: 1,
    daylightBonus: 5 * n('latenight'),
    extraRiders: 2 * n('billboard'),
    tipMult: n('tipjar') ? 3 : 2,
  };
}

export function perkOffer(rng: Rng): PerkId[] {
  return rng.shuffle(Object.keys(PERKS) as PerkId[]).slice(0, 3);
}

export interface DayConfig {
  day: number;
  size: number;
  obstacles: number;
  /** Tickets to sell today. */
  target: number;
  /** Actions (swipes and builds) before the park closes. */
  daylight: number;
  startRiders: number;
  maxQueue: number;
}

export function dayConfig(day: number, mods: Mods): DayConfig {
  return {
    day,
    size: day <= 2 ? 5 : 6,
    obstacles: Math.max(0, Math.min(day + 1, 7) + mods.obstacleDelta),
    target: TARGETS[Math.min(day, TARGETS.length) - 1] + Math.max(0, day - TARGETS.length) * 120,
    daylight: (day <= 2 ? 30 : 36) + mods.daylightBonus,
    startRiders: 3 + mods.extraRiders,
    maxQueue: 10,
  };
}

// Calibrated against a simple bot (see docs/concepts.md); a player should beat these.
const TARGETS = [250, 320, 420, 520, 620, 720, 820];

const OBSTACLES: ObstacleKind[] = ['tree', 'tree', 'tree', 'rock', 'pond', 'stand'];

/** Procedural park: station on a random edge, obstacles, starting tiles. */
export function generateBoard(cfg: DayConfig, rng: Rng): Board {
  const n = cfg.size;
  for (let attempt = 0; ; attempt++) {
    const side = rng.int(4);
    const along = rng.range(1, n - 2);
    const station =
      side === 0 ? { x: along, y: 0 } : side === 1 ? { x: n - 1, y: along } : side === 2 ? { x: along, y: n - 1 } : { x: 0, y: along };
    const b: Board = {
      size: n,
      tiles: new Array(n * n).fill(0),
      obstacles: new Array(n * n).fill(null),
      station,
      ends: [[], []],
      opened: null,
    };
    // Keep a 3x3 area around the station clear so a first loop is always possible.
    const nearStation = (x: number, y: number) => Math.abs(x - station.x) <= 1 && Math.abs(y - station.y) <= 1;
    let placed = 0;
    for (let tries = 0; placed < cfg.obstacles && tries < 200; tries++) {
      const x = rng.int(n);
      const y = rng.int(n);
      if (nearStation(x, y) || b.obstacles[idx(b, x, y)]) continue;
      b.obstacles[idx(b, x, y)] = rng.pick(OBSTACLES);
      placed++;
    }
    if (!allFreeConnected(b) && attempt < 30) continue;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (isWall(b, x, y) || !rng.chance(0.55)) continue;
        const roll = rng.next();
        b.tiles[idx(b, x, y)] = roll < 0.7 ? 1 : roll < 0.95 || cfg.day < 3 ? 2 : 3;
      }
    return b;
  }
}

function allFreeConnected(b: Board): boolean {
  const n = b.size;
  const free: number[] = [];
  for (let i = 0; i < n * n; i++) if (!b.obstacles[i] && !(i === idx(b, b.station.x, b.station.y))) free.push(i);
  if (!free.length) return false;
  const seen = new Set([free[0]]);
  const stack = [free[0]];
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % n;
    const y = Math.floor(i / n);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (isWall(b, nx, ny)) continue;
      const j = idx(b, nx, ny);
      if (!seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === free.length;
}

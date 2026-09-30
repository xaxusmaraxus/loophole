import type { Rng } from '../core/rng';
import { type Board, type ObstacleKind, idx, isWall } from '../puzzle/board';

// Rewards between days come in two kinds:
//  - Upgrades: permanent, stackable boosts to the park's stats.
//  - Tools: charges you keep in a toolbar and spend whenever you like.

export type UpgradeId = 'latenight' | 'lumber' | 'hype' | 'barfbags' | 'billboard' | 'landscaper' | 'scenic' | 'tipjar' | 'wrench';
export type ToolId = 'coffee' | 'paint' | 'crane' | 'dynamite' | 'megaphone';

export interface UpgradeDef {
  name: string;
  desc: string;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  latenight: { name: 'Late Closing', desc: '+5 swipes of daylight every day.' },
  lumber: { name: 'Better Lumber', desc: 'New tiles are Hills 15% more often.' },
  hype: { name: 'Hype Guy', desc: '+25% thrill on every ride.' },
  barfbags: { name: 'Barf Bags', desc: 'Riders stomach 3 more nausea.' },
  billboard: { name: 'Billboard', desc: '+2 riders waiting each morning.' },
  landscaper: { name: 'Landscaper', desc: '2 fewer obstacles in each park.' },
  scenic: { name: 'Scenic Route', desc: 'Flat track is worth +1 thrill.' },
  tipjar: { name: 'Tip Jar', desc: 'Riders whose wish you meet tip one more ticket-price.' },
  wrench: { name: 'Toolbox', desc: '+1 undo every day.' },
};

export interface ToolDef {
  name: string;
  desc: string;
  /** What the next tap targets, or null if the tool works instantly. */
  aim: 'tile' | 'swap' | 'obstacle' | null;
  /** Charges one reward grants. */
  charges: number;
}

export const TOOLS: Record<ToolId, ToolDef> = {
  coffee: { name: 'Coffee', desc: '+5 swipes of daylight today. Works after sunset too.', aim: null, charges: 2 },
  paint: { name: 'Paint Can', desc: 'Upgrade one tile a tier. It can set off a chain.', aim: 'tile', charges: 2 },
  crane: { name: 'Crane', desc: 'Move a loose tile anywhere (it swaps with whatever is there).', aim: 'swap', charges: 2 },
  dynamite: { name: 'Dynamite', desc: 'Blow up one tree, rock, pond or stand.', aim: 'obstacle', charges: 2 },
  megaphone: { name: 'Megaphone', desc: 'Call 3 more riders into line right now.', aim: null, charges: 1 },
};

export type Reward = { kind: 'upgrade'; id: UpgradeId } | { kind: 'tool'; id: ToolId };

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

export function modsFor(upgrades: readonly UpgradeId[]): Mods {
  const n = (id: UpgradeId) => upgrades.filter((p) => p === id).length;
  return {
    thrillMult: 1 + 0.25 * n('hype'),
    flatThrill: n('scenic'),
    toleranceBonus: 3 * n('barfbags'),
    hillChance: Math.min(0.7, 0.1 + 0.15 * n('lumber')),
    undos: 1 + n('wrench'),
    obstacleDelta: -2 * n('landscaper'),
    spawns: 1,
    daylightBonus: 5 * n('latenight'),
    extraRiders: 2 * n('billboard'),
    tipMult: 2 + n('tipjar'),
  };
}

/** Three choices: at least one upgrade and one tool. */
export function rewardOffer(rng: Rng): Reward[] {
  const ups = rng.shuffle(Object.keys(UPGRADES) as UpgradeId[]);
  const tools = rng.shuffle(Object.keys(TOOLS) as ToolId[]);
  const third: Reward = rng.chance(0.5) ? { kind: 'upgrade', id: ups[1] } : { kind: 'tool', id: tools[1] };
  return rng.shuffle<Reward>([{ kind: 'upgrade', id: ups[0] }, { kind: 'tool', id: tools[0] }, third]);
}

export interface DayConfig {
  day: number;
  size: number;
  obstacles: number;
  /** Tickets to sell today. */
  target: number;
  /** Swipes before the park closes. Building is free. */
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
    daylight: (day <= 2 ? 40 : 48) + mods.daylightBonus,
    startRiders: 3 + mods.extraRiders,
    maxQueue: 10,
  };
}

// Calibrated against a simple bot (see docs/concepts.md); a player should beat these.
const TARGETS = [230, 300, 400, 500, 600, 700, 800];

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

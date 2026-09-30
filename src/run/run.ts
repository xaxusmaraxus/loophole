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

// ---- Season -----------------------------------------------------------------
// A season is three parks of three days each, then the Grand Opening finale.
// Each park adds a rule twist; later parks keep the earlier twists.

export type ParkId = 'meadow' | 'boardwalk' | 'hollow' | 'finale';

export interface ParkDef {
  id: ParkId;
  name: string;
  /** Shown on the park's intro card. */
  intro: string;
  /** What's new here, one line per rule. */
  rules: string[];
  size: number;
  /** Share of free cells that are sand/mud: loose tiles resting there sink a tier each swipe. */
  soft: number;
  /** Tiles far from the track are hidden as mystery crates. */
  fog: boolean;
}

export const PARKS: Record<ParkId, ParkDef> = {
  meadow: {
    id: 'meadow',
    name: 'Meadow Park',
    intro: 'A quiet field, a station and a queue. Build your first coasters here.',
    rules: ['Swipe to merge, tap to build, connect the pennants.'],
    size: 5,
    soft: 0,
    fog: false,
  },
  boardwalk: {
    id: 'boardwalk',
    name: 'Sunny Boardwalk',
    intro: 'Sea air, sticky fingers, and patches of soft sand everywhere.',
    rules: ['Sand: a loose tile that ends a swipe on sand sinks one tier. A Bump sinks away completely.', 'Track built over sand is perfectly safe.'],
    size: 6,
    soft: 0.18,
    fog: false,
  },
  hollow: {
    id: 'hollow',
    name: 'Haunted Hollow',
    intro: 'Mist, mud, and guests who are not entirely alive.',
    rules: ['Fog: tiles far from your track are mystery crates until the track gets close.', 'Mud works like sand.', 'Ghost riders can’t get sick. They tip for a nauseating ride.'],
    size: 6,
    soft: 0.14,
    fog: true,
  },
  finale: {
    id: 'finale',
    name: 'The Grand Opening',
    intro: 'The whole town came. The press came. Build the ride of the season.',
    rules: ['A bigger park with every twist from the season.', 'Beat the target to win the season. Miss it and you try again tomorrow.'],
    size: 7,
    soft: 0.12,
    fog: true,
  },
};

export const DAYS_PER_PARK = 3;
export const SEASON_ORDER: ParkId[] = ['meadow', 'boardwalk', 'hollow', 'finale'];
export const FINALE_DAY = DAYS_PER_PARK * 3 + 1;

export function parkFor(day: number): ParkDef {
  return PARKS[SEASON_ORDER[Math.min(Math.floor((day - 1) / DAYS_PER_PARK), SEASON_ORDER.length - 1)]];
}

/** 1-based day within the current park (the finale is always 1). */
export function dayInPark(day: number): number {
  return day >= FINALE_DAY ? 1 : ((day - 1) % DAYS_PER_PARK) + 1;
}

export function isFirstDayOfPark(day: number): boolean {
  return day <= FINALE_DAY && dayInPark(day) === 1;
}

export function isLastDayOfPark(day: number): boolean {
  return day < FINALE_DAY && dayInPark(day) === DAYS_PER_PARK;
}

export interface DayConfig {
  day: number;
  park: ParkDef;
  size: number;
  obstacles: number;
  /** Tickets to sell today. */
  target: number;
  /** Swipes before sunset. Building is free. */
  daylight: number;
  startRiders: number;
  maxQueue: number;
}

// Calibrated against a simple bot (see docs/concepts.md); a player should beat these.
const TARGETS = [230, 260, 300, 320, 360, 400, 400, 450, 500, 700];

export function dayConfig(day: number, mods: Mods): DayConfig {
  const park = parkFor(day);
  const d = dayInPark(day);
  return {
    day,
    park,
    size: park.size,
    obstacles: Math.max(0, (park.id === 'meadow' ? d : 2 + d) + (park.id === 'finale' ? 2 : 0) + mods.obstacleDelta),
    target: TARGETS[Math.min(day, TARGETS.length) - 1],
    daylight: 32 + park.size * 2 + (park.id === 'finale' ? 8 : 0) + mods.daylightBonus,
    startRiders: 3 + mods.extraRiders + (park.id === 'finale' ? 3 : 0),
    maxQueue: park.id === 'finale' ? 12 : 10,
  };
}

// ---- Shop -------------------------------------------------------------------

export type ShopItem =
  | { kind: 'tool'; id: ToolId; price: number; sold: boolean }
  | { kind: 'upgrade'; id: UpgradeId; price: number; sold: boolean }
  | { kind: 'heart'; price: number; sold: boolean };

export function shopStock(rng: Rng): ShopItem[] {
  const tools = rng.shuffle(Object.keys(TOOLS) as ToolId[]).slice(0, 3);
  const up = rng.pick(Object.keys(UPGRADES) as UpgradeId[]);
  return [
    ...tools.map((id): ShopItem => ({ kind: 'tool', id, price: 40 + rng.int(4) * 10, sold: false })),
    { kind: 'upgrade', id: up, price: 140, sold: false },
    { kind: 'heart', price: 160, sold: false },
  ];
}

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
      soft: new Array(n * n).fill(false),
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
    placeSoft(b, cfg.park.soft, rng);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (isWall(b, x, y) || !rng.chance(0.55)) continue;
        const roll = rng.next();
        b.tiles[idx(b, x, y)] = roll < 0.7 ? 1 : roll < 0.95 || cfg.day < 3 ? 2 : 3;
        // Don't start tiles on sand; they'd sink before you could use them.
        if (b.soft[idx(b, x, y)]) b.tiles[idx(b, x, y)] = 0;
      }
    return b;
  }
}

/** Sand or mud in a few blobby patches, never on the station or obstacles. */
function placeSoft(b: Board, share: number, rng: Rng): void {
  const n = b.size;
  let want = Math.round(n * n * share);
  for (let tries = 0; want > 0 && tries < 200; tries++) {
    let x = rng.int(n);
    let y = rng.int(n);
    for (let len = rng.range(2, 4); len > 0 && want > 0; len--) {
      if (!isWall(b, x, y) && !b.soft[idx(b, x, y)]) {
        b.soft[idx(b, x, y)] = true;
        want--;
      }
      const [dx, dy] = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      x = Math.max(0, Math.min(n - 1, x + dx));
      y = Math.max(0, Math.min(n - 1, y + dy));
    }
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

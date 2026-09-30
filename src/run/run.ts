import type { Rng } from '../core/rng';
import type { SpecialId } from '../puzzle/pieces';
import { type Board, type ObstacleKind, idx, isWall } from '../puzzle/board';
import { type BossId, KINDS, type RiderKind } from '../riders/riders';
import { ATTRACTIONS, type AttractionId } from './attractions';

// Rewards between days come in two kinds:
//  - Upgrades: permanent, stackable boosts to the park's stats.
//  - Tools: charges you keep in a toolbar and spend whenever you like.

export type UpgradeId = 'latenight' | 'lumber' | 'hype' | 'fries' | 'billboard' | 'landscaper' | 'scenic' | 'wrench';
export type ToolId = 'coffee' | 'paint' | 'crane' | 'dynamite' | 'megaphone';

export interface UpgradeDef {
  name: string;
  desc: string;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  latenight: { name: 'Late Closing', desc: '+5 swipes of daylight every day.' },
  lumber: { name: 'Better Lumber', desc: 'New tiles are Hills 15% more often.' },
  hype: { name: 'Hype Guy', desc: '+25% thrill on every ride.' },
  fries: { name: 'Greasy Fries', desc: 'Every rider’s stomach is 1 smaller.' },
  billboard: { name: 'Billboard', desc: '+2 riders waiting each morning.' },
  landscaper: { name: 'Landscaper', desc: '2 fewer obstacles in each park.' },
  scenic: { name: 'Scenic Route', desc: 'Flat track is worth +1 thrill.' },
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

export type Reward =
  | { kind: 'upgrade'; id: UpgradeId }
  | { kind: 'tool'; id: ToolId }
  | { kind: 'attraction'; id: AttractionId }
  | { kind: 'special'; id: SpecialId };

/** Special pieces a reward or shop hands out: one charge each. */
export const SPECIAL_CHARGES = 1;

export interface Mods {
  thrillMult: number;
  flatThrill: number;
  /** Added to every rider's stomach (negative = easier to make puke). */
  stomachDelta: number;
  hillChance: number;
  undos: number;
  obstacleDelta: number;
  spawns: number;
  daylightBonus: number;
  extraRiders: number;
}

export function modsFor(upgrades: readonly UpgradeId[]): Mods {
  const n = (id: UpgradeId) => upgrades.filter((p) => p === id).length;
  return {
    thrillMult: 1 + 0.25 * n('hype'),
    flatThrill: n('scenic'),
    stomachDelta: -n('fries'),
    hillChance: Math.min(0.7, 0.1 + 0.15 * n('lumber')),
    undos: 1 + n('wrench'),
    obstacleDelta: -2 * n('landscaper'),
    spawns: 1,
    daylightBonus: 5 * n('latenight'),
    extraRiders: 2 * n('billboard'),
  };
}

/** Attractions not yet owned, rares less often. */
export function attractionPicks(rng: Rng, owned: readonly AttractionId[], n: number): AttractionId[] {
  const pool = (Object.keys(ATTRACTIONS) as AttractionId[]).filter((a) => !owned.includes(a));
  const weighted = pool.flatMap((a) => (ATTRACTIONS[a].rarity === 'rare' ? [a] : [a, a, a]));
  const out: AttractionId[] = [];
  while (out.length < n && weighted.length) {
    const a = rng.pick(weighted);
    if (!out.includes(a)) out.push(a);
    for (let i = weighted.length - 1; i >= 0; i--) if (weighted[i] === a) weighted.splice(i, 1);
  }
  return out;
}

/**
 * Three choices after a day. Normally one upgrade, one tool and one attraction
 * (a second tool if the attraction slots are full). `allAttractions` is for
 * storm days and treasure stops.
 */
export function rewardOffer(rng: Rng, owned: readonly AttractionId[], slotsFree: boolean, allAttractions = false, specials: readonly SpecialId[] = []): Reward[] {
  if (allAttractions && slotsFree) {
    const picks = attractionPicks(rng, owned, 3).map((id): Reward => ({ kind: 'attraction', id }));
    if (picks.length) return picks;
  }
  const ups = rng.shuffle(Object.keys(UPGRADES) as UpgradeId[]);
  const tools = rng.shuffle(Object.keys(TOOLS) as ToolId[]);
  const attraction = slotsFree ? attractionPicks(rng, owned, 1)[0] : undefined;
  const third: Reward = attraction ? { kind: 'attraction', id: attraction } : { kind: 'tool', id: tools[1] };
  // Once special pieces are unlocked, the tool pick is often one of them instead.
  const tool: Reward = specials.length && rng.chance(0.5) ? { kind: 'special', id: rng.pick([...specials]) } : { kind: 'tool', id: tools[0] };
  return rng.shuffle<Reward>([{ kind: 'upgrade', id: ups[0] }, tool, third]);
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
  /** Track can be built out over ponds on piers. */
  piers: boolean;
  /** Where there are piers: the share of obstacles that are ponds. */
  ponds: number;
}

export const PARKS: Record<ParkId, ParkDef> = {
  meadow: {
    id: 'meadow',
    name: 'Meadow Park',
    intro: 'A quiet field, a station and a queue. Build your first coasters here.',
    rules: ['Swipe to merge, tap to build, connect the pennants.', 'The track can cross itself: over flat track on a bridge, under a Bump or Hill through a tunnel.'],
    size: 5,
    soft: 0,
    fog: false,
    piers: false,
    ponds: 1 / 6,
  },
  boardwalk: {
    id: 'boardwalk',
    name: 'Sunny Boardwalk',
    intro: 'Sea air, sticky fingers, and patches of soft sand everywhere.',
    rules: [
      'Sand: a loose tile that ends a swipe on sand sinks one tier. A Bump sinks away completely.',
      'Track built over sand is perfectly safe.',
      'Piers: you can build track out over the water. A pier run is flat, with a sea breeze: +2 thrill.',
    ],
    size: 6,
    soft: 0.18,
    fog: false,
    piers: true,
    ponds: 0.45,
  },
  hollow: {
    id: 'hollow',
    name: 'Haunted Hollow',
    intro: 'Mist, mud, and guests who are not entirely alive.',
    rules: [
      'Fog: tiles far from your track are mystery crates until the track gets close.',
      'Mud works like sand.',
      'Ghosts only feel upside-down pieces, but those hit them double, and a ghost’s puke is worth double.',
    ],
    size: 6,
    soft: 0.14,
    fog: true,
    piers: false,
    ponds: 1 / 6,
  },
  finale: {
    id: 'finale',
    name: 'The Grand Opening',
    intro: 'The whole town came. The press came. Build the ride of the season.',
    rules: ['A bigger park with every twist from the season.', 'Beat the target to win the season. Miss it and you try again tomorrow.'],
    size: 7,
    soft: 0.12,
    fog: true,
    piers: true,
    ponds: 0.3,
  },
};

export const DAYS_PER_PARK = 3;
export const SEASON_ORDER: ParkId[] = ['meadow', 'boardwalk', 'hollow', 'finale'];
export const FINALE_DAY = DAYS_PER_PARK * 3 + 1;

export function parkFor(day: number): ParkDef {
  return PARKS[SEASON_ORDER[Math.min(Math.floor((day - 1) / DAYS_PER_PARK), SEASON_ORDER.length - 1)]];
}

// ---- Route map --------------------------------------------------------------
// Each park is a small map, played left to right: two day columns, a stop
// (shop, repair or treasure), then the park's boss day. The finale is one node.

export type NodeKind = 'day' | 'vip' | 'storm' | 'shop' | 'repair' | 'treasure' | 'boss' | 'finale';

export const NODE_INFO: Record<NodeKind, { name: string; desc: string; isDay: boolean }> = {
  day: { name: 'Day', desc: 'A regular day at the park.', isDay: true },
  vip: { name: 'VIP day', desc: 'A VIP joins the line. Every time they puke, it pays 5×.', isDay: true },
  storm: { name: 'Storm', desc: '8 fewer swipes. Afterwards, every reward choice is an attraction.', isDay: true },
  shop: { name: 'Shop', desc: 'Spend park funds on tools, upgrades and attractions.', isDay: false },
  repair: { name: 'Repair', desc: 'Win back a heart. At full hearts, +100 park funds instead.', isDay: false },
  treasure: { name: 'Treasure', desc: 'A free capsule egg from the machine.', isDay: false },
  boss: { name: 'Boss day', desc: 'A tough customer is in line. Make them puke to clear the park.', isDay: true },
  finale: { name: 'Grand Opening', desc: 'Make the Mayor puke and hit the target to win the season.', isDay: true },
};

/** The tough customer waiting at the end of each park. */
export const PARK_BOSS: Record<ParkId, BossId> = { meadow: 'barry', boardwalk: 'ivy', hollow: 'vertigo', finale: 'mayor' };

export interface MapNode {
  kind: NodeKind;
}

/** Columns of nodes; any node can be reached from any node in the column before. */
export type ParkMap = MapNode[][];

export function generateParkMap(park: ParkId, rng: Rng): ParkMap {
  if (park === 'finale') return [[{ kind: 'finale' }]];
  const pick = (kinds: NodeKind[], n: number) => rng.shuffle([...kinds]).slice(0, n).map((kind) => ({ kind }));
  return [
    [{ kind: 'day' }, { kind: 'vip' }],
    pick(['day', 'storm', 'vip'], rng.range(2, 3)),
    pick(['shop', 'repair', 'treasure'], 2),
    [{ kind: 'boss' }],
  ];
}

export interface DayConfig {
  day: number;
  park: ParkDef;
  node: NodeKind;
  boss: BossId | null;
  size: number;
  obstacles: number;
  soft: number;
  /** Tickets to sell today. */
  target: number;
  /** Swipes before sunset. Building is free. */
  daylight: number;
  startRiders: number;
  maxQueue: number;
}

/**
 * Targets climb fast on purpose (Balatro-style): by the second park you need
 * attractions that multiply each other to keep up. Day 1 sits near what a simple
 * bot scores with no attractions at all.
 */
export const BASE_TARGET = 1000;
export const TARGET_GROWTH = 1.35;

/** Funds, prices and payouts scale with the targets. */
export function priceScale(day: number): number {
  return (BASE_TARGET / 300) * TARGET_GROWTH ** (day - 1);
}

export function dayConfig(day: number, mods: Mods, node: NodeKind = 'day'): DayConfig {
  const park = parkFor(day);
  const d = Math.min(DAYS_PER_PARK, ((day - 1) % DAYS_PER_PARK) + 1);
  const boss = node === 'boss' || node === 'finale' ? PARK_BOSS[park.id] : null;
  let target = BASE_TARGET * TARGET_GROWTH ** (day - 1);
  if (node === 'finale') target *= 1.5;
  return {
    day,
    park,
    node,
    boss,
    size: park.size,
    obstacles: Math.max(0, (park.id === 'meadow' ? d : 2 + d) + (park.id === 'finale' ? 2 : 0) + mods.obstacleDelta),
    soft: park.soft,
    target: Math.round(target / 10) * 10,
    daylight: 32 + park.size * 2 + (park.id === 'finale' ? 8 : 0) - (node === 'storm' ? 8 : 0) + mods.daylightBonus,
    startRiders: 3 + mods.extraRiders + (park.id === 'finale' ? 3 : 0),
    maxQueue: park.id === 'finale' ? 12 : 10,
  };
}

// ---- Shop -------------------------------------------------------------------

// ---- Capsule eggs (packs) ----------------------------------------------------
// The park's capsule machine sells eggs. Crack one open and pick from what's inside.

export type EggKind = 'golden' | 'bus' | 'snack';

export const EGGS: Record<EggKind, { name: string; desc: string; picks: number; size: number }> = {
  golden: { name: 'Golden Egg', desc: 'Pick 1 of 3 attractions.', picks: 1, size: 3 },
  bus: { name: 'Bus Tour Egg', desc: 'Pick 1 of 3 rider types. One of them joins your line every morning, for good.', picks: 1, size: 3 },
  snack: { name: 'Snack Egg', desc: 'Pick 2 of 4 tools.', picks: 2, size: 4 },
};

export type EggItem = { kind: 'attraction'; id: AttractionId } | { kind: 'rider'; id: BusRider } | { kind: 'tool'; id: ToolId };

/** Rider types a bus tour can bring (not VIPs or bosses). */
export type BusRider = Exclude<RiderKind, 'vip' | 'boss'>;

export function eggContents(rng: Rng, egg: EggKind, day: number, owned: readonly AttractionId[]): EggItem[] {
  const n = EGGS[egg].size;
  if (egg === 'golden') return attractionPicks(rng, owned, n).map((id): EggItem => ({ kind: 'attraction', id }));
  if (egg === 'snack') return rng.shuffle(Object.keys(TOOLS) as ToolId[]).slice(0, n).map((id): EggItem => ({ kind: 'tool', id }));
  const riders = (Object.keys(KINDS) as RiderKind[]).filter((k): k is BusRider => k !== 'vip' && k !== 'boss' && !KINDS[k as BusRider].parks && KINDS[k as BusRider].minDay <= day + 2);
  return rng.shuffle(riders).slice(0, n).map((id): EggItem => ({ kind: 'rider', id }));
}

export type ShopItem =
  | { kind: 'egg'; id: EggKind; price: number; sold: boolean }
  | { kind: 'tool'; id: ToolId; price: number; sold: boolean }
  | { kind: 'upgrade'; id: UpgradeId; price: number; sold: boolean }
  | { kind: 'attraction'; id: AttractionId; price: number; sold: boolean }
  | { kind: 'special'; id: SpecialId; price: number; sold: boolean }
  | { kind: 'heart'; price: number; sold: boolean };

/** Prices scale with the season, like the targets do. */
export function shopStock(rng: Rng, day: number, owned: readonly AttractionId[], specials: readonly SpecialId[] = []): ShopItem[] {
  const price = (base: number) => Math.round((base * priceScale(day)) / 10) * 10;
  const tools = rng.shuffle(Object.keys(TOOLS) as ToolId[]).slice(0, 1);
  const up = rng.pick(Object.keys(UPGRADES) as UpgradeId[]);
  const attractions = attractionPicks(rng, owned, 1);
  const eggs = rng.shuffle(Object.keys(EGGS) as EggKind[]).slice(0, 2);
  const eggPrice: Record<EggKind, number> = { golden: 200, bus: 140, snack: 110 };
  return [
    ...eggs.map((id): ShopItem => ({ kind: 'egg', id, price: price(eggPrice[id]), sold: false })),
    ...attractions.map((id): ShopItem => ({ kind: 'attraction', id, price: price(ATTRACTIONS[id].rarity === 'rare' ? 260 : 170), sold: false })),
    ...tools.map((id): ShopItem => ({ kind: 'tool', id, price: price(60 + rng.int(4) * 10), sold: false })),
    { kind: 'upgrade', id: up, price: price(180), sold: false },
    ...(specials.length ? [{ kind: 'special', id: rng.pick([...specials]), price: price(120), sold: false } as ShopItem] : []),
    { kind: 'heart', price: price(220), sold: false },
  ];
}

/** Selling an attraction refunds a share of what it would cost. */
export function sellValue(day: number): number {
  return Math.round((60 * priceScale(day)) / 10) * 10;
}

const OBSTACLES: ObstacleKind[] = ['tree', 'tree', 'tree', 'rock', 'pond', 'stand'];

/** Procedural park: station on a random edge, obstacles, starting tiles. */
export function generateBoard(cfg: DayConfig, rng: Rng): Board {
  const n = cfg.size;
  for (let attempt = 0; ; attempt++) {
    // The station platform sits just below the board, two cells wide.
    const station = { x: rng.range(0, n - 2), y: n };
    const b: Board = {
      size: n,
      tiles: new Array(n * n).fill(0),
      obstacles: new Array(n * n).fill(null),
      station,
      ends: [[], []],
      opened: null,
      soft: new Array(n * n).fill(false),
      piers: cfg.park.piers,
    };
    // Keep the two rows above the platform clear so a first loop is always possible.
    const nearStation = (x: number, y: number) => y >= n - 2 && x >= station.x - 1 && x <= station.x + 2;
    let placed = 0;
    for (let tries = 0; placed < cfg.obstacles && tries < 200; tries++) {
      const x = rng.int(n);
      const y = rng.int(n);
      if (nearStation(x, y) || b.obstacles[idx(b, x, y)]) continue;
      b.obstacles[idx(b, x, y)] = cfg.park.piers && rng.chance(cfg.park.ponds) ? 'pond' : rng.pick(OBSTACLES);
      placed++;
    }
    if (!allFreeConnected(b) && attempt < 30) continue;
    placeSoft(b, cfg.soft, rng);
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
  for (let i = 0; i < n * n; i++) if (!b.obstacles[i]) free.push(i);
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

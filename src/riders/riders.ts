import type { Rng } from '../core/rng';
import { PIECES } from '../puzzle/pieces';
import type { ParkId } from '../run/run';

// The goal is to make riders puke. Nausea builds up piece by piece as the
// train runs; every time a rider's total passes another stomachful, they puke.
// Each puke is worth the ride's rating (excitement × multiplier).

export type RiderKind =
  | 'tourist'
  | 'corndog'
  | 'grandma'
  | 'kid'
  | 'thrill'
  | 'looper'
  | 'nerd'
  | 'influencer'
  | 'ghost'
  | 'vip'
  | 'boss';
export type BossId = 'barry' | 'granny' | 'ivy' | 'lou' | 'vertigo' | 'count' | 'mayor';
export type HairStyle = 'short' | 'long' | 'bun' | 'spiky' | 'bald' | 'cap';
export type Accessory = 'none' | 'glasses' | 'shades' | 'corndog' | 'camera' | 'balloon';

export interface Look {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  shirt: number;
  pants: number;
  accessory: Accessory;
  small: boolean;
  /** Bosses are drawn twice the size. */
  big?: boolean;
}

export interface Rider {
  id: number;
  kind: RiderKind;
  name: string;
  look: Look;
  /** Nausea it takes to make them puke once. */
  stomach: number;
  boss?: BossId;
}

/** Most pukes one rider can manage on one ride. */
export const MAX_PUKES = 5;

interface Profile {
  /** One line for the rider card. */
  trait: string;
  /** How hard each piece tier hits them, as a multiple of its nausea. */
  /** `inv`: the piece goes (or counts as going) upside down: a real inversion or a hanging piece. */
  hit?: (tier: number, inv: boolean) => number;
  /** Points multiplier per puke. */
  worth?: number;
}

interface KindDef extends Profile {
  label: string;
  minDay: number;
  /** Only shows up in these parks (default: everywhere). */
  parks?: ParkId[];
  weight: number;
  stomach: (day: number) => number;
  look: (rng: Rng) => Partial<Look>;
}

export const KINDS: Record<Exclude<RiderKind, 'boss'>, KindDef> = {
  tourist: {
    label: 'Tourist',
    minDay: 1,
    weight: 4,
    stomach: (d) => 8 + Math.floor(d / 3),
    trait: 'An ordinary stomach.',
    look: () => ({ accessory: 'camera' }),
  },
  corndog: {
    label: 'Just Ate',
    minDay: 1,
    weight: 2,
    stomach: () => 4,
    trait: 'Tiny stomach. Easy points.',
    look: () => ({ accessory: 'corndog' }),
  },
  grandma: {
    label: 'Grandma',
    minDay: 1,
    weight: 2,
    stomach: () => 8,
    trait: 'Anything upside down hits her triple.',
    hit: (_t, inv) => (inv ? 3 : 1),
    look: () => ({ hairStyle: 'bun', hair: 4, accessory: 'glasses' }),
  },
  kid: {
    label: 'Kid',
    minDay: 1,
    weight: 2,
    stomach: () => 7,
    trait: 'Drops hit twice as hard.',
    hit: (t) => (t === 3 ? 2 : 1),
    look: () => ({ small: true, accessory: 'balloon' }),
  },
  thrill: {
    label: 'Thrill Seeker',
    minDay: 1,
    weight: 2,
    stomach: (d) => 14 + d,
    trait: 'Iron stomach.',
    look: () => ({ accessory: 'shades' }),
  },
  looper: {
    label: 'Loop Lover',
    minDay: 2,
    weight: 2,
    stomach: () => 9,
    trait: 'Immune to loops, but everything else hits double.',
    hit: (_t, inv) => (inv ? 0 : 2),
    look: (rng) => ({ hairStyle: 'spiky', hair: rng.pick([6, 7, 3]) }),
  },
  nerd: {
    label: 'Coaster Nerd',
    minDay: 2,
    weight: 2,
    stomach: () => 12,
    trait: 'Only Helixes and bigger get to them, but those hit triple.',
    hit: (t) => (t >= 4 ? 3 : 0),
    look: () => ({ hairStyle: 'cap', accessory: 'glasses' }),
  },
  influencer: {
    label: 'Influencer',
    minDay: 3,
    weight: 1,
    stomach: () => 10,
    trait: 'Films every puke: each one is worth double.',
    worth: 2,
    look: () => ({ accessory: 'camera', hairStyle: 'long' }),
  },
  ghost: {
    label: 'Ghost',
    minDay: 1,
    parks: ['hollow', 'finale'],
    weight: 3,
    stomach: () => 9,
    trait: 'Only feels upside-down pieces, but those hit double. Pukes ectoplasm: each one is worth double.',
    hit: (_t, inv) => (inv ? 2 : 0),
    worth: 2,
    look: () => ({ skin: 5, hairStyle: 'bald', shirt: 8, pants: 4, accessory: 'none' }),
  },
  vip: {
    label: 'VIP',
    minDay: 1,
    parks: [],
    weight: 0,
    stomach: (d) => 11 + Math.floor(d / 2),
    trait: 'Pays 5× for every puke.',
    worth: 5,
    look: () => ({ accessory: 'shades', shirt: 3, hairStyle: 'short', hair: 3 }),
  },
};

/**
 * How a boss bends the day. Each one is a twist on the puzzle, not just a bigger
 * stomach (like Balatro's boss blinds):
 *  - seconds:  their stomach grows while you build (every 4 swipes).
 *  - seenitall: only the first piece of each type gets to them.
 *  - waves:    every 5 swipes a wave sloshes the board one way (forecast ahead).
 *  - whistle:  a swipe that merges nothing drops in two extra tiles.
 *  - spin:     every 6 swipes your swipe controls turn a quarter turn.
 *  - blackout: the fog closes in: only tiles next to the track can be seen.
 *  - demands:  the ride must meet three demands or they won't get on.
 */
export type BossRule = 'seconds' | 'seenitall' | 'waves' | 'whistle' | 'spin' | 'blackout' | 'demands';

export interface BossDef extends Profile {
  name: string;
  /** A one-liner for the title card. */
  quip: string;
  stomach: number;
  /** Pukes it takes to break them, over up to BOSS_ROUNDS rides. */
  composure: number;
  rule: BossRule;
  ruleName: string;
  ruleDesc: string;
  look: Partial<Look>;
}

/** Rides you get to break a boss on their day. */
export const BOSS_ROUNDS = 3;

/** Each park ends with one of these in line. Break their composure to clear the park. */
export const BOSSES: Record<BossId, BossDef> = {
  barry: {
    name: 'Big Barry',
    quip: 'Has never puked. Not once. Not even at the chili festival.',
    stomach: 14,
    composure: 3,
    rule: 'seconds',
    ruleName: 'Second Helpings',
    ruleDesc: 'Barry snacks while you build: his stomach grows by 1 every 4 swipes. Open early!',
    trait: 'Huge. Everything hits him, just not very hard.',
    worth: 8,
    look: { shirt: 0, pants: 2, hairStyle: 'short', hair: 0, accessory: 'corndog' },
  },
  granny: {
    name: 'Granny Grit',
    quip: 'Rode the first wooden coaster in 1952. Was bored.',
    stomach: 6,
    composure: 3,
    rule: 'seenitall',
    ruleName: 'Seen It All',
    ruleDesc: 'Only the first piece of each type gets to her. Variety is everything.',
    trait: 'Small stomach, long memory.',
    worth: 8,
    look: { hairStyle: 'bun', hair: 4, accessory: 'glasses', shirt: 5 },
  },
  ivy: {
    name: 'Iron-Gut Ivy',
    quip: 'Forty years at sea. Ate a storm once.',
    stomach: 8,
    composure: 3,
    rule: 'waves',
    ruleName: 'Rough Seas',
    ruleDesc: 'Every 5 swipes a wave sloshes the whole board one way. Watch the forecast.',
    trait: 'Only Drops and inversions get to her, but those hit double.',
    hit: (t, inv) => (t === 3 || inv ? 2 : 0),
    worth: 8,
    look: { shirt: 1, hairStyle: 'cap', hair: 4 },
  },
  lou: {
    name: 'Lifeguard Lou',
    quip: 'NO RUNNING. NO DIVING. NO FUN.',
    stomach: 10,
    composure: 3,
    rule: 'whistle',
    ruleName: 'No Running!',
    ruleDesc: 'Every swipe that merges nothing drops in two extra tiles. Keep it tidy.',
    trait: 'Hard to impress. Everything hits him normally.',
    worth: 8,
    look: { shirt: 0, hairStyle: 'spiky', hair: 3, accessory: 'shades' },
  },
  vertigo: {
    name: 'Dr. Vertigo',
    quip: 'Wrote the textbook on motion sickness. Immune, allegedly.',
    stomach: 12,
    composure: 3,
    rule: 'spin',
    ruleName: 'Spin Cycle',
    ruleDesc: 'Every 6 swipes your controls turn a quarter turn clockwise. Check the compass.',
    trait: 'Barely notices small stuff; Corkscrews and Mega Loops hit triple.',
    hit: (t) => (t >= 6 ? 3 : 0.5),
    worth: 10,
    look: { shirt: 8, hairStyle: 'spiky', hair: 4, accessory: 'glasses' },
  },
  count: {
    name: 'Count Queasy',
    quip: 'Undead for 300 years. Has not felt a thing since.',
    stomach: 12,
    composure: 3,
    rule: 'blackout',
    ruleName: 'Lights Out',
    ruleDesc: 'The fog closes in: only tiles right next to your track can be seen.',
    trait: 'Only feels upside-down pieces, but those hit double.',
    hit: (_t, inv) => (inv ? 2 : 0),
    worth: 10,
    look: { skin: 5, hairStyle: 'short', hair: 0, shirt: 8, pants: 0, accessory: 'none' },
  },
  mayor: {
    name: 'The Mayor',
    quip: 'Has ridden every coaster in the state. Unshakeable, on paper.',
    stomach: 16,
    composure: 4,
    rule: 'demands',
    ruleName: 'Inspection Day',
    ruleDesc: 'The ride must meet all three of the Mayor’s demands, or the Mayor won’t get on.',
    trait: 'Everything hits normally. There is just a lot of Mayor.',
    worth: 12,
    look: { shirt: 4, hairStyle: 'short', hair: 5, accessory: 'shades' },
  },
};

/** Who might be waiting at the end of each park. */
export const BOSS_POOL: Record<ParkId, BossId[]> = {
  meadow: ['barry', 'granny'],
  boardwalk: ['ivy', 'lou'],
  hollow: ['vertigo', 'count'],
  finale: ['mayor'],
};

function profile(r: Rider): Profile {
  return r.boss ? BOSSES[r.boss] : KINDS[r.kind as Exclude<RiderKind, 'boss'>];
}

export function riderLabel(r: Rider): string {
  return r.boss ? 'Boss' : KINDS[r.kind as Exclude<RiderKind, 'boss'>].label;
}

export function riderTrait(r: Rider): string {
  return profile(r).trait;
}

export function riderWorth(r: Rider): number {
  return profile(r).worth ?? 1;
}

/** Nausea one piece gives this rider, before attraction bonuses. */
export function pieceNausea(r: Rider, tier: number, inv = PIECES[tier].inversion): number {
  return PIECES[tier].nausea * (profile(r).hit?.(tier, inv) ?? 1);
}

/** How many times a rider pukes for a given total nausea. */
export function pukesFor(nausea: number, stomach: number): number {
  return Math.min(MAX_PUKES, Math.floor(nausea / Math.max(2, stomach)));
}

const FIRST = [
  'Dot', 'Gus', 'Mo', 'Pip', 'Rex', 'Lou', 'Bea', 'Taz', 'Ned', 'Ivy', 'Hal', 'Kit',
  'Zed', 'Flo', 'Abe', 'Uma', 'Rod', 'Wen', 'Cy', 'Vi', 'Otto', 'Bo', 'Sal', 'June',
];
const PREFIX: Partial<Record<RiderKind, string>> = { grandma: 'Nana', kid: 'Lil', ghost: 'Boo', vip: 'Mx.' };

function baseLook(rng: Rng): Look {
  return {
    skin: rng.int(5),
    hair: rng.int(8),
    hairStyle: rng.pick(['short', 'long', 'bald', 'short', 'long'] as const),
    shirt: rng.int(9),
    pants: rng.int(4),
    accessory: 'none',
    small: false,
  };
}

export function makeRider(rng: Rng, day: number, id: number, park: ParkId = 'meadow', kind?: Exclude<RiderKind, 'boss'>): Rider {
  if (!kind) {
    const kinds = (Object.keys(KINDS) as Exclude<RiderKind, 'boss'>[]).filter(
      (k) => KINDS[k].weight > 0 && KINDS[k].minDay <= day && (!KINDS[k].parks || KINDS[k].parks!.includes(park)),
    );
    const total = kinds.reduce((a, k) => a + KINDS[k].weight, 0);
    let roll = rng.next() * total;
    kind = kinds[0];
    for (const k of kinds) {
      roll -= KINDS[k].weight;
      if (roll < 0) {
        kind = k;
        break;
      }
    }
  }
  const def = KINDS[kind];
  const first = rng.pick(FIRST);
  return {
    id,
    kind,
    name: PREFIX[kind] ? `${PREFIX[kind]} ${first}` : first,
    look: { ...baseLook(rng), ...def.look(rng) },
    stomach: def.stomach(day),
  };
}

export function makeVip(rng: Rng, day: number, id: number): Rider {
  return makeRider(rng, day, id, 'meadow', 'vip');
}

export function makeBoss(rng: Rng, boss: BossId, id: number): Rider {
  const def = BOSSES[boss];
  return { id, kind: 'boss', boss, name: def.name, look: { ...baseLook(rng), ...def.look, big: true }, stomach: def.stomach };
}

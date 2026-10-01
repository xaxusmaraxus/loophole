import type { RideStats } from '../puzzle/pieces';

// Attractions are the park's jokers: up to five cards that change how a ride
// scores. They apply left to right, so their order matters, like Balatro.
//   rating = round(excitement × multiplier)   (halved for a shuttle)
// and every puke is worth the rating.

export type AttractionId =
  | 'loopdeloop'
  | 'longhaul'
  | 'flatearth'
  | 'chaingang'
  | 'collector'
  | 'photobooth'
  | 'seasonpass'
  | 'earlybird'
  | 'splashzone'
  | 'corndogcart'
  | 'tilttable'
  | 'crowdpleaser'
  | 'quicktrip'
  | 'adrenaline'
  | 'twilight'
  | 'funnelcake'
  // Legendaries: only bosses drop these.
  | 'ferris'
  | 'mirrors'
  | 'gravitywell'
  | 'buffet'
  | 'fountain'
  | 'thunder';

/**
 * Every attraction (and upgrade) belongs to a part of the park. On the park plot,
 * an attraction gets +1 multiplier for each touching neighbor of the same theme.
 */
export type Theme = 'thrill' | 'food' | 'show' | 'garden';

export const THEMES: Record<Theme, { name: string; color: string; icon: string }> = {
  thrill: { name: 'Thrills', color: '#f0584e', icon: '🎢' },
  food: { name: 'Food', color: '#ffb02e', icon: '🌭' },
  show: { name: 'Shows', color: '#a070e0', icon: '🎪' },
  garden: { name: 'Gardens', color: '#56b85a', icon: '🌳' },
};

export type Rarity = 'common' | 'rare' | 'legendary';

export interface ScoreContext {
  stats: RideStats;
  riders: number;
  /** Riders in line who would puke at least once. */
  pukers: number;
  chainLinks: number;
  daylightLeft: number;
  /** Pukes on the ride (each rider's count, not weighted by worth). */
  pukes: number;
}

export interface Effect {
  chips?: number;
  mult?: number;
  xmult?: number;
}

export interface AttractionDef {
  name: string;
  desc: string;
  rarity: Rarity;
  theme: Theme;
  /** `self` is the attraction as placed: how many attractions touch it on the plot. */
  effect: (ctx: ScoreContext, counter: number, self: { touching: number }) => Effect | null;
}

const when = (cond: boolean, e: Effect): Effect | null => (cond ? e : null);

export const ATTRACTIONS: Record<AttractionId, AttractionDef> = {
  loopdeloop: {
    name: 'Loop-de-Loop',
    desc: '+2 multiplier for each inversion.',
    rarity: 'common',
    theme: 'thrill',
    effect: (c) => when(c.stats.inversions > 0, { mult: 2 * c.stats.inversions }),
  },
  longhaul: {
    name: 'Long Haul',
    desc: '+3 excitement for each track piece.',
    rarity: 'common',
    theme: 'garden',
    effect: (c) => when(c.stats.length > 0, { chips: 3 * c.stats.length }),
  },
  flatearth: {
    name: 'Flat Earth Society',
    desc: '+8 excitement for each Flat piece.',
    rarity: 'common',
    theme: 'garden',
    effect: (c) => when(c.stats.tierCounts[0] > 0, { chips: 8 * c.stats.tierCounts[0] }),
  },
  chaingang: {
    name: 'Chain Gang',
    desc: '+1 multiplier for each chain link you set off today.',
    rarity: 'common',
    theme: 'show',
    effect: (c) => when(c.chainLinks > 0, { mult: c.chainLinks }),
  },
  collector: {
    name: "Collector's Set",
    desc: '×2 multiplier with 5 or more piece types.',
    rarity: 'rare',
    theme: 'show',
    effect: (c) => when(c.stats.variety >= 5, { xmult: 2 }),
  },
  photobooth: {
    name: 'Photo Booth',
    desc: '×1.5 multiplier for each Mega Loop.',
    rarity: 'rare',
    theme: 'show',
    effect: (c) => when(c.stats.tierCounts[7] > 0, { xmult: 1.5 ** c.stats.tierCounts[7] }),
  },
  seasonpass: {
    name: 'Season Pass',
    desc: '+1 multiplier, and +1 more every day you beat the target.',
    rarity: 'rare',
    theme: 'show',
    effect: (_c, n) => ({ mult: 1 + n }),
  },
  earlybird: {
    name: 'Early Bird Special',
    desc: '×2 multiplier if nothing goes upside down.',
    rarity: 'common',
    theme: 'food',
    effect: (c) => when(c.stats.length > 0 && c.stats.inversions === 0, { xmult: 2 }),
  },
  splashzone: {
    name: 'Splash Zone',
    desc: '+1 multiplier for each rider who pukes.',
    rarity: 'common',
    theme: 'garden',
    effect: (c) => when(c.pukers > 0, { mult: c.pukers }),
  },
  corndogcart: {
    name: 'Corn Dog Cart',
    desc: 'Every rider’s stomach is 2 smaller.',
    rarity: 'rare',
    theme: 'food',
    effect: () => null,
  },
  tilttable: {
    name: 'Tilt Table',
    desc: 'Helixes make every rider 3 sicker.',
    rarity: 'common',
    theme: 'thrill',
    effect: () => null,
  },
  crowdpleaser: {
    name: 'Crowd Pleaser',
    desc: '+0.5 multiplier for each rider in line.',
    rarity: 'common',
    theme: 'show',
    effect: (c) => when(c.riders > 0, { mult: 0.5 * c.riders }),
  },
  quicktrip: {
    name: 'Quick Trip',
    desc: '×3 multiplier if the ride is 6 pieces or shorter.',
    rarity: 'rare',
    theme: 'thrill',
    effect: (c) => when(c.stats.length > 0 && c.stats.length <= 6, { xmult: 3 }),
  },
  adrenaline: {
    name: 'Adrenaline Junkie',
    desc: '+1 multiplier for every 10 thrill.',
    rarity: 'common',
    theme: 'thrill',
    effect: (c) => when(c.stats.thrill >= 10, { mult: Math.floor(c.stats.thrill / 10) }),
  },
  twilight: {
    name: 'Twilight Ride',
    desc: '+6 excitement for each swipe of daylight left when you open.',
    rarity: 'common',
    theme: 'garden',
    effect: (c) => when(c.daylightLeft > 0, { chips: 6 * c.daylightLeft }),
  },
  funnelcake: {
    name: 'Funnel Cake Stand',
    desc: 'Every rider’s stomach is 1 smaller for each Food spot touching it.',
    rarity: 'common',
    theme: 'food',
    effect: () => null,
  },
  // ---- Legendaries (boss rewards): big, 2×2, often with a catch. ----
  ferris: {
    name: 'Ferris Wheel of Fortune',
    desc: '×1.3 multiplier for each attraction touching it.',
    rarity: 'legendary',
    theme: 'show',
    effect: (_c, _n, self) => when(self.touching > 0, { xmult: Math.round(1.3 ** self.touching * 100) / 100 }),
  },
  mirrors: {
    name: 'Hall of Mirrors',
    desc: 'Every attraction touching it fires a second time.',
    rarity: 'legendary',
    theme: 'show',
    effect: () => null,
  },
  gravitywell: {
    name: 'Gravity Well',
    desc: 'Upside-down pieces make every rider 2 sicker. Drops make nobody sick.',
    rarity: 'legendary',
    theme: 'thrill',
    effect: () => null,
  },
  buffet: {
    name: 'All-You-Can-Eat Buffet',
    desc: 'Every rider’s stomach is 3 smaller, but the line holds 3 fewer riders.',
    rarity: 'legendary',
    theme: 'food',
    effect: () => null,
  },
  fountain: {
    name: 'Puke Fountain',
    desc: '+1 multiplier for every puke on the ride.',
    rarity: 'legendary',
    theme: 'garden',
    effect: (c) => when(c.pukes > 0, { mult: c.pukes }),
  },
  thunder: {
    name: 'Thunder Mountain',
    desc: '×4 multiplier if the ride is 12 pieces or longer.',
    rarity: 'legendary',
    theme: 'thrill',
    effect: (c) => when(c.stats.length >= 12, { xmult: 4 }),
  },
};

export const LEGENDARIES = (Object.keys(ATTRACTIONS) as AttractionId[]).filter((a) => ATTRACTIONS[a].rarity === 'legendary');

export interface OwnedAttraction {
  id: AttractionId;
  /** Scaling cards (Season Pass) remember their growth here. */
  counter: number;
  /** On the plot: indices (into the scoring list) of the attractions touching this one. */
  touching?: number[];
  /** On the plot: touching neighbors of the same theme (attractions or upgrades), +1 mult each. */
  district?: number;
}

export interface ScoreStep {
  label: string;
  effect: Effect;
  chips: number;
  mult: number;
  /** Which attraction slot fired this step (absent for the base line and the shuttle). */
  slot?: number;
}

export interface Score {
  chips: number;
  mult: number;
  /** What each rider pays before tips. */
  rating: number;
  /** Base line, then one line per attraction that fired, for the ride report. */
  steps: ScoreStep[];
}

export function scoreRide(ctx: ScoreContext, owned: readonly OwnedAttraction[], shuttle: boolean): Score {
  let chips = ctx.stats.chips;
  let mult = ctx.stats.mult;
  const steps: ScoreStep[] = [{ label: 'Your ride', effect: { chips, mult }, chips, mult }];
  const apply = (e: Effect, label: string, slot: number) => {
    chips += e.chips ?? 0;
    mult += e.mult ?? 0;
    mult *= e.xmult ?? 1;
    steps.push({ label, effect: e, chips, mult, slot });
  };
  const fire = (a: OwnedAttraction) => ATTRACTIONS[a.id].effect(ctx, a.counter, { touching: a.touching?.length ?? 0 });
  for (const [slot, a] of owned.entries()) {
    const def = ATTRACTIONS[a.id];
    let e = fire(a);
    if (a.district) e = { ...e, mult: (e?.mult ?? 0) + a.district };
    if (e) apply(e, a.district ? `${def.name} (+${a.district} district)` : def.name, slot);
    // The Hall of Mirrors fires its neighbors again (not other mirrors).
    if (a.id === 'mirrors')
      for (const j of a.touching ?? []) {
        const b = owned[j];
        if (!b || b.id === 'mirrors') continue;
        const again = fire(b);
        if (again) apply(again, `${def.name}: ${ATTRACTIONS[b.id].name}`, slot);
      }
  }
  mult = Math.round(mult * 100) / 100;
  let rating = Math.round(chips * mult);
  if (shuttle) {
    rating = Math.round(rating / 2);
    steps.push({ label: 'Shuttle (half)', effect: { xmult: 0.5 }, chips, mult: mult / 2 });
  }
  return { chips, mult, rating, steps };
}

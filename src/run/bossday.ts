import type { Rng } from '../core/rng';
import type { Dir } from '../puzzle/board';
import type { RideStats } from '../puzzle/pieces';

// Boss days. The boss is drawn from the park's pool when you arrive, so you see
// who's waiting at the top of the map and can prepare. On the day they bend the
// rules (see BossRule in riders.ts). They ride once, when you close the park:
// every time they puke on that ride, their composure cracks a little more.

/** Swipes between the boss's rule kicking in. */
export const SECONDS_EVERY = 4;
/** Big Barry can only eat so much: his stomach grows by at most this. */
export const SECONDS_CAP = 6;
export const WAVE_EVERY = 5;
export const SPIN_EVERY = 6;
/** Tiles a dry swipe drops in on Lifeguard Lou's day. */
export const WHISTLE_COST = 3;

export type DemandId = 'long' | 'loop' | 'drop' | 'variety' | 'park' | 'helix' | 'circuit';

export interface DemandDef {
  text: string;
  met: (s: RideStats, circuit: boolean) => boolean;
}

export const DEMANDS: Record<DemandId, DemandDef> = {
  long: { text: 'At least 12 pieces of track', met: (s) => s.length >= 12 },
  loop: { text: 'Something goes upside down', met: (s) => s.inversions > 0 },
  drop: { text: 'At least one Lift Hill', met: (s) => s.tierCounts[2] > 0 },
  variety: { text: '4 or more piece types', met: (s) => s.variety >= 4 },
  park: { text: 'A park piece (spinning, water or hanging)', met: (s) => s.flavors.spin + s.flavors.water + s.flavors.hang > 0 },
  helix: { text: 'A Corkscrew or bigger', met: (s) => s.topTier >= 5 },
  circuit: { text: 'A full circuit, no shuttles', met: (_s, c) => c },
};

export function pickDemands(rng: Rng): DemandId[] {
  return rng.shuffle(Object.keys(DEMANDS) as DemandId[]).slice(0, 3);
}

const CLOCKWISE: Dir[] = ['up', 'right', 'down', 'left'];

/** Where a swipe really goes after the controls have turned `quarters` quarter turns clockwise. */
export function spun(dir: Dir, quarters: number): Dir {
  return CLOCKWISE[(CLOCKWISE.indexOf(dir) + quarters) % 4];
}

/** A boss fight in progress. */
export interface BossFight {
  /** Ride number, from 1. */
  round: number;
  /** Pukes still needed to break them. */
  hp: number;
  max: number;
  /** Tickets sold on earlier rides today. */
  banked: number;
  /** Ivy: the direction of the next wave. */
  wave: Dir;
  /** Vertigo: quarter turns the controls have made. */
  spin: number;
  /** The Mayor's demands. */
  demands: DemandId[];
}

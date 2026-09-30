import type { SpecialId } from '../puzzle/pieces';
import type { BossId } from '../riders/riders';
import type { ToolId } from './run';

// Meta-progression: what you've done across all your seasons unlocks new things
// for the next ones. Special pieces join the rewards and the shop, starting
// tools ride along into every new season, and the station gets new paint.
// The record is plain data; the page keeps it in local storage.

export interface PlayRecord {
  seasons: number;
  wins: number;
  bosses: BossId[];
  totalPukes: number;
  bestRide: number;
  unlocked: UnlockId[];
  /** The station paint job picked from the unlocked ones. */
  station: StationStyle;
}

export type StationStyle = 'classic' | 'candy' | 'gold';

export type UnlockId = 'launch' | 'splash' | 'brakes' | 'coffee' | 'crane' | 'candy' | 'gold' | 'bigride';

export interface UnlockDef {
  name: string;
  desc: string;
  /** How to earn it, shown while it's locked. */
  how: string;
  earned: (r: PlayRecord) => boolean;
}

export const UNLOCKS: { [K in UnlockId]: UnlockDef } = {
  launch: { name: 'Launch pieces', desc: 'Special piece: +10 thrill, and the next piece hits double.', how: 'Make Big Barry puke.', earned: (r) => r.bosses.includes('barry') },
  splash: { name: 'Water Splash pieces', desc: 'Special piece: +1 multiplier and soaked riders.', how: 'Make Iron-Gut Ivy puke.', earned: (r) => r.bosses.includes('ivy') },
  brakes: { name: 'Brake Run pieces', desc: 'Special piece: +3 nausea for every rider.', how: 'Make Dr. Vertigo puke.', earned: (r) => r.bosses.includes('vertigo') },
  coffee: { name: 'Thermos', desc: 'Every new season starts with an extra Coffee.', how: 'Make guests puke 100 times.', earned: (r) => r.totalPukes >= 100 },
  crane: { name: 'Crane license', desc: 'Every new season starts with a Crane.', how: 'Make guests puke 500 times.', earned: (r) => r.totalPukes >= 500 },
  bigride: { name: 'Headliner', desc: 'Every new season starts with a Launch piece.', how: 'Sell 100,000 tickets on a single ride.', earned: (r) => r.bestRide >= 100000 },
  candy: { name: 'Candy-stripe station', desc: 'A pink and mint paint job for the station.', how: 'Play 3 seasons.', earned: (r) => r.seasons >= 3 },
  gold: { name: 'Golden station', desc: 'A gold-plated station with gold rails.', how: 'Win a season.', earned: (r) => r.wins >= 1 },
};

export function emptyRecord(): PlayRecord {
  return { seasons: 0, wins: 0, bosses: [], totalPukes: 0, bestRide: 0, unlocked: [], station: 'classic' };
}

/** Adds anything newly earned to `r.unlocked` and returns it. */
export function checkUnlocks(r: PlayRecord): UnlockId[] {
  const fresh = (Object.keys(UNLOCKS) as UnlockId[]).filter((id) => !r.unlocked.includes(id) && UNLOCKS[id].earned(r));
  r.unlocked.push(...fresh);
  return fresh;
}

export function unlockedSpecials(r: PlayRecord): SpecialId[] {
  return (['launch', 'splash', 'brakes'] as const).filter((id) => r.unlocked.includes(id));
}

/** Charges every new season starts with, from unlocks. */
export function startingKit(r: PlayRecord): { tools: Partial<{ [K in ToolId]: number }>; specials: Partial<{ [K in SpecialId]: number }> } {
  return {
    tools: { ...(r.unlocked.includes('coffee') ? { coffee: 1 } : {}), ...(r.unlocked.includes('crane') ? { crane: 1 } : {}) },
    specials: r.unlocked.includes('bigride') ? { launch: 1 } : {},
  };
}

export function stationStyles(r: PlayRecord): StationStyle[] {
  return ['classic', ...(r.unlocked.includes('candy') ? (['candy'] as const) : []), ...(r.unlocked.includes('gold') ? (['gold'] as const) : [])];
}

// The merge ladder. Tier 0 (Flat) is never a tile: it's what gets laid when
// the track head moves into an empty cell. Two tiles of tier N merge into N+1.
export interface Piece {
  name: string;
  thrill: number;
  nausea: number;
  inversion: boolean;
}

export const PIECES: readonly Piece[] = [
  { name: 'Flat', thrill: 0, nausea: 0, inversion: false },
  { name: 'Bump', thrill: 1, nausea: 0, inversion: false },
  { name: 'Hill', thrill: 2, nausea: 1, inversion: false },
  { name: 'Drop', thrill: 4, nausea: 2, inversion: false },
  { name: 'Helix', thrill: 6, nausea: 3, inversion: false },
  { name: 'Loop', thrill: 9, nausea: 4, inversion: true },
  { name: 'Corkscrew', thrill: 13, nausea: 6, inversion: true },
  { name: 'Mega Loop', thrill: 20, nausea: 9, inversion: true },
];

export const MAX_TIER = PIECES.length - 1;

export function mergeTier(tier: number): number {
  return Math.min(tier + 1, MAX_TIER);
}

export interface RideStats {
  length: number;
  thrill: number;
  nausea: number;
  inversions: number;
  topTier: number;
  /** Distinct piece types used (Flat doesn't count). */
  variety: number;
  /** The headline rating: every rider pays this as their ticket. */
  excitement: number;
}

export interface StatMods {
  thrillMult: number;
  flatThrill: number;
}

/**
 * Excitement rewards everything wild: each cell of length, all the thrill,
 * and +10% for every distinct piece type past the first.
 */
export function rideStats(path: readonly { tier: number }[], mods: StatMods, shuttle = false): RideStats {
  let thrill = 0;
  let nausea = 0;
  let inversions = 0;
  let topTier = 0;
  const kinds = new Set<number>();
  for (const { tier } of path) {
    const p = PIECES[tier];
    thrill += p.thrill + (tier === 0 ? mods.flatThrill : 0);
    nausea += p.nausea;
    if (p.inversion) inversions++;
    if (tier > 0) kinds.add(tier);
    topTier = Math.max(topTier, tier);
  }
  thrill = Math.round(thrill * mods.thrillMult);
  const variety = kinds.size;
  const raw = (thrill + path.length) * (1 + 0.1 * Math.max(0, variety - 1));
  const excitement = Math.round(raw * (shuttle ? 0.5 : 1));
  return { length: path.length, thrill, nausea, inversions, topTier, variety, excitement };
}

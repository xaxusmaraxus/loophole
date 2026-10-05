// The merge ladder. Tier 0 (Flat) is never a tile: it's what gets laid when
// the track head moves into an empty cell. Two tiles of tier N merge into N+1.
export interface Piece {
  name: string;
  thrill: number;
  nausea: number;
  inversion: boolean;
}

// Every tier is a real coaster element (v0.25). The Lift Hill does nothing on
// its own: it stores height for the next element (see liftPlan).
export const PIECES: readonly Piece[] = [
  { name: 'Flat', thrill: 0, nausea: 0, inversion: false },
  { name: 'Airtime Hill', thrill: 1, nausea: 1, inversion: false },
  { name: 'Lift Hill', thrill: 0, nausea: 0, inversion: false },
  { name: 'Helix', thrill: 4, nausea: 2, inversion: false },
  { name: 'Vertical Loop', thrill: 8, nausea: 4, inversion: true },
  { name: 'Corkscrew', thrill: 12, nausea: 6, inversion: true },
  { name: 'Cobra Roll', thrill: 17, nausea: 8, inversion: true },
  { name: 'Top Hat', thrill: 24, nausea: 10, inversion: false },
];

/** The Lift Hill's tier: it charges the next element instead of thrilling on its own. */
export const LIFT = 2;
/** Height left over at the end of the ride drops into the station: thrill and nausea per lift. */
export const FINALE_THRILL = 6;
export const FINALE_NAUSEA = 3;

/**
 * Lift Hills store height; the first proper element after them (any piece but a
 * Flat or another lift) cashes it in: it hits ×(1 + lifts) harder. Height still
 * stored at the end of the ride becomes a finale drop into the station.
 * Returns, per piece in ride order, its multiplier and the finale lifts it pays
 * (only on the last lift of a chain that nothing cashes in).
 */
export function liftPlan(path: readonly { tier: number }[]): { mult: number[]; finale: number[] } {
  const mult = path.map(() => 1);
  const finale = path.map(() => 0);
  let charge = 0;
  let lastLift = -1;
  path.forEach((c, i) => {
    if (c.tier === LIFT) {
      charge++;
      lastLift = i;
    } else if (c.tier > 0) {
      mult[i] = 1 + charge;
      charge = 0;
    }
  });
  if (charge > 0 && lastLift >= 0) finale[lastLift] = charge;
  return { mult, finale };
}

/** Each piece's raw thrill in ride order, lifts and the finale drop included. */
export function pathThrills(path: readonly PieceCell[], mods: StatMods): number[] {
  const plan = liftPlan(path);
  return path.map((c, i) => cellThrill(c, mods) * plan.mult[i] + FINALE_THRILL * plan.finale[i]);
}

export const MAX_TIER = PIECES.length - 1;

// Special pieces get fitted onto built track (they come from rewards once unlocked):
//  - Launch: a catapult start: +10 thrill, and the piece after it hits every rider double.
//  - Water Splash: a splashdown that soaks the riders: +1 multiplier.
//  - Brake Run: slams the train to a stop and off again: +3 nausea for everyone.
export type SpecialId = 'launch' | 'splash' | 'brakes';

export const SPECIALS: Record<SpecialId, { name: string; desc: string }> = {
  launch: { name: 'Launch', desc: 'Fit onto track: +10 thrill, and the piece after it hits every rider double.' },
  splash: { name: 'Water Splash', desc: 'Fit onto track: a splashdown that soaks the riders. +1 multiplier.' },
  brakes: { name: 'Brake Run', desc: 'Fit onto track: slams the train to a stop and off again. +3 nausea for every rider.' },
};

// Park pieces: each park's own kind of ride, carried by tiles as a "flavor".
// Tiles made by a chain reaction take the park's flavor (a few spawn with it),
// and the flavor rides up the merge ladder and into the track.
//  - Spinning (Meadow): the car whirls through it: nausea ×1.5 (rounded up), +2 thrill.
//  - Water (Boardwalk): a flume run: +1 multiplier.
//  - Hanging (Hollow): the train hangs under the rail: +3 thrill, and it counts as upside down.
export type Flavor = 'spin' | 'water' | 'hang';

export const FLAVORS: Record<Flavor, { name: string; desc: string; icon: string }> = {
  spin: { name: 'Spinning', desc: 'The car whirls through it: nausea ×1.5 and +2 thrill.', icon: '🌀' },
  water: { name: 'Water', desc: 'A flume run: +1 multiplier.', icon: '💧' },
  hang: { name: 'Hanging', desc: 'The train hangs under the rail: +3 thrill, and it counts as upside down.', icon: '🦇' },
};

export const SPIN_THRILL = 2;
export const SPIN_NAUSEA = 1.5;
export const HANG_THRILL = 3;
export const WATER_MULT = 1;

/** Does this piece go (or count as going) upside down? */
export function invertedCell(c: { tier: number; flavor?: Flavor | null }): boolean {
  return PIECES[c.tier].inversion || c.flavor === 'hang';
}

export const PIER_THRILL = 2;
export const CROSS_THRILL = 3;
export const LAUNCH_THRILL = 10;
export const SPLASH_MULT = 1;
export const BRAKES_NAUSEA = 3;

/** What a track cell is, for scoring: its piece, plus anything special about it. */
export interface PieceCell {
  tier: number;
  /** A pier run over a pond: flat, with a sea breeze. */
  pier?: boolean;
  /** A bridge or tunnel pass: a near miss with the track it crosses. */
  cross?: boolean;
  special?: SpecialId;
  /** A park piece. */
  flavor?: Flavor | null;
}

/** Raw thrill of one cell, before the run's thrill multiplier. */
export function cellThrill(c: PieceCell, mods: StatMods): number {
  return (
    PIECES[c.tier].thrill +
    (c.tier === 0 ? mods.flatThrill : 0) +
    (c.pier ? PIER_THRILL : 0) +
    (c.cross ? CROSS_THRILL : 0) +
    (c.special === 'launch' ? LAUNCH_THRILL : 0) +
    (c.flavor === 'spin' ? SPIN_THRILL : 0) +
    (c.flavor === 'hang' ? HANG_THRILL + (mods.hangThrill ?? 0) : 0)
  );
}

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
  /** How many pieces of each tier the track has. */
  tierCounts: number[];
  /** Base excitement (Balatro's chips): thrill + length. */
  chips: number;
  /** Base multiplier: 1, +0.5 per distinct piece type past the first, +1 per Water Splash. */
  mult: number;
  /** Bridges and tunnels. */
  crossings: number;
  /** Park pieces of each kind. */
  flavors: Record<Flavor, number>;
}

export interface StatMods {
  thrillMult: number;
  flatThrill: number;
  /** Extra multiplier per water piece (on top of WATER_MULT). */
  waterMult?: number;
  /** Extra thrill per hanging piece. */
  hangThrill?: number;
}

/** What one water piece adds to the multiplier. */
export const waterMult = (mods: StatMods) => WATER_MULT + (mods.waterMult ?? 0);

export function rideStats(path: readonly PieceCell[], mods: StatMods): RideStats {
  let thrill = 0;
  let nausea = 0;
  let inversions = 0;
  let topTier = 0;
  let splashes = 0;
  let crossings = 0;
  const flavors: Record<Flavor, number> = { spin: 0, water: 0, hang: 0 };
  const tierCounts = new Array<number>(PIECES.length).fill(0);
  const plan = liftPlan(path);
  const thrills = pathThrills(path, mods);
  for (const [i, c] of path.entries()) {
    const { tier } = c;
    const p = PIECES[tier];
    thrill += thrills[i];
    nausea += p.nausea * plan.mult[i] + FINALE_NAUSEA * plan.finale[i] + (c.special === 'brakes' ? BRAKES_NAUSEA : 0);
    if (c.special === 'splash') splashes++;
    if (c.cross) crossings++;
    if (invertedCell(c)) inversions++;
    if (c.flavor) flavors[c.flavor]++;
    tierCounts[tier]++;
    topTier = Math.max(topTier, tier);
  }
  thrill = Math.round(thrill * mods.thrillMult);
  const variety = tierCounts.filter((n, t) => t > 0 && n > 0).length;
  return {
    length: path.length,
    thrill,
    nausea,
    inversions,
    topTier,
    variety,
    tierCounts,
    chips: thrill + path.length,
    mult: 1 + 0.5 * Math.max(0, variety - 1) + SPLASH_MULT * splashes + waterMult(mods) * flavors.water,
    crossings,
    flavors,
  };
}

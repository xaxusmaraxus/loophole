import type { Rng } from '../core/rng';
import type { RideStats } from '../puzzle/pieces';

export type RiderKind = 'thrill' | 'looper' | 'grandma' | 'nerd' | 'corndog' | 'kid' | 'critic';
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
}

export interface Rider {
  id: number;
  kind: RiderKind;
  name: string;
  look: Look;
  tolerance: number;
  /** Kind-specific threshold (thrill, length, inversions...). */
  target: number;
}

/** happy = wish met, pays double; meh = pays the ticket; sick = wants half back. */
export type Verdict = 'happy' | 'meh' | 'sick';

interface KindDef {
  label: string;
  minDay: number;
  weight: number;
  tolerance: (day: number) => number;
  target: (day: number) => number;
  want: (r: Rider) => string;
  happy: (r: Rider, s: RideStats) => boolean;
  look: (rng: Rng) => Partial<Look>;
}

export const KINDS: Record<RiderKind, KindDef> = {
  thrill: {
    label: 'Thrill Seeker',
    minDay: 1,
    weight: 3,
    tolerance: (d) => 14 + d,
    target: (d) => 6 + d * 3,
    want: (r) => `Thrill ${r.target} or more`,
    happy: (r, s) => s.thrill >= r.target,
    look: () => ({ accessory: 'shades' }),
  },
  looper: {
    label: 'Loop Lover',
    minDay: 1,
    weight: 2,
    tolerance: (d) => 12 + d,
    target: (d) => (d >= 5 ? 2 : 1),
    want: (r) => (r.target > 1 ? `${r.target} inversions` : 'Go upside down'),
    happy: (r, s) => s.inversions >= r.target,
    look: (rng) => ({ hairStyle: 'spiky', hair: rng.pick([6, 7, 3]) }),
  },
  grandma: {
    label: 'Grandma',
    minDay: 1,
    weight: 2,
    tolerance: () => 5,
    target: () => 3,
    want: () => 'Nothing upside down',
    happy: (r, s) => s.inversions === 0 && s.thrill >= r.target,
    look: () => ({ hairStyle: 'bun', hair: 4, accessory: 'glasses' }),
  },
  nerd: {
    label: 'Coaster Nerd',
    minDay: 1,
    weight: 2,
    tolerance: () => 13,
    target: (d) => 6 + d,
    want: (r) => `Ride length ${r.target}+`,
    happy: (r, s) => s.length >= r.target,
    look: () => ({ hairStyle: 'cap', accessory: 'camera' }),
  },
  corndog: {
    label: 'Just Ate',
    minDay: 2,
    weight: 2,
    tolerance: (d) => 3 + Math.floor(d / 3),
    target: (d) => 3 + d,
    want: (r) => `Thrill ${r.target}+, easy on the stomach`,
    happy: (r, s) => s.thrill >= r.target,
    look: () => ({ accessory: 'corndog' }),
  },
  critic: {
    label: 'Coaster Critic',
    minDay: 2,
    weight: 2,
    tolerance: () => 14,
    target: (d) => Math.min(6, 3 + Math.floor(d / 2)),
    want: (r) => `${r.target} different piece types`,
    happy: (r, s) => s.variety >= r.target,
    look: () => ({ accessory: 'glasses', hairStyle: 'short' }),
  },
  kid: {
    label: 'Kid',
    minDay: 2,
    weight: 2,
    tolerance: () => 9,
    target: () => 3,
    want: () => 'A big Drop!',
    happy: (r, s) => s.topTier >= r.target,
    look: () => ({ small: true, accessory: 'balloon' }),
  },
};

const FIRST = [
  'Dot', 'Gus', 'Mo', 'Pip', 'Rex', 'Lou', 'Bea', 'Taz', 'Ned', 'Ivy', 'Hal', 'Kit',
  'Zed', 'Flo', 'Abe', 'Uma', 'Rod', 'Wen', 'Cy', 'Vi', 'Otto', 'Bo', 'Sal', 'June',
];
const PREFIX: Partial<Record<RiderKind, string>> = { grandma: 'Nana', kid: 'Lil' };

export function makeRider(rng: Rng, day: number, id: number): Rider {
  const kinds = (Object.keys(KINDS) as RiderKind[]).filter((k) => KINDS[k].minDay <= day);
  const total = kinds.reduce((a, k) => a + KINDS[k].weight, 0);
  let roll = rng.next() * total;
  let kind = kinds[0];
  for (const k of kinds) {
    roll -= KINDS[k].weight;
    if (roll < 0) {
      kind = k;
      break;
    }
  }
  const def = KINDS[kind];
  const look: Look = {
    skin: rng.int(5),
    hair: rng.int(8),
    hairStyle: rng.pick(['short', 'long', 'bald', 'short', 'long'] as const),
    shirt: rng.int(9),
    pants: rng.int(4),
    accessory: 'none',
    small: false,
    ...def.look(rng),
  };
  const first = rng.pick(FIRST);
  return {
    id,
    kind,
    name: PREFIX[kind] ? `${PREFIX[kind]} ${first}` : first,
    look,
    tolerance: def.tolerance(day),
    target: def.target(day),
  };
}

export function evaluate(r: Rider, s: RideStats, toleranceBonus: number): Verdict {
  if (s.nausea > r.tolerance + toleranceBonus) return 'sick';
  return KINDS[r.kind].happy(r, s) ? 'happy' : 'meh';
}

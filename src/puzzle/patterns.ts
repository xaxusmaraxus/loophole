// Ride patterns: the track read as a poker hand. The ride is a sequence of
// elements (Flats are just filler and don't count), and certain sequences score
// as named patterns that add to the multiplier. Because every bulge inserts its
// pieces at one spot in the loop, you choose the order: buying becomes "where
// does this piece go in my sequence?", not just "take the biggest tile".
// Some patterns are secret until you first hit them (see PlayRecord.patterns).

/** Lift Hill's tier (kept here so pieces.ts can import this file). */
const LIFT = 2;

export type PatternId =
  | 'pair'
  | 'triple'
  | 'straight3'
  | 'straight4'
  | 'straight5'
  | 'invchain'
  | 'tower'
  | 'kingdaka'
  | 'camelback'
  | 'mirror'
  | 'grandtour';

export interface PatternDef {
  name: string;
  /** What it adds to the multiplier. */
  mult: number;
  desc: string;
  /** Hidden from the pattern book until first hit. */
  secret?: boolean;
}

export const PATTERNS: Record<PatternId, PatternDef> = {
  pair: { name: 'Pair', mult: 1, desc: 'The same element twice in a row (not Lift Hills).' },
  triple: { name: 'Triple', mult: 3, desc: 'The same element three or more times in a row (not Lift Hills).' },
  straight3: { name: 'Straight', mult: 2, desc: 'Three elements in a row, each one tier up from the last.' },
  straight4: { name: 'Big Straight', mult: 4, desc: 'Four elements in a row, each one tier up.' },
  straight5: { name: 'Royal Straight', mult: 7, desc: 'Five or more elements in a row, each one tier up.' },
  invchain: { name: 'Inversion Chain', mult: 5, desc: 'A Vertical Loop, a Corkscrew and a Cobra Roll back to back, in any order.' },
  tower: { name: 'Tower', mult: 4, desc: 'Two Lift Hills straight into a Top Hat.' },
  kingdaka: { name: 'Sky Piercer', mult: 8, desc: 'Three or more Lift Hills straight into a Top Hat.', secret: true },
  camelback: { name: 'Camelback Run', mult: 4, desc: 'Four or more Airtime Hills in a row.', secret: true },
  mirror: { name: 'Mirror', mult: 6, desc: 'Five or more elements that read the same backwards.', secret: true },
  grandtour: { name: 'Grand Tour', mult: 10, desc: 'Every one of the seven elements somewhere in the ride.', secret: true },
};

export interface PatternHit {
  id: PatternId;
  /** Indices into the path it was found in. */
  cells: number[];
}

export interface NearMiss {
  id: PatternId;
  /** What's missing, for the results card. */
  text: string;
}

const NAMES = ['Flat', 'Airtime Hill', 'Lift Hill', 'Helix', 'Vertical Loop', 'Corkscrew', 'Cobra Roll', 'Top Hat'];
const TOP = 7;
const INVERSIONS = [4, 5, 6];

/** The elements of a path (skipping Flats), with where each one sits. */
function elements(path: readonly { tier: number }[]): { tier: number; at: number }[] {
  return path.flatMap((c, at) => (c.tier > 0 ? [{ tier: c.tier, at }] : []));
}

/** Maximal runs of `seq` where `link(prev, next)` holds. */
function runs<T>(seq: readonly T[], link: (a: T, b: T) => boolean): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const x of seq) {
    if (cur.length && link(cur[cur.length - 1], x)) cur.push(x);
    else {
      if (cur.length) out.push(cur);
      cur = [x];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Every pattern the ride makes, in ride order. */
export function findPatterns(path: readonly { tier: number }[]): PatternHit[] {
  const el = elements(path);
  const hits: PatternHit[] = [];
  const at = (xs: { at: number }[]) => xs.map((x) => x.at);

  // Pairs and triples: runs of one element (Lift Hills stack on their own).
  for (const r of runs(el, (a, b) => a.tier === b.tier)) {
    if (r[0].tier === LIFT || r.length < 2) continue;
    if (r[0].tier === 1 && r.length >= 4) hits.push({ id: 'camelback', cells: at(r) });
    else hits.push({ id: r.length >= 3 ? 'triple' : 'pair', cells: at(r) });
  }
  // Straights: each element one tier up from the last.
  for (const r of runs(el, (a, b) => b.tier === a.tier + 1)) {
    if (r.length >= 5) hits.push({ id: 'straight5', cells: at(r) });
    else if (r.length === 4) hits.push({ id: 'straight4', cells: at(r) });
    else if (r.length === 3) hits.push({ id: 'straight3', cells: at(r) });
  }
  // Inversion chains: three different inversions back to back (windows don't overlap).
  for (let i = 0; i + 2 < el.length; i++) {
    const w = el.slice(i, i + 3);
    if (INVERSIONS.every((t) => w.some((x) => x.tier === t))) {
      hits.push({ id: 'invchain', cells: at(w) });
      i += 2;
    }
  }
  // Towers: a stack of lifts straight into a Top Hat.
  for (let i = 0; i < el.length; i++) {
    if (el[i].tier !== TOP) continue;
    let j = i;
    while (j > 0 && el[j - 1].tier === LIFT) j--;
    const lifts = i - j;
    if (lifts >= 3) hits.push({ id: 'kingdaka', cells: at(el.slice(j, i + 1)) });
    else if (lifts === 2) hits.push({ id: 'tower', cells: at(el.slice(j, i + 1)) });
  }
  // Mirror: the longest palindromic stretch of five or more (not all the same element).
  let best: { i: number; n: number } | null = null;
  for (let i = 0; i < el.length; i++)
    for (let n = el.length - i; n >= 5; n--) {
      if (best && n <= best.n) break;
      const w = el.slice(i, i + n);
      if (w.every((x, k) => x.tier === w[n - 1 - k].tier) && w.some((x) => x.tier !== w[0].tier)) best = { i, n };
    }
  if (best) hits.push({ id: 'mirror', cells: at(el.slice(best.i, best.i + best.n)) });
  // Grand Tour: all seven elements somewhere.
  if ([1, 2, 3, 4, 5, 6, 7].every((t) => el.some((x) => x.tier === t))) hits.push({ id: 'grandtour', cells: at(el) });
  return hits;
}

/** What the patterns add to the multiplier. */
export function patternMult(hits: readonly PatternHit[]): number {
  return hits.reduce((a, h) => a + PATTERNS[h.id].mult, 0);
}

/** Patterns the ride came one piece short of, for the results card. */
export function nearMisses(path: readonly { tier: number }[]): NearMiss[] {
  const el = elements(path);
  const hits = new Set(findPatterns(path).map((h) => h.id));
  const out: NearMiss[] = [];
  const tiers = el.map((x) => x.tier);
  // A two-step rise: one more piece makes a Straight.
  if (!hits.has('straight3') && !hits.has('straight4') && !hits.has('straight5')) {
    for (let i = 0; i + 1 < tiers.length; i++)
      if (tiers[i + 1] === tiers[i] + 1) {
        const next = tiers[i + 1] + 1;
        const before = tiers[i] - 1;
        const want = next <= TOP ? NAMES[next] : NAMES[before];
        out.push({ id: 'straight3', text: `A ${want} next to your ${NAMES[tiers[i]]} → ${NAMES[tiers[i + 1]]} would make a Straight` });
        break;
      }
  }
  // Two inversions side by side: the third makes a chain.
  if (!hits.has('invchain'))
    for (let i = 0; i + 1 < tiers.length; i++) {
      const a = tiers[i];
      const b = tiers[i + 1];
      if (a !== b && INVERSIONS.includes(a) && INVERSIONS.includes(b)) {
        const missing = INVERSIONS.find((t) => t !== a && t !== b)!;
        out.push({ id: 'invchain', text: `One ${NAMES[missing]} away from an Inversion Chain` });
        break;
      }
    }
  // One lift into a Top Hat: another lift makes a Tower.
  if (!hits.has('tower') && !hits.has('kingdaka'))
    for (let i = 1; i < tiers.length; i++)
      if (tiers[i] === TOP && tiers[i - 1] === LIFT && (i < 2 || tiers[i - 2] !== LIFT)) {
        out.push({ id: 'tower', text: 'One more Lift Hill before your Top Hat makes a Tower' });
        break;
      }
  // Six of seven elements: one short of the Grand Tour.
  const have = new Set(tiers);
  const lacking = [1, 2, 3, 4, 5, 6, 7].filter((t) => !have.has(t));
  if (lacking.length === 1) out.push({ id: 'grandtour', text: `Only a ${NAMES[lacking[0]]} short of every element` });
  return out;
}

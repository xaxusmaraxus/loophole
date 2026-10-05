import { PATTERNS, type NearMiss, type PatternHit, type PatternId } from '../puzzle/patterns';

// The day's grade: how well you played, and what to try next time. It's measured
// against the target, bumped a letter for building a varied hand of patterns, and
// comes with notes that teach (patterns hit, best roar, wasted lift height, near
// misses). Your best grade for each day is kept in the play record.

export type Letter = 'S' | 'A' | 'B' | 'C' | 'D';
export const LETTERS: Letter[] = ['D', 'C', 'B', 'A', 'S'];

/** Distinct pattern types that bump the grade a letter. */
export const PATTERN_BUMP = 3;

export interface GradeInput {
  dayTotal: number;
  target: number;
  passed: boolean;
  patterns: readonly PatternHit[];
  bestRoar: number;
  /** Lift Hills whose height went unspent into the finale drop. */
  finaleLifts: number;
  nearMisses: readonly NearMiss[];
}

export interface Grade {
  letter: Letter;
  /** dayTotal / target. */
  ratio: number;
  /** Distinct patterns hit, in first-hit order. */
  patterns: PatternId[];
  bestRoar: number;
  /** Short lines for the results card: what went well, then what to try. */
  good: string[];
  tips: string[];
}

export function letterFor(ratio: number, passed: boolean): Letter {
  if (!passed) return 'D';
  if (ratio >= 3) return 'S';
  if (ratio >= 2) return 'A';
  if (ratio >= 1.4) return 'B';
  return 'C';
}

export function gradeDay(g: GradeInput): Grade {
  const ratio = g.target > 0 ? g.dayTotal / g.target : 1;
  const patterns = [...new Set(g.patterns.map((h) => h.id))];
  let li = LETTERS.indexOf(letterFor(ratio, g.passed));
  if (g.passed && patterns.length >= PATTERN_BUMP) li = Math.min(LETTERS.length - 1, li + 1);
  const good: string[] = [];
  const tips: string[] = [];
  if (patterns.length) good.push(`Patterns: ${patterns.map((id) => PATTERNS[id].name).join(', ')}`);
  if (patterns.length >= PATTERN_BUMP && g.passed) good.push(`${patterns.length} kinds of pattern: up a grade!`);
  if (g.bestRoar >= 5) good.push(`A ${g.bestRoar}-merge roar`);
  if (g.finaleLifts > 0)
    tips.push(`${g.finaleLifts} Lift Hill${g.finaleLifts > 1 ? 's' : ''} of height went to the finale: put lifts before your biggest element`);
  for (const m of g.nearMisses.slice(0, 2)) tips.push(m.text);
  if (!patterns.length) tips.push('Line up elements as patterns (pairs, straights, towers) for a bigger multiplier');
  if (g.bestRoar < 3) tips.push('Merge every move to keep the crowd roaring: it multiplies hype');
  return { letter: LETTERS[li], ratio, patterns, bestRoar: g.bestRoar, good, tips: tips.slice(0, 3) };
}

/** Is `a` a better grade than `b`? */
export function better(a: Letter, b: Letter | undefined): boolean {
  return !b || LETTERS.indexOf(a) > LETTERS.indexOf(b);
}

import { describe, expect, it } from 'vitest';
import { Game, ROAR_MAX, ROAR_STEP } from '../src/game';
import { idx, stationPoint } from '../src/puzzle/board';
import { PATTERNS, findPatterns, nearMisses, patternMult } from '../src/puzzle/patterns';
import { better, gradeDay, letterFor } from '../src/run/grade';

const path = (tiers: number[]) => tiers.map((tier) => ({ tier }));
const ids = (tiers: number[]) => findPatterns(path(tiers)).map((h) => h.id);

describe('ride patterns', () => {
  it('pairs and triples (Flats are skipped; Lift Hills never pair)', () => {
    expect(ids([3, 0, 3])).toEqual(['pair']);
    expect(ids([5, 5, 5])).toEqual(['triple']);
    expect(ids([2, 2])).toEqual([]);
    expect(ids([1, 1, 1, 1])).toEqual(['camelback']);
  });

  it('straights by length, and where they sit', () => {
    expect(ids([1, 2, 3])).toEqual(['straight3']);
    expect(ids([3, 4, 5, 6])).toEqual(['straight4', 'invchain']); // patterns stack
    expect(ids([1, 2, 3, 4, 5])).toEqual(['straight5']);
    const [h] = findPatterns(path([7, 0, 3, 4, 5]));
    expect(h).toEqual({ id: 'straight3', cells: [2, 3, 4] });
  });

  it('inversion chains, towers and the Sky Piercer', () => {
    expect(ids([6, 4, 5])).toEqual(['invchain']);
    expect(ids([2, 2, 7])).toEqual(['tower']);
    expect(ids([2, 2, 2, 7])).toEqual(['kingdaka']);
    expect(ids([2, 7])).toEqual([]);
  });

  it('mirror and the grand tour are secret', () => {
    expect(ids([3, 1, 7, 1, 3])).toContain('mirror');
    expect(ids([1, 2, 3, 4, 5, 6, 7])).toContain('grandtour');
    expect(PATTERNS.mirror.secret && PATTERNS.grandtour.secret).toBe(true);
  });

  it('add their multiplier', () => {
    expect(patternMult(findPatterns(path([2, 2, 7, 0, 4, 4])))).toBe(PATTERNS.tower.mult + PATTERNS.pair.mult);
  });

  it('near misses say what to add', () => {
    expect(nearMisses(path([3, 4])).map((m) => m.id)).toContain('straight3');
    expect(nearMisses(path([4, 6])).find((m) => m.id === 'invchain')!.text).toMatch(/Corkscrew/);
    expect(nearMisses(path([1, 2, 7])).map((m) => m.id)).toContain('tower');
  });
});

describe('the roar', () => {
  function cleared(): Game {
    const g = new Game('ROAR');
    g.beginPark();
    g.chooseNode(0, 0);
    const b = g.board;
    b.tiles = b.tiles.map(() => 0);
    b.obstacles = b.obstacles.map(() => null);
    b.flav = b.flav!.map(() => null);
    g.events.length = 0;
    return g;
  }

  it('grows with every merging swipe, multiplies hype, and breaks on a dry one', () => {
    const g = cleared();
    const b = g.board;
    const base = g.hypeRate;
    b.tiles[idx(b, 0, 0)] = 1;
    b.tiles[idx(b, 2, 0)] = 1;
    g.swipe('left');
    expect(g.roar).toBe(1);
    expect(g.roarMult).toBeCloseTo(1 + ROAR_STEP);
    expect(g.hypeRate).toBeGreaterThan(base);
    // Clear the board but for one tile: the next swipe can't merge.
    b.tiles = b.tiles.map(() => 0);
    b.tiles[idx(b, 0, 0)] = 1;
    g.swipe('right');
    expect(g.roar).toBe(0);
    expect(g.bestRoar).toBe(1);
    expect(g.events.some((e) => e.type === 'roar' && e.lost === 1)).toBe(true);
    g.roar = 50;
    expect(g.roarMult).toBeCloseTo(1 + ROAR_STEP * ROAR_MAX);
  });

  it('growing the loop into a pattern announces it', () => {
    const g = cleared();
    const b = g.board;
    const s = stationPoint(b, 0);
    // The loop is two Helixes; grow two more Helixes in: a Triple at least.
    for (const c of b.ends[0]) c.tier = 3;
    b.tiles[idx(b, s.x, s.y - 2)] = 3;
    b.tiles[idx(b, s.x + 1, s.y - 2)] = 3;
    g.banked = 1e6;
    g.tap(s.x, s.y - 2);
    const ev = g.events.filter((e) => e.type === 'pattern');
    expect(ev.map((e) => e.type === 'pattern' && e.id)).toContain('triple');
    expect(ev.every((e) => e.type === 'pattern' && e.fresh)).toBe(true);
  });
});

describe('the grade', () => {
  const base = { dayTotal: 100, target: 100, passed: true, patterns: [], bestRoar: 0, finaleLifts: 0, nearMisses: [] };

  it('is measured against the target; a failed day is a D', () => {
    expect(letterFor(1, true)).toBe('C');
    expect(letterFor(1.5, true)).toBe('B');
    expect(letterFor(2.2, true)).toBe('A');
    expect(letterFor(3, true)).toBe('S');
    expect(letterFor(5, false)).toBe('D');
  });

  it('three kinds of pattern bump it a letter, and it teaches', () => {
    const hits = findPatterns(path([3, 3, 0, 1, 2, 3, 0, 2, 2, 7]));
    const g = gradeDay({ ...base, dayTotal: 150, patterns: hits, finaleLifts: 2, nearMisses: nearMisses(path([4, 6])) });
    expect(g.letter).toBe('A');
    expect(g.good.join(' ')).toMatch(/Tower/);
    expect(g.tips.join(' ')).toMatch(/finale/);
    expect(g.tips.join(' ')).toMatch(/Inversion Chain/);
  });

  it('a closed day records the grade and new patterns', () => {
    const g = new Game('GRADE');
    g.beginPark();
    g.chooseNode(0, 0);
    for (const c of g.board.ends[0]) c.tier = 4;
    g.cfg.target = 0;
    g.open('circuit');
    const r = g.result!;
    expect(r.grade.patterns).toContain('pair');
    expect(r.newPatterns).toContain('pair');
    g.rideDone();
    g.continueFromResults();
    expect(g.record.patterns).toContain('pair');
    expect(g.record.grades['1']).toBe(r.grade.letter);
    expect(better('S', 'A')).toBe(true);
    expect(better('C', 'B')).toBe(false);
  });
});

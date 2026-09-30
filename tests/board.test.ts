import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { type Board, applyMove, isStuck, layKind, resolveChains, slide } from '../src/puzzle/board';

function board(rows: string[], station = { x: 0, y: 3 }): Board {
  const size = rows.length;
  const tiles: number[] = [];
  const obstacles: Board['obstacles'] = [];
  for (const row of rows)
    for (const ch of row) {
      tiles.push(/\d/.test(ch) ? Number(ch) : 0);
      obstacles.push(ch === '#' ? 'rock' : null);
    }
  return { size, tiles, obstacles, station, path: [], closed: false };
}

describe('slide', () => {
  it('merges equal tiles once per move, 2048-style', () => {
    const b = board(['1111', '....', '....', '....'], { x: 0, y: 3 });
    const { tiles } = slide(b, 'left');
    expect(tiles.slice(0, 4)).toEqual([2, 2, 0, 0]);
  });

  it('treats obstacles as walls that split a row', () => {
    const b = board(['1#.1', '....', '....', '....'], { x: 0, y: 3 });
    const { tiles } = slide(b, 'right');
    expect(tiles.slice(0, 4)).toEqual([1, 0, 0, 1]);
  });
});

describe('applyMove', () => {
  it('lays the cell in front of the head before sliding', () => {
    const b = board(['....', '....', '....', '....'], { x: 0, y: 3 });
    const res = applyMove(b, 'right', new Rng(1), { hillChance: 0, spawns: 1 })!;
    expect(res.laid).toEqual({ x: 1, y: 3, tier: 0 });
    expect(b.path).toHaveLength(1);
  });

  it('turns the taken tile into that track piece', () => {
    const b = board(['....', '....', '....', '.3..'], { x: 0, y: 3 });
    applyMove(b, 'right', new Rng(1), { hillChance: 0, spawns: 1 });
    expect(b.path[0].tier).toBe(3);
    expect(b.tiles[3 * 4 + 1]).toBe(0);
  });

  it('only closes the circuit after the minimum loop', () => {
    const b = board(['....', '....', '....', '....'], { x: 0, y: 3 });
    const rng = new Rng(1);
    applyMove(b, 'right', rng, { hillChance: 0, spawns: 1 });
    expect(layKind(b, 'left')).toBeNull();
    applyMove(b, 'up', rng, { hillChance: 0, spawns: 1 });
    applyMove(b, 'left', rng, { hillChance: 0, spawns: 1 });
    expect(layKind(b, 'down')).toBe('close');
    applyMove(b, 'down', rng, { hillChance: 0, spawns: 1 });
    expect(b.closed).toBe(true);
  });

  it('detects a dead end', () => {
    const b = board(['....', '....', '.#..', '..#.'], { x: 0, y: 3 });
    applyMove(b, 'right', new Rng(1), { hillChance: 0, spawns: 1 });
    expect(isStuck(b)).toBe(true);
  });
});

describe('resolveChains', () => {
  it('lets a fresh merge grab a matching neighbor, wave after wave', () => {
    // 1+1 -> 2, grabs the 2 below -> 3, grabs the 3 that slid in beside it -> 4.
    const b = board(['113.', '2...', '....', '....'], { x: 3, y: 3 });
    const s = slide(b, 'left');
    b.tiles = s.tiles;
    const chain = resolveChains(b, s.merges);
    expect(chain.waves).toHaveLength(2);
    expect(b.tiles[0]).toBe(4);
    expect(b.tiles.filter(Boolean)).toHaveLength(1);
  });

  it('does nothing without a fresh merge', () => {
    const b = board(['22..', '....', '....', '....'], { x: 3, y: 3 });
    expect(resolveChains(b, []).waves).toHaveLength(0);
  });

  it('counts chain merges in the move result', () => {
    const b = board(['....', '....', '.11.', '..2.'], { x: 0, y: 3 });
    const res = applyMove(b, 'right', new Rng(1), { hillChance: 0, spawns: 0 })!;
    expect(res.mergeCount).toBeGreaterThanOrEqual(1);
  });
});

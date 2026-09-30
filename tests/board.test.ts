import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import {
  type Board,
  build,
  buildTargets,
  canConnect,
  isBoxedIn,
  resolveChains,
  rideOrder,
  slide,
  swipe,
} from '../src/puzzle/board';
import { rideStats } from '../src/puzzle/pieces';

function board(rows: string[], station = { x: 0, y: 3 }): Board {
  const size = rows.length;
  const tiles: number[] = [];
  const obstacles: Board['obstacles'] = [];
  for (const row of rows)
    for (const ch of row) {
      tiles.push(/\d/.test(ch) ? Number(ch) : 0);
      obstacles.push(ch === '#' ? 'rock' : null);
    }
  return { size, tiles, obstacles, station, ends: [[], []], opened: null, soft: rows.join('').split('').map((ch) => ch === '~') };
}

const opts = { hillChance: 0, spawns: 0 };

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

describe('swipe', () => {
  it('is refused when nothing would move, and changes nothing', () => {
    const b = board(['1...', '....', '....', '....'], { x: 3, y: 3 });
    expect(swipe(b, 'left', new Rng(1), opts)).toBeNull();
    expect(b.tiles[0]).toBe(1);
  });

  it('never lays track', () => {
    const b = board(['.11.', '....', '....', '....'], { x: 3, y: 3 });
    swipe(b, 'left', new Rng(1), opts);
    expect(b.ends[0]).toHaveLength(0);
    expect(b.ends[1]).toHaveLength(0);
  });
});

describe('build', () => {
  it('turns the tile into that track piece', () => {
    const b = board(['....', '....', '....', '.3..'], { x: 0, y: 3 });
    expect(build(b, 0, 1, 3)).toEqual({ x: 1, y: 3, tier: 3 });
    expect(b.tiles[3 * 4 + 1]).toBe(0);
  });

  it('only builds next to the chosen end', () => {
    const b = board(['....', '....', '....', '....'], { x: 0, y: 3 });
    expect(build(b, 0, 2, 3)).toBeNull();
  });

  it('grows from both sides and connects when the ends meet', () => {
    const b = board(['....', '....', '....', '....'], { x: 1, y: 3 });
    build(b, 0, 0, 3);
    build(b, 0, 0, 2);
    build(b, 1, 2, 3);
    expect(canConnect(b)).toBe(false);
    build(b, 1, 2, 2);
    build(b, 1, 1, 2);
    expect(canConnect(b)).toBe(true);
    const order = rideOrder(b, 'circuit');
    expect(order[0].station && order[order.length - 1].station).toBe(true);
    expect(order).toHaveLength(7);
  });

  it('detects when both ends are boxed in', () => {
    const b = board(['....', '....', '#...', '.#..'], { x: 0, y: 3 });
    expect(buildTargets(b)).toHaveLength(0);
    expect(isBoxedIn(b)).toBe(true);
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
});

describe('rideStats', () => {
  const mods = { thrillMult: 1, flatThrill: 0 };
  it('rewards length, thrill and variety', () => {
    const plain = rideStats([{ tier: 1 }, { tier: 1 }, { tier: 1 }], mods);
    const longer = rideStats([{ tier: 1 }, { tier: 1 }, { tier: 1 }, { tier: 1 }], mods);
    const varied = rideStats([{ tier: 1 }, { tier: 2 }, { tier: 3 }], mods);
    expect(longer.excitement).toBeGreaterThan(plain.excitement);
    expect(varied.excitement).toBeGreaterThan(plain.excitement);
    expect(varied.variety).toBe(3);
  });

  it('halves a shuttle', () => {
    const path = [{ tier: 3 }, { tier: 3 }, { tier: 3 }, { tier: 3 }];
    expect(rideStats(path, mods, true).excitement).toBe(Math.round(rideStats(path, mods).excitement / 2));
  });
});

describe('sand', () => {
  it('sinks loose tiles that end a swipe on sand, and swallows Bumps', () => {
    // Row 0 slides left onto sand at x=0; the 3 at x=3 row 1 stays off sand.
    const b = board(['~.3.', '...1', '....', '....'], { x: 0, y: 3 });
    b.tiles[0] = 0;
    const res = swipe(b, 'left', new Rng(1), { hillChance: 0, spawns: 0 })!;
    expect(b.tiles[0]).toBe(2);
    expect(b.tiles[4]).toBe(1);
    expect(res.sunk).toEqual([{ x: 0, y: 0, tier: 2 }]);
  });

  it('removes a Bump that lands on sand', () => {
    const b = board(['~..1', '....', '....', '....'], { x: 0, y: 3 });
    swipe(b, 'left', new Rng(1), { hillChance: 0, spawns: 0 });
    expect(b.tiles.filter(Boolean)).toHaveLength(0);
  });
});

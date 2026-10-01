import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { Rng } from '../src/core/rng';
import { type Board, build, resolveChains, swipe } from '../src/puzzle/board';
import { rideStats } from '../src/puzzle/pieces';
import { makeRider } from '../src/riders/riders';
import { modsFor } from '../src/run/run';

/** A bare board: rows of digits (tiles) and '.', with flavors from a parallel map ('s', 'w', 'h'). */
function board(rows: string[], flavors: string[] = []): Board {
  const size = rows.length;
  const code = { s: 'spin', w: 'water', h: 'hang' } as const;
  return {
    size,
    tiles: rows.flatMap((r) => [...r].map((c) => (/\d/.test(c) ? Number(c) : 0))),
    obstacles: new Array(size * size).fill(null),
    station: { x: 1, y: size },
    ends: [[], []],
    opened: null,
    soft: new Array(size * size).fill(false),
    flav: (flavors.length ? flavors : rows.map((r) => '.'.repeat(r.length))).flatMap((r) => [...r].map((c) => code[c as keyof typeof code] ?? null)),
  };
}

const mods = modsFor([]);

describe('park pieces (flavors)', () => {
  it('ride along with their tile, and a merge keeps the flavor', () => {
    const b = board(['1.1.', '....', '....', '....'], ['..w.', '....', '....', '....']);
    swipe(b, 'left', new Rng(1), { hillChance: 0, spawns: 0 });
    expect(b.tiles[0]).toBe(2);
    expect(b.flav![0]).toBe('water');
    expect(b.flav![2]).toBe(null);
  });

  it('longer chain reactions turn the merged tile into a park piece', () => {
    const b = board(['22..', '....', '....', '....']);
    // A two-link chain: 2+2 → 3, then 3+3 → 4. The second link makes a park piece.
    const b2 = board(['223.', '....', '....', '....']);
    b2.tiles[2] = 0;
    b2.tiles[4] = 3;
    const chain = resolveChains(b2, [{ x: 0, y: 0 }], () => 'hang');
    expect(chain.waves).toHaveLength(2);
    expect(b2.tiles[0]).toBe(4);
    expect(b2.flav![0]).toBe('hang');
    // A single link doesn't.
    resolveChains(b, [{ x: 0, y: 0 }], () => 'hang');
    expect(b.flav![0]).toBe(null);
  });

  it('go into the track when built, and score their way', () => {
    const b = board(['....', '....', '....', '.2..'], ['....', '....', '....', '.w..']);
    const laid = build(b, 0, 1, 3)!;
    expect(laid.flavor).toBe('water');
    expect(b.flav![13]).toBe(null);
    const plain = rideStats([{ tier: 2 }], mods);
    expect(rideStats([{ tier: 2, flavor: 'water' }], mods).mult).toBe(plain.mult + 1);
    expect(rideStats([{ tier: 2, flavor: 'water' }], modsFor(['floodgates'])).mult).toBe(plain.mult + 2);
    const hang = rideStats([{ tier: 2, flavor: 'hang' }], mods);
    expect(hang.inversions).toBe(1);
    expect(hang.thrill).toBe(plain.thrill + 3);
    expect(rideStats([{ tier: 2, flavor: 'spin' }], mods).thrill).toBe(plain.thrill + 2);
  });

  it('spinning multiplies nausea; hanging counts as upside down for riders', () => {
    const g = new Game('FLAV');
    const tourist = makeRider(new Rng(1), 1, 99, 'meadow', 'tourist');
    expect(g.nausea(tourist, 3, 'spin')).toBe(3); // Drop 2 × 1.5
    const ghost = makeRider(new Rng(1), 1, 98, 'hollow', 'ghost');
    expect(g.nausea(ghost, 1)).toBe(0);
    expect(g.nausea(ghost, 1, 'hang')).toBe(2);
  });

  it("can't be crossed by a bridge or tunnel", () => {
    const b = board(['.....', '.....', '.....', '.....', '.....']);
    b.station = { x: 1, y: 5 };
    b.flav![16] = 'spin';
    b.tiles[16] = 1;
    build(b, 0, 1, 4);
    build(b, 0, 1, 3);
    b.tiles[11] = 0;
    build(b, 0, 1, 2);
    build(b, 1, 2, 4);
    build(b, 1, 2, 3);
    expect(b.ends[0][1].flavor).toBe('spin');
    expect(build(b, 1, 1, 3)).toBe(null);
  });
});

describe('combo prizes', () => {
  it('a big combo pays a free special piece, once per tier a day', () => {
    const g = new Game('COMBO');
    g.beginPark();
    g.chooseNode(0, 0);
    const before = g.specials.launch + g.specials.splash + g.specials.brakes;
    (g as unknown as { comboPrize(n: number): void }).comboPrize(7);
    (g as unknown as { comboPrize(n: number): void }).comboPrize(7);
    expect(g.specials.launch + g.specials.splash + g.specials.brakes).toBe(before + 1);
    (g as unknown as { comboPrize(n: number): void }).comboPrize(12);
    expect(g.specials.launch + g.specials.splash + g.specials.brakes).toBe(before + 3);
    expect(g.events.filter((e) => e.type === 'combo')).toHaveLength(3);
  });
});

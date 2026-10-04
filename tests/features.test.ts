import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { type Board, build, buildTargets, canConnect, rideOrder } from '../src/puzzle/board';
import { rideStats } from '../src/puzzle/pieces';
import { makeRider } from '../src/riders/riders';
import { Rng } from '../src/core/rng';
import { modsFor } from '../src/run/run';
import { checkUnlocks, emptyRecord, startingKit, unlockedSpecials } from '../src/run/unlocks';

/** Rows of '.' (empty), digits (tiles), '#' (rock), 'P' (pond). Station below the board at x. */
function board(rows: string[], stationX = 1, piers = false): Board {
  const size = rows.length;
  const tiles: number[] = [];
  const obstacles: Board['obstacles'] = [];
  for (const row of rows)
    for (const ch of row) {
      tiles.push(/\d/.test(ch) ? Number(ch) : 0);
      obstacles.push(ch === '#' ? 'rock' : ch === 'P' ? 'pond' : null);
    }
  return { size, tiles, obstacles, station: { x: stationX, y: size }, ends: [[], []], opened: null, soft: new Array(size * size).fill(false), piers };
}

const mods = modsFor([]);

describe('crossings (bridges and tunnels)', () => {
  it('lets the track cross a straight low piece at right angles, then run straight on', () => {
    const b = board(['.....', '.....', '.....', '.....', '.....']);
    // Red end: straight up column 1.
    build(b, 0, 1, 4);
    build(b, 0, 1, 3);
    build(b, 0, 1, 2);
    // Blue end: up column 2, then left across the red track.
    build(b, 1, 2, 4);
    build(b, 1, 2, 3);
    expect(buildTargets(b, 1).some((t) => t.x === 1 && t.y === 3)).toBe(true);
    const laid = build(b, 1, 1, 3)!;
    expect(laid.cross).toBe(true);
    expect(laid.tier).toBe(0);
    // A crossing pass only goes straight on.
    expect(buildTargets(b, 1).map((t) => [t.x, t.y])).toEqual([[0, 3]]);
    build(b, 1, 0, 3);
    build(b, 1, 0, 2);
    expect(canConnect(b)).toBe(true);
    const stats = rideStats([...b.ends[0], ...b.ends[1]], mods);
    expect(stats.crossings).toBe(1);
    expect(stats.length).toBe(8);
    // The ride passes the crossing cell twice.
    const order = rideOrder(b, 'circuit').filter((s) => s.x === 1 && s.y === 3);
    expect(order.length).toBe(2);
  });

  it("won't cross a corner, a big piece, or run into a dead end", () => {
    const b = board(['.....', '.....', '.....', '.....', '.....']);
    // Red end turns a corner at (1,3).
    build(b, 0, 1, 4);
    build(b, 0, 1, 3);
    build(b, 0, 0, 3);
    build(b, 1, 2, 4);
    build(b, 1, 2, 3);
    expect(buildTargets(b, 1).some((t) => t.x === 1 && t.y === 3)).toBe(false);
    // A Loop can't be crossed.
    const c = board(['.....', '.....', '.....', '.5...', '.....']);
    build(c, 0, 1, 4);
    build(c, 0, 1, 3);
    build(c, 0, 1, 2);
    build(c, 1, 2, 4);
    build(c, 1, 2, 3);
    expect(buildTargets(c, 1).some((t) => t.x === 1 && t.y === 3)).toBe(false);
    // Nowhere to go on the far side (a rock).
    const d = board(['.....', '.....', '.....', '#....', '.....']);
    build(d, 0, 1, 4);
    build(d, 0, 1, 3);
    build(d, 0, 1, 2);
    build(d, 1, 2, 4);
    build(d, 1, 2, 3);
    expect(buildTargets(d, 1).some((t) => t.x === 1 && t.y === 3)).toBe(false);
  });
});

describe('piers', () => {
  it('builds out over ponds only where piers are allowed', () => {
    const rows = ['.....', '.....', '.....', '.P...', '.....'];
    const no = board(rows);
    build(no, 0, 1, 4);
    expect(buildTargets(no, 0).some((t) => t.x === 1 && t.y === 3)).toBe(false);
    const yes = board(rows, 1, true);
    build(yes, 0, 1, 4);
    const laid = build(yes, 0, 1, 3)!;
    expect(laid.pier).toBe(true);
    expect(laid.tier).toBe(0);
    // A sea breeze: +2 thrill over plain flat track.
    expect(rideStats([laid], mods).thrill).toBe(2);
  });
});

describe('special pieces', () => {
  /** A U ride of two Hills, with the given special on the first. */
  function uRide(special?: 'launch' | 'splash' | 'brakes'): Game {
    const g = new Game('SPECIAL');
    g.beginPark();
    g.chooseNode(0, 0);
    const b = g.board;
    const s = b.station;
    b.obstacles = b.obstacles.map(() => null);
    b.tiles[(s.y - 1) * b.size + s.x] = 2;
    b.tiles[(s.y - 1) * b.size + s.x + 1] = 2;
    // The ride starts as a two-piece loop on those cells: give it the tiles we just set.
    for (const c of g.board.ends[0].slice(0, 2)) {
      const i = c.y * g.board.size + c.x;
      if (g.board.tiles[i]) [c.tier, g.board.tiles[i]] = [g.board.tiles[i], 0];
    }
    if (special) {
      g.specials[special] = 1;
      g.useSpecial(special);
      g.tap(s.x, s.y - 1);
      expect(g.specials[special]).toBe(0);
      expect(b.ends[0][0].special).toBe(special);
    }
    return g;
  }

  it('Launch adds thrill and doubles the next piece', () => {
    const plain = uRide();
    const g = uRide('launch');
    expect(g.stats.thrill).toBe(plain.stats.thrill + 10);
    const r = { ...makeRider(new Rng(1), 1, 99, 'meadow', 'tourist'), stomach: 3 };
    // Two Hills: 1 + 1 nausea; after a Launch the second hits double: 1 + 2.
    expect(plain.pukes(r)).toBe(0);
    expect(g.pukes(r)).toBe(1);
  });

  it('Water Splash adds a multiplier and Brake Run adds nausea', () => {
    expect(uRide('splash').stats.mult).toBe(uRide().stats.mult + 1);
    const r = { ...makeRider(new Rng(1), 1, 99, 'meadow', 'tourist'), stomach: 5 };
    expect(uRide().pukes(r)).toBe(0);
    expect(uRide('brakes').pukes(r)).toBe(1); // 1 + 3 + 1
  });

  it('the ride timeline still sums exactly to the tickets', () => {
    for (const sp of ['launch', 'splash', 'brakes'] as const) {
      const g = uRide(sp);
      g.open('circuit');
      const r = g.result!;
      expect(r.timeline[r.timeline.length - 1].total).toBe(r.total);
    }
  });

  it("can't go on a crossing pass or doubled up", () => {
    const g = uRide('launch');
    g.specials.splash = 1;
    g.useSpecial('splash');
    g.tap(g.board.station.x, g.board.station.y - 1);
    expect(g.specials.splash).toBe(1);
  });
});

describe('ghosts', () => {
  it('only feel upside-down pieces, double', () => {
    const g = new Game('GHOST');
    g.beginPark();
    g.chooseNode(0, 0);
    const ghost = makeRider(new Rng(3), 7, 99, 'hollow', 'ghost');
    expect(g.nausea(ghost, 3)).toBe(0); // a Drop does nothing
    expect(g.nausea(ghost, 5)).toBe(8); // a Loop: 4 × 2
  });
});

describe('unlocks', () => {
  it('earns special pieces from bosses and a starting kit from pukes', () => {
    const r = emptyRecord();
    expect(checkUnlocks(r)).toEqual([]);
    r.bosses.push('barry');
    r.totalPukes = 120;
    expect(checkUnlocks(r).sort()).toEqual(['coffee', 'launch']);
    expect(checkUnlocks(r)).toEqual([]);
    expect(unlockedSpecials(r)).toEqual(['launch']);
    expect(startingKit(r).tools).toEqual({ crew: 1 });
  });

  it('a game records bosses it beats and starts seasons with the unlocked kit', () => {
    const g = new Game('UNLOCK');
    g.record.unlocked.push('coffee', 'bigride');
    g.newRun('UNLOCK');
    expect(g.tools.crew).toBe(1);
    expect(g.specials.launch).toBe(1);
  });
});

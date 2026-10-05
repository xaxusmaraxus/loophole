import { describe, expect, it } from 'vitest';
import { Game, PIECE_PRICE } from '../src/game';
import { idx, stationPoint, trackAt } from '../src/puzzle/board';
import { dayConfig, modsFor, parkFor } from '../src/run/run';

/** A new game, past the intro card, on the first day node. */
function freshGame(): Game {
  const g = new Game('TEST01');
  g.beginPark();
  g.chooseNode(0, 0);
  g.events.length = 0;
  return g;
}

/** Pretend the current day just ended with this many tickets. */
function finish(g: Game, total: number): void {
  g.phase = 'results';
  g.result = { kind: 'circuit', stats: g.stats, score: g.score('circuit'), tickets: [], total, target: g.cfg.target, bossPuked: true, bossHits: 0, bossHp: 0, bossHpBefore: 0, round: 1, dayTotal: total, refused: false, again: false, passed: total >= g.cfg.target, timeline: [] };
  g.continueFromResults();
}

describe('the always-running ride', () => {
  /** A cleared board around the starting loop. */
  function cleared(): Game {
    const g = freshGame();
    const b = g.board;
    b.tiles = b.tiles.map(() => 0);
    b.obstacles = b.obstacles.map(() => null);
    b.flav = b.flav!.map(() => null);
    for (const c of b.ends[0]) c.tier = 0;
    return g;
  }

  it('starts as a two-piece loop that is already open', () => {
    const g = freshGame();
    const s = stationPoint(g.board, 0);
    expect(g.board.ends[0].map((c) => [c.x, c.y])).toEqual([
      [s.x, s.y - 1],
      [s.x + 1, s.y - 1],
    ]);
    expect(g.openKind).toBe('circuit');
    expect(g.lapLength).toBe(3);
  });

  it('tapping a tile beside the loop bulges it out over that tile and its neighbor', () => {
    const g = cleared();
    const b = g.board;
    const s = stationPoint(b, 0);
    // Above the loop's top edge: a Helix, with a Lift Hill next to it.
    b.tiles[idx(b, s.x, s.y - 2)] = 3;
    b.tiles[idx(b, s.x + 1, s.y - 2)] = 2;
    expect(g.growCells.some((c) => c.x === s.x && c.y === s.y - 2)).toBe(true);
    g.banked = 1000;
    g.tap(s.x, s.y - 2);
    expect(b.ends[0].map((c) => c.tier)).toEqual([0, 3, 2, 0]);
    expect(g.openKind).toBe('circuit');
    expect(g.actions).toBe(1);
    // The train stays parked while you build: it rides once, at the end.
    expect(g.trainPos).toBe(0);
    expect(g.lap).toBe(0);
    // Both tiles went into the track; growing drops in no tile (only because the board went empty does one appear).
    expect(b.tiles.filter((t) => t > 0)).toHaveLength(1);
  });

  it('the hype draws guests; each buys a ticket priced by the ride, and nobody rides until closing', () => {
    const g = cleared();
    const b = g.board;
    for (const c of b.ends[0]) c.tier = 7;
    const price = g.ticketPrice;
    expect(price).toBeGreaterThan(1);
    const start = g.banked;
    b.tiles[idx(b, 0, 0)] = 1;
    for (let k = 0; k < 8; k++) g.swipe((['right', 'down', 'left', 'up'] as const)[k % 4]);
    const earned = g.events.filter((e) => e.type === 'earn');
    expect(earned.length).toBeGreaterThan(0);
    expect(g.events.filter((e) => e.type === "arrive").length).toBeLessThanOrEqual(earned.length);
    expect(g.banked).toBe(start + earned.length * price);
    expect(g.lap).toBe(0);
    expect(g.events.some((e) => e.type === 'lap')).toBe(false);
    // A bigger ride draws more and charges more.
    const small = cleared();
    expect(small.ticketPrice).toBeLessThan(price);
    expect(small.hypeRate).toBeLessThan(g.hypeRate);
  });

  it('growing costs tickets, more as the ride gets bigger', () => {
    const g = cleared();
    const b = g.board;
    const s = stationPoint(b, 0);
    // A Helix and a Lift Hill above the loop.
    b.tiles[idx(b, s.x, s.y - 2)] = 3;
    b.tiles[idx(b, s.x + 1, s.y - 2)] = 2;
    const cost = g.growCost(s.x, s.y - 2)!;
    expect(cost).toBe(PIECE_PRICE[3] + PIECE_PRICE[2]);
    // Can't afford it yet.
    g.banked = cost - 1;
    g.tap(s.x, s.y - 2);
    expect(b.ends[0]).toHaveLength(2);
    expect(g.events.some((e) => e.type === 'broke')).toBe(true);
    g.banked = cost;
    g.events.length = 0;
    g.tap(s.x, s.y - 2);
    expect(b.ends[0]).toHaveLength(4);
    // Whatever's left is what guests paid this move.
    const paid = g.events.filter((e) => e.type === 'earn').length * g.ticketPrice;
    expect(g.banked).toBeLessThanOrEqual(paid);
    // The next pieces cost more: the ride has 4 pieces now.
    b.tiles[idx(b, s.x, s.y - 3)] = 3;
    b.tiles[idx(b, s.x + 1, s.y - 3)] = 2;
    expect(g.growCost(s.x, s.y - 3)).toBeGreaterThan(cost);
  });

  it('tiles hop over the loop', () => {
    const g = cleared();
    const b = g.board;
    const s = stationPoint(b, 0);
    const row = s.y - 1;
    b.tiles[idx(b, b.size - 1, row)] = 2;
    g.swipe('left');
    // It slid over both track cells to the far side (or the edge).
    const at = b.tiles.findIndex((t) => t === 2);
    expect(at % b.size < s.x || at % b.size === 0).toBe(true);
  });

  it('when nothing can slide and the ride can’t grow, the park jams and the last ride runs', () => {
    const g = cleared();
    const b = g.board;
    // Rocks everywhere except the loop and two cells in the top row: one tile, one gap.
    for (let i = 0; i < b.tiles.length; i++) if (!trackAt(b, i % b.size, Math.floor(i / b.size))) b.obstacles[i] = 'rock';
    const [p, q] = [idx(b, b.size - 1, 0), idx(b, b.size - 2, 0)];
    b.obstacles[p] = b.obstacles[q] = null;
    b.tiles[p] = 3;
    // The tile slides into the gap, a new tile drops into the last hole: nothing can move, nothing can grow.
    g.swipe('left');
    expect(g.phase).toBe('ride');
    expect(g.events.some((e) => e.type === 'gridlock')).toBe(true);
  });
});

describe('tools', () => {
  it('paint upgrades a tile and spends a charge; undo refunds it', () => {
    const g = freshGame();
    const b = g.board;
    const i = b.tiles.findIndex((t) => t > 0 && t < 7);
    const before = b.tiles[i];
    g.tools.paint = 1;
    g.useTool('paint');
    g.tap(i % b.size, Math.floor(i / b.size));
    expect(g.tools.paint).toBe(0);
    expect(g.board.tiles[i] === 0 || g.board.tiles[i] >= before + 1).toBe(true);
    g.undo();
    expect(g.tools.paint).toBe(1);
    expect(g.board.tiles[i]).toBe(before);
  });

  it('crane moves a tile to another cell', () => {
    const g = freshGame();
    const b = g.board;
    b.tiles = b.tiles.map(() => 0);
    const n = b.size;
    const free = [...Array(n * n).keys()].filter((k) => !b.obstacles[k]);
    const [from, to] = [free[0], free[free.length - 1]];
    b.tiles[from] = 3;
    g.tools.crane = 1;
    g.useTool('crane');
    g.tap(from % n, Math.floor(from / n));
    g.tap(to % n, Math.floor(to / n));
    expect(g.board.tiles[to]).toBe(3);
    expect(g.board.tiles[from]).toBe(0);
  });

  it('the track crew grows the ride into empty cells too', () => {
    const g = freshGame();
    const b = g.board;
    const s = stationPoint(b, 0);
    b.tiles[idx(b, s.x, s.y - 2)] = 0;
    b.tiles[idx(b, s.x + 1, s.y - 2)] = 0;
    b.obstacles[idx(b, s.x, s.y - 2)] = null;
    b.obstacles[idx(b, s.x + 1, s.y - 2)] = null;
    g.tap(s.x, s.y - 2); // no tile there: plain taps can't grow into it
    expect(b.ends[0]).toHaveLength(2);
    g.tools.crew = 1;
    g.useTool('crew');
    g.tap(s.x, s.y - 2);
    expect(b.ends[0]).toHaveLength(4);
    expect(g.tools.crew).toBe(0);
  });
});

describe('rewards and attractions', () => {
  it('rewards add upgrades, tool charges or attractions', () => {
    const g = freshGame();
    finish(g, g.cfg.target);
    g.offer = [{ kind: 'upgrade', id: 'sweeper' }];
    g.chooseReward(0);
    expect(g.upgrades).toContain('sweeper');
    expect(g.mods.sweepEvery).toBe(8);
    expect(modsFor([]).sweepEvery).toBe(0);
  });

  it('Season Pass grows every day you beat the target', () => {
    const g = freshGame();
    g.gain({ kind: 'attraction', id: 'seasonpass' });
    finish(g, g.cfg.target);
    expect(g.attractions[0].counter).toBe(1);
  });

  it('sells and rearranges attractions on the plot (they score in reading order)', () => {
    const g = freshGame();
    g.gain({ kind: 'attraction', id: 'loopdeloop' });
    g.gain({ kind: 'attraction', id: 'quicktrip' });
    expect(g.attractions.map((a) => a.id)).toEqual(['loopdeloop', 'quicktrip']);
    g.phase = 'map';
    const loop = g.plot.items[0].uid;
    expect(g.placeItem(loop, 4, 1)).toBe(true);
    expect(g.attractions.map((a) => a.id)).toEqual(['quicktrip', 'loopdeloop']);
    const funds = g.funds;
    g.sellItem(loop);
    expect(g.attractions).toHaveLength(1);
    expect(g.funds).toBeGreaterThan(funds);
  });
});

describe('season and map', () => {
  it('maps days to parks: three per park, then the finale', () => {
    expect([1, 3, 4, 6, 7, 9, 10, 11].map((d) => parkFor(d).id)).toEqual([
      'meadow', 'meadow', 'boardwalk', 'boardwalk', 'hollow', 'hollow', 'finale', 'finale',
    ]);
  });

  it('plays a park as day, day, stop, boss, then moves to the next park', () => {
    const g = new Game('TEST02');
    expect(g.phase).toBe('intro');
    g.beginPark();
    expect(g.phase).toBe('map');
    expect(g.isReachable(1)).toBe(false);
    g.chooseNode(0, 0);
    expect(g.phase).toBe('build');
    finish(g, g.cfg.target + 40);
    g.skipReward();
    expect(g.phase).toBe('map');
    expect(g.dayNum).toBe(2);
    g.chooseNode(1, 0);
    finish(g, g.cfg.target);
    g.skipReward();
    // The stop column: take a repair if there is one, else whatever is first.
    const stop = g.parkMap[2].findIndex((n) => n.kind === 'repair');
    g.chooseNode(2, Math.max(0, stop));
    if (g.phase === 'shop') g.leaveShop();
    if (g.phase === 'egg') g.closeEgg();
    expect(g.phase).toBe('map');
    g.chooseNode(3, 0);
    expect(['barry', 'granny']).toContain(g.cfg.boss);
    expect(g.queue[0].boss).toBe(g.cfg.boss);
    finish(g, g.cfg.target);
    // A broken boss: the park plot grows a row, and a legendary is on offer.
    expect(g.phase).toBe('conquered');
    expect(g.plot.h).toBe(3);
    expect(g.offer.every((o) => o.kind === 'attraction')).toBe(true);
    g.skipReward();
    expect(g.dayNum).toBe(4);
    expect(g.cfg.park.id).toBe('boardwalk');
    expect(g.phase).toBe('intro');
    expect(g.funds).toBe(40);
  });

  it('VIP days put a VIP at the front of the line', () => {
    const g = new Game('TEST03');
    g.beginPark();
    const vip = g.parkMap[0].findIndex((n) => n.kind === 'vip');
    g.chooseNode(0, vip);
    expect(g.queue[0].kind).toBe('vip');
  });

  it('wins the season by beating the finale, and repeats it on a miss', () => {
    const g = new Game('TEST04');
    g.dayNum = 10;
    (g as unknown as { enterPark(i: number): void }).enterPark(3);
    g.beginPark();
    expect(g.cfg.node).toBe('finale');
    finish(g, 0);
    expect(g.hearts).toBe(2);
    g.skipReward();
    expect(g.cfg.node).toBe('finale');
    expect(g.phase).toBe('build');
    finish(g, g.cfg.target);
    expect(g.phase).toBe('won');
  });
});

describe('puking', () => {
  it('pukes once per stomachful of nausea, capped at 5', () => {
    const g = freshGame();
    const b = g.board;
    const s = stationPoint(b, 0);
    // A U-shaped ride: two Top Hats (10 nausea each for an ordinary stomach).
    b.tiles[idx(b, s.x, s.y - 1)] = 7;
    b.tiles[idx(b, s.x + 1, s.y - 1)] = 7;
    // The ride starts as a two-piece loop on those cells: give it the tiles we just set.
    for (const c of g.board.ends[0].slice(0, 2)) {
      const i = c.y * g.board.size + c.x;
      if (g.board.tiles[i]) [c.tier, g.board.tiles[i]] = [g.board.tiles[i], 0];
    }
    expect(g.openKind).toBe('circuit');
    const corndog = { ...g.queue[0], kind: 'corndog' as const, boss: undefined, stomach: 5 };
    expect(g.pukes(corndog)).toBe(4); // 20 nausea / stomach 5
    const thrill = { ...corndog, kind: 'thrill' as const, stomach: 25 };
    expect(g.pukes(thrill)).toBe(0);
    // A shuttle passes each piece twice.
    expect(g.pukes(corndog, 'shuttle')).toBe(5);
  });

  it('weaknesses change what hits a rider', () => {
    const g = freshGame();
    const b = g.board;
    const s = stationPoint(b, 0);
    b.tiles[idx(b, s.x, s.y - 1)] = 4; // Vertical Loop, 4 nausea, upside down
    b.tiles[idx(b, s.x + 1, s.y - 1)] = 4;
    // The ride starts as a two-piece loop on those cells: give it the tiles we just set.
    for (const c of g.board.ends[0].slice(0, 2)) {
      const i = c.y * g.board.size + c.x;
      if (g.board.tiles[i]) [c.tier, g.board.tiles[i]] = [g.board.tiles[i], 0];
    }
    const base = { ...g.queue[0], boss: undefined, stomach: 8 };
    expect(g.pukes({ ...base, kind: 'tourist' })).toBe(1); // 8 / 8
    expect(g.pukes({ ...base, kind: 'grandma' })).toBe(3); // triple: 24 / 8
    expect(g.pukes({ ...base, kind: 'looper' })).toBe(0); // immune to loops
  });

  it('a boss day is only cleared if the boss pukes', () => {
    const g = new Game('TEST05');
    g.beginPark();
    g.chooseNode(0, 0);
    g.dayNum = 3;
    g.skipReward();
    (g as unknown as { startDay(n: string): void }).startDay('boss');
    expect(g.queue[0].boss).toBe(g.parkBoss);
    // The boss rides every lap: they stay in line until they're broken.
    expect(g.openKind).toBe('circuit');
  });
});

describe('capsule eggs', () => {
  function shopWithEgg(kind: 'golden' | 'bus' | 'snack'): Game {
    const g = freshGame();
    g.phase = 'shop';
    g.funds = 10_000;
    g.shop = [{ kind: 'egg', id: kind, price: 100, sold: false }];
    g.buy(0);
    return g;
  }

  it('has to be cracked before you can pick', () => {
    const g = shopWithEgg('golden');
    expect(g.phase).toBe('egg');
    g.takeFromEgg(0);
    expect(g.attractions).toHaveLength(0);
    g.crackEgg();
    g.takeFromEgg(0);
    expect(g.attractions).toHaveLength(1);
    expect(g.phase).toBe('shop');
  });

  it('snack eggs give two picks', () => {
    const g = shopWithEgg('snack');
    g.crackEgg();
    g.takeFromEgg(0);
    expect(g.phase).toBe('egg');
    g.takeFromEgg(0);
    expect(g.phase).toBe('shop');
  });

  it('a bus tour adds a rider to the line every morning', () => {
    const g = shopWithEgg('bus');
    g.crackEgg();
    const kind = g.egg!.items[0].id;
    g.takeFromEgg(0);
    expect(g.crowd).toEqual([kind]);
    const before = g.cfg.startRiders;
    (g as unknown as { startDay(n: string): void }).startDay('day');
    expect(g.queue.length).toBe(before + 1);
    expect(g.queue.some((r) => r.kind === kind)).toBe(true);
  });
});

describe('station', () => {
  it('is always a platform below the board', () => {
    const g = freshGame();
    expect(g.board.station.y).toBe(g.board.size);
    expect(g.board.obstacles[idx(g.board, g.board.station.x, g.board.size - 1)]).toBeNull();
  });
});

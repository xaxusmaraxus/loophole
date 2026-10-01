import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
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

describe('the track eats tiles', () => {
  /** A cleared board with tiles where we want them. */
  function cleared(): Game {
    const g = freshGame();
    const b = g.board;
    b.tiles = b.tiles.map(() => 0);
    b.obstacles = b.obstacles.map(() => null);
    b.flav = b.flav!.map(() => null);
    return g;
  }

  it('a tile that slides into an open end becomes track, one per end per swipe', () => {
    const g = cleared();
    const b = g.board;
    const s = stationPoint(g.board, 0);
    // Two tiles stacked in the red end's column, one in the blue end's.
    b.tiles[idx(b, s.x, 0)] = 3;
    b.tiles[idx(b, s.x, 1)] = 2;
    b.tiles[idx(b, s.x + 1, 2)] = 4;
    g.swipe('down');
    expect(b.ends[0].map((c) => c.tier)).toEqual([2]);
    expect(b.ends[1].map((c) => c.tier)).toEqual([4]);
    // The Drop stopped right on top of the new red end; the next swipe down feeds it.
    expect(b.tiles[idx(b, s.x, b.size - 2)]).toBe(3);
    expect(g.openKind).toBe('circuit');
  });

  it('tapping the park no longer builds', () => {
    const g = freshGame();
    const s = stationPoint(g.board, 0);
    g.tap(s.x, s.y - 1);
    expect(g.board.ends[0]).toHaveLength(0);
  });

  it('gridlock opens the ride by itself', () => {
    const g = cleared();
    const b = g.board;
    const s = stationPoint(b, 0);
    b.tiles[idx(b, s.x, b.size - 1)] = 2;
    b.tiles[idx(b, s.x + 1, b.size - 1)] = 2;
    g.swipe('down');
    expect(g.openKind).toBe('circuit');
    // Fill every free cell with tiles that can't merge with anything.
    for (let i = 0; i < b.tiles.length; i++) {
      const [x, y] = [i % b.size, Math.floor(i / b.size)];
      if (!trackAt(b, x, y)) b.tiles[i] = (x + y) % 2 ? 1 : 3;
    }
    // Checkerboard of Bumps and Drops: nothing merges; the ends can still eat, so feed them till nothing moves.
    for (let n = 0; n < 60 && g.phase === 'build'; n++) g.swipe((['down', 'left', 'right', 'up'] as const)[n % 4]);
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

  it('the track crew lays one piece by hand', () => {
    const g = freshGame();
    const s = stationPoint(g.board, 0);
    g.board.obstacles[idx(g.board, s.x, s.y - 1)] = null;
    g.tools.crew = 1;
    g.useTool('crew');
    g.tap(s.x, s.y - 1);
    expect(g.board.ends[0]).toHaveLength(1);
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
    // A U-shaped ride: two Mega Loops (9 nausea each for an ordinary stomach).
    b.tiles[idx(b, s.x, s.y - 1)] = 7;
    b.tiles[idx(b, s.x + 1, s.y - 1)] = 7;
    g.buildAt(s.x, s.y - 1);
    g.buildAt(s.x + 1, s.y - 1);
    expect(g.openKind).toBe('circuit');
    const corndog = { ...g.queue[0], kind: 'corndog' as const, boss: undefined, stomach: 4 };
    expect(g.pukes(corndog)).toBe(4); // 18 nausea / stomach 4
    const thrill = { ...corndog, kind: 'thrill' as const, stomach: 20 };
    expect(g.pukes(thrill)).toBe(0);
    // A shuttle passes each piece twice.
    expect(g.pukes(corndog, 'shuttle')).toBe(5);
  });

  it('weaknesses change what hits a rider', () => {
    const g = freshGame();
    const b = g.board;
    const s = stationPoint(b, 0);
    b.tiles[idx(b, s.x, s.y - 1)] = 5; // Loop, 4 nausea, upside down
    b.tiles[idx(b, s.x + 1, s.y - 1)] = 5;
    g.buildAt(s.x, s.y - 1);
    g.buildAt(s.x + 1, s.y - 1);
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
    g.open('shuttle'); // nothing built: can't open
    expect(g.phase).toBe('build');
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

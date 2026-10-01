import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { BOSSES, type BossId } from '../src/riders/riders';
import { scoreRide } from '../src/run/attractions';
import { spun } from '../src/run/bossday';
import { district, emptyPlot, firstFit, fits, readingOrder, type PlotItem } from '../src/run/plot';
import { rideStats } from '../src/puzzle/pieces';
import { rideOrder } from '../src/puzzle/board';

/** A boss day against `boss`, on a cleared board. */
function bossDay(boss: BossId, seed = 'BOSS'): Game {
  const g = new Game(seed);
  g.beginPark();
  g.chooseNode(0, 0);
  g.parkBoss = boss;
  (g as unknown as { startDay(n: string): void }).startDay(boss === 'mayor' ? 'finale' : 'boss');
  g.board.obstacles = g.board.obstacles.map(() => null);
  g.events.length = 0;
  return g;
}

/** Lays a U ride of the given tiers just above the platform. */
function uRide(g: Game, a: number, b: number): void {
  const bd = g.board;
  const s = bd.station;
  bd.tiles[(s.y - 1) * bd.size + s.x] = a;
  bd.tiles[(s.y - 1) * bd.size + s.x + 1] = b;
  g.tap(s.x, s.y - 1);
  g.tap(s.x + 1, s.y - 1);
}

describe('the park plot', () => {
  const item = (uid: number, r: Partial<PlotItem>): PlotItem => ({ kind: 'attraction', id: 'loopdeloop', uid, counter: 0, x: 0, y: 0, turned: false, ...r }) as PlotItem;

  it('fits shapes: commons 1×1, rares 2×1 (turnable), legendaries 2×2', () => {
    const p = emptyPlot();
    p.items.push(item(1, { x: 0, y: 0 }));
    expect(fits(p, { kind: 'attraction', id: 'quicktrip' }, 0, 1, false)).toBe(true);
    expect(fits(p, { kind: 'attraction', id: 'quicktrip' }, 4, 0, false)).toBe(false); // off the edge
    expect(fits(p, { kind: 'attraction', id: 'quicktrip' }, 4, 0, true)).toBe(true); // stood up
    expect(fits(p, { kind: 'attraction', id: 'ferris' }, 0, 0, false)).toBe(false);
    expect(firstFit(p, { kind: 'attraction', id: 'ferris' })).toEqual({ x: 1, y: 0, turned: false });
  });

  it('scores in reading order and counts same-theme neighbors as a district', () => {
    const p = emptyPlot();
    const a = item(1, { x: 1, y: 1 });
    const b = item(2, { id: 'tilttable', x: 2, y: 1 }); // thrill, touching
    const c = item(3, { id: 'crowdpleaser', x: 1, y: 0 }); // show, touching
    p.items.push(a, b, c);
    expect(readingOrder(p.items).map((i) => i.uid)).toEqual([3, 1, 2]);
    expect(district(p, a)).toBe(1);
    expect(district(p, c)).toBe(0);
  });

  it('new things go on the first free spot, then the stash, then nowhere', () => {
    const g = new Game('PLOT');
    for (let i = 0; i < 10; i++) expect(g.gain({ kind: 'upgrade', id: 'hype' })).toBe(true);
    expect(g.mods.thrillMult).toBe(1 + 0.25 * 10);
    expect(g.gain({ kind: 'upgrade', id: 'lumber' })).toBe(true);
    expect(g.gain({ kind: 'upgrade', id: 'lumber' })).toBe(true);
    expect(g.plot.stash).toHaveLength(2);
    expect(g.canGain({ kind: 'upgrade', id: 'lumber' })).toBe(false);
    // Stashed upgrades don't count.
    expect(g.mods.hillChance).toBe(0.1);
  });
});

describe('district bonus, Ferris Wheel and Hall of Mirrors', () => {
  const stats = rideStats([{ tier: 5 }], { thrillMult: 1, flatThrill: 0 });
  const ctx = { stats, riders: 4, pukers: 0, pukes: 0, chainLinks: 0, daylightLeft: 0 };

  it('a district adds +1 mult per same-theme neighbor', () => {
    const plain = scoreRide(ctx, [{ id: 'loopdeloop', counter: 0 }], false);
    const dist = scoreRide(ctx, [{ id: 'loopdeloop', counter: 0, district: 2 }], false);
    expect(dist.mult).toBe(plain.mult + 2);
  });

  it('Ferris Wheel multiplies by 1.3 per touching attraction; Mirrors re-fire neighbors', () => {
    const ferris = scoreRide(ctx, [{ id: 'ferris', counter: 0, touching: [1, 2] }, { id: 'longhaul', counter: 0 }, { id: 'longhaul', counter: 0 }], false);
    expect(ferris.steps[1].effect.xmult).toBeCloseTo(1.69);
    const mirrors = scoreRide(ctx, [{ id: 'loopdeloop', counter: 0, touching: [1] }, { id: 'mirrors', counter: 0, touching: [0] }], false);
    // Loop-de-Loop fires twice: +2 and +2.
    expect(mirrors.mult).toBe(stats.mult + 4);
  });
});

describe('boss days', () => {
  it('draw the boss from the park pool when you arrive', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(new Game(`POOL${i}`).parkBoss);
    expect([...seen].sort()).toEqual(['barry', 'granny']);
  });

  it('give up to three rides to break the boss, banking tickets in between', () => {
    const g = bossDay('barry');
    expect(g.fight).toMatchObject({ round: 1, hp: 2, max: 2 });
    uRide(g, 1, 1);
    g.open('circuit');
    g.rideDone();
    const r = g.result!;
    expect(r.bossHits).toBe(0);
    expect(r.again).toBe(true);
    expect(r.passed).toBe(false);
    const hearts = g.hearts;
    g.continueFromResults();
    // Round two: the track came down, the tiles stayed, same line, half the daylight.
    expect(g.phase).toBe('build');
    expect(g.hearts).toBe(hearts);
    expect(g.fight!.round).toBe(2);
    expect(g.fight!.banked).toBe(r.total);
    expect(g.board.ends).toEqual([[], []]);
    expect(g.daylight).toBe(Math.ceil(g.cfg.daylight / 2));
    // Third time unlucky: a heart is lost.
    for (const round of [2, 3]) {
      uRide(g, 1, 1);
      g.open('circuit');
      g.rideDone();
      expect(g.result!.round).toBe(round);
      g.continueFromResults();
    }
    expect(g.hearts).toBe(hearts - 1);
  });

  it('breaking the boss grows the plot and offers legendaries', () => {
    const g = bossDay('barry');
    g.fight!.hp = 1;
    const boss = g.queue[0];
    boss.stomach = 2;
    g.cfg.target = 0;
    uRide(g, 3, 3);
    g.open('circuit');
    expect(g.result!.bossHits).toBeGreaterThan(0);
    expect(g.result!.passed).toBe(true);
    g.rideDone();
    g.continueFromResults();
    expect(g.phase).toBe('conquered');
    expect(g.plot.h).toBe(3);
    expect(g.record.bosses).toContain('barry');
    g.chooseReward(0);
    expect(g.attractions.some((a) => a.id === g.ownedIds[0])).toBe(true);
  });

  it('Second Helpings: Barry’s stomach grows every 4 swipes', () => {
    const g = bossDay('barry');
    const barry = g.queue[0];
    const base = g.stomach(barry);
    g.actions = 8;
    expect(g.stomach(barry)).toBe(base + 2);
  });

  it('Seen It All: only the first piece of each type gets to Granny', () => {
    const g = bossDay('granny');
    uRide(g, 3, 3);
    const granny = g.queue[0];
    const tourist = g.queue.find((r) => !r.boss)!;
    const stops = rideOrder(g.board, 'circuit');
    const gn = (r: typeof granny) => stops.map((_s, i) => g.stopNausea(r, stops, i));
    expect(gn(granny).filter((n) => n > 0)).toHaveLength(1);
    expect(gn(tourist).filter((n) => n > 0)).toHaveLength(2);
  });

  it('Rough Seas: every 5 swipes a wave slides the board', () => {
    const g = bossDay('ivy');
    let waves = 0;
    for (let i = 0; i < 10 && g.daylight > 0; i++) {
      g.swipe(['up', 'left', 'down', 'right'][i % 4] as never);
      waves += g.events.filter((e) => e.type === 'boss' && e.what === 'wave').length;
      g.events.length = 0;
    }
    expect(waves).toBe(Math.floor(g.actions / 5));
  });

  it('No Running!: a dry swipe costs 2 daylight', () => {
    const g = bossDay('lou');
    g.board.tiles = g.board.tiles.map(() => 0);
    g.board.tiles[0] = 1;
    const before = g.daylight;
    g.swipe('right');
    expect(g.daylight).toBe(before - 2);
  });

  it('Spin Cycle: the controls turn a quarter every 6 swipes', () => {
    expect(spun('up', 1)).toBe('right');
    expect(spun('left', 3)).toBe('down');
    const g = bossDay('vertigo');
    g.fight!.spin = 1;
    g.board.tiles = g.board.tiles.map(() => 0);
    g.board.tiles[0] = 2;
    g.swipe('up'); // really goes right
    expect(g.board.tiles[0]).toBe(0);
    expect(g.board.tiles[g.board.size - 1]).toBe(2);
  });

  it('Inspection Day: the Mayor sits it out unless every demand is met', () => {
    const g = bossDay('mayor');
    expect(g.fight!.demands).toHaveLength(3);
    g.fight!.demands = ['loop'];
    uRide(g, 3, 3);
    const mayor = g.queue[0];
    expect(g.refuses(mayor, 'circuit')).toBe(true);
    expect(g.pukes(mayor)).toBe(0);
    g.fight!.demands = ['drop'];
    expect(g.refuses(mayor, 'circuit')).toBe(false);
  });

  it('every boss has a rule and a composure', () => {
    for (const b of Object.values(BOSSES)) {
      expect(b.composure).toBeGreaterThan(0);
      expect(b.ruleDesc.length).toBeGreaterThan(10);
    }
  });
});

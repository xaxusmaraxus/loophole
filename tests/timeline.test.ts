import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { DIRS, buildTargets, canConnect, canShuttle, head, idx } from '../src/puzzle/board';
import { ATTRACTIONS, type AttractionId } from '../src/run/attractions';
import { modsFor } from '../src/run/run';
import { ratingOf } from '../src/run/timeline';

/** A seeded bot day: swipe and build at random, then open as `kind` (or whatever is possible). */
function playRide(seed: number, kind: 'circuit' | 'shuttle' | 'any'): Game {
  const g = new Game(`TL${seed}`);
  g.beginPark();
  g.chooseNode(0, 0);
  let s = seed * 7919 + 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Some runs get attractions and upgrades so every scoring path is exercised.
  const ids = Object.keys(ATTRACTIONS) as AttractionId[];
  const n = seed % 6;
  for (let i = 0; i < n; i++) {
    const id = ids[(seed * 3 + i * 5) % ids.length];
    if (!g.attractions.some((a) => a.id === id)) g.gain({ kind: 'attraction', id });
    for (const it of g.plot.items) it.counter = seed % 3;
  }
  if (seed % 2) g.mods = modsFor(['hype', 'scenic', 'fries']);
  g.chainLinks = seed % 4;
  let guard = 0;
  const greed = 6 + (seed % 9);
  while (g.phase === 'build' && guard++ < 400) {
    const b = g.board;
    const len = b.ends[0].length + b.ends[1].length;
    if (kind !== 'shuttle' && canConnect(b) && (len >= greed || g.room <= 2)) break;
    if (kind === 'shuttle' && len >= greed && canShuttle(b)) break;
    const targets = buildTargets(b);
    if (targets.length && (len >= greed || rnd() < 0.4)) {
      const [h0, h1] = [head(b, 0), head(b, 1)];
      const t = targets.sort((a, c) => {
        const d = (p: { x: number; y: number; end: 0 | 1 }) => {
          const o = p.end === 0 ? h1 : h0;
          return Math.abs(p.x - o.x) + Math.abs(p.y - o.y);
        };
        return (len >= greed ? d(a) - d(c) : 0) + (b.tiles[idx(b, c.x, c.y)] - b.tiles[idx(b, a.x, a.y)]) * 0.1 + rnd() - 0.5;
      })[0];
      g.buildAt(t.x, t.y);
    } else g.swipe(DIRS[Math.floor(rnd() * 4)]);
  }
  if (kind === 'shuttle' && canShuttle(g.board)) g.open('shuttle');
  else g.open();
  return g;
}

describe('ride timeline', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

  it('sums exactly to the day total, across circuits and shuttles', () => {
    let rides = 0;
    let pukes = 0;
    let shuttles = 0;
    let fired = 0;
    for (const seed of seeds)
      for (const kind of ['any', 'shuttle'] as const) {
        const g = playRide(seed, kind);
        if (g.phase !== 'ride') continue;
        const r = g.result!;
        rides++;
        if (r.kind === 'shuttle') shuttles++;
        const tl = r.timeline;
        fired += tl.filter((e) => e.kind === 'attraction').length;
        const sum = tl.reduce((a, e) => a + e.pay, 0);
        expect(sum).toBe(r.total);
        expect(tl[tl.length - 1].total).toBe(r.total);
        expect(tl[tl.length - 1].kind).toBe('slam');
        // Chips from the pieces add up to the ride's base excitement, and variety to its multiplier.
        const pieceChips = tl.filter((e) => e.kind === 'chips').reduce((a, e) => a + (e.kind === 'chips' ? e.amount : 0), 0);
        expect(pieceChips).toBe(r.score.steps[0].chips);
        const pieceMult = 1 + tl.filter((e) => e.kind === 'mult').length * 0.5;
        expect(pieceMult).toBe(r.score.steps[0].mult);
        // Every rider pukes as often in the show as on their ticket.
        r.tickets.forEach((t, car) => {
          expect(tl.filter((e) => e.kind === 'puke' && e.car === car).length).toBe(t.pukes);
        });
        pukes += r.tickets.reduce((a, t) => a + t.pukes, 0);
        // The final state is the ride's score.
        const slam = tl[tl.length - 1];
        expect(slam.rating).toBe(r.score.rating);
        expect(ratingOf(r.score.chips, r.score.mult, r.kind === 'shuttle')).toBe(r.score.rating);
      }
    // Make sure the seeds actually cover the interesting cases.
    expect(rides).toBeGreaterThan(50);
    expect(shuttles).toBeGreaterThan(10);
    expect(pukes).toBeGreaterThan(20);
    expect(rides - shuttles).toBeGreaterThan(10);
    expect(fired).toBeGreaterThan(10);
  });

  it('is ordered, and the running total and rating never go down', () => {
    for (const seed of seeds) {
      const g = playRide(seed, 'any');
      if (g.phase !== 'ride') continue;
      const tl = g.result!.timeline;
      for (let i = 1; i < tl.length; i++) {
        expect(tl[i].at).toBeGreaterThanOrEqual(tl[i - 1].at);
        expect(tl[i].total).toBeGreaterThanOrEqual(tl[i - 1].total);
        expect(tl[i].rating).toBeGreaterThanOrEqual(tl[i - 1].rating);
        expect(tl[i].pay).toBeGreaterThanOrEqual(0);
      }
      // Attractions fire after the train is back, in slot order, before the slam.
      const firstStation = tl.findIndex((e) => e.kind === 'attraction' || e.kind === 'slam');
      expect(tl.slice(firstStation).every((e) => e.kind === 'attraction' || e.kind === 'slam')).toBe(true);
      const slots = tl.filter((e) => e.kind === 'attraction').map((e) => (e.kind === 'attraction' ? e.slot : -1));
      expect(slots).toEqual([...slots].sort((a, b) => a - b));
      // A piece pays its chips before anyone pukes on it.
      for (const e of tl)
        if (e.kind === 'puke') {
          const chips = tl.findIndex((c) => c.kind === 'chips' && c.stop === e.stop);
          if (chips >= 0) expect(chips).toBeLessThan(tl.indexOf(e));
        }
    }
  });

  it('pays each puke at the rating so far, times the rider’s worth', () => {
    for (const seed of seeds) {
      const g = playRide(seed, 'any');
      if (g.phase !== 'ride') continue;
      for (const e of g.result!.timeline) if (e.kind === 'puke') expect(e.pay).toBe(e.rating * e.worth);
    }
  });
});

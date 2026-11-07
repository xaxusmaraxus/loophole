import { Game } from '../game';
import { applyBulge, bulges } from '../puzzle/board';
import { makeRider } from '../riders/riders';
import type { CardRun } from './cardgame';

// Coaster Cards on the real park: each day is a Game whose loop has one track cell
// per slot, laid out compactly around the board. Played cards set those cells'
// elements in ride order, so the 3D park, the ride strip, the closing ride and
// its scoring (excitement × multiplier for every puke) all work unchanged.

/** Riders in line for a card ride. */
export const CARD_RIDERS = 8;

/** A fresh park for the run's day: a loop of `slots` cells (Flat until played), no loose tiles. */
export function cardPark(run: CardRun, seed: string, into?: Game): Game {
  const g = into ?? new Game(`${seed}-${run.day}`);
  if (into) into.newRun(`${seed}-${run.day}`);
  g.cards = true;
  g.beginPark();
  g.chooseNode(0, 0);
  const b = g.board;
  b.tiles = b.tiles.map(() => 0);
  b.obstacles = b.obstacles.map(() => null);
  if (b.flav) b.flav = b.flav.map(() => null);
  b.soft = b.soft.map(() => false);
  // Swell the loop out, nearest the middle first, until it has a cell per slot.
  const mid = (b.size - 1) / 2;
  for (let guard = 0; b.ends[0].length < run.slots && guard < 40; guard++) {
    const d = (p: { x: number; y: number }) => Math.hypot(p.x - mid, p.y - mid * 1.25);
    const best = bulges(b).sort((u, v) => d(u.c) + d(u.d) - (d(v.c) + d(v.d)))[0];
    if (!best) break;
    applyBulge(b, best);
  }
  for (const c of b.ends[0]) c.tier = 0;
  g.banked = 0;
  g.actions = 0;
  g.events.length = 0;
  g.queue = Array.from({ length: CARD_RIDERS }, (_, i) => makeRider(g.rng, Math.min(run.day, 6), 1000 + i, g.cfg.park.id));
  g.cfg.target = run.target;
  return g;
}

/** Puts the run's ride onto the park's track (unplayed slots stay Flat). */
export function layRide(g: Game, run: CardRun): void {
  g.board.ends[0].forEach((c, i) => (c.tier = run.ride[i] ?? 0));
}

/** What the ride would score if it ran now. */
export function cardScore(g: Game): number {
  return Math.round(g.projected('circuit'));
}

import { type PieceCell, SPLASH_MULT, type StatMods, cellThrill } from '../puzzle/pieces';
import { pukesFor } from '../riders/riders';
import type { Effect, Score } from './attractions';

// The live scoring show. A ride's final score is broken into an ordered list of
// events that fire while the train runs, so the score is built up in front of
// the player (Balatro-style) instead of being revealed after the ride:
//   - the lead car passes a piece:           +chips (its thrill, plus 1 for length)
//   - a new piece type appears:              +0.5 mult
//   - a rider's nausea passes a stomachful:  a puke, paid at the rating so far × their worth
//   - back at the station, attractions fire left to right (chips, mult, ×mult)
//   - the slam: every puke of the ride is re-paid at the final rating.
// The events sum exactly to what `scoreRide` and the ticket math give, so the
// show never changes balance.

export interface ScoreState {
  chips: number;
  /** Unrounded running multiplier (the display rounds it). */
  mult: number;
  /** What one puke pays right now: round(chips × mult), halved for a shuttle. */
  rating: number;
  /** Pukes so far, weighted by each rider's worth. */
  pukes: number;
  /** Tickets paid out so far. */
  total: number;
}

interface EventBase extends ScoreState {
  /** When the event fires, in ride progress: stop index along the ride, plus a lag for trailing cars. */
  at: number;
  /** Index into the ride's stops (the piece where it happens); the last stop for station events. */
  stop: number;
  /** Tickets this event adds to the total. */
  pay: number;
}

export type ScoreEvent =
  | (EventBase & { kind: 'chips'; tier: number; amount: number })
  | (EventBase & { kind: 'mult'; tier: number; amount: number })
  | (EventBase & { kind: 'puke'; car: number; nth: number; worth: number; boss: boolean })
  | (EventBase & { kind: 'attraction'; slot: number; label: string; effect: Effect })
  | (EventBase & { kind: 'slam' });

export interface TimelineRider {
  /** Nausea the piece at this stop index gives the rider (after attractions and special pieces). */
  nausea: (stop: number) => number;
  /** Nausea per puke (after upgrades and attractions). */
  stomach: number;
  worth: number;
  boss: boolean;
}

export interface TimelineInput {
  /** The ride in order (`rideOrder`), stations included. */
  stops: readonly (PieceCell & { x: number; y: number; station: boolean })[];
  mods: StatMods;
  score: Score;
  shuttle: boolean;
  /** Riders in car order: car 0 leads. */
  riders: readonly TimelineRider[];
  /** How far (in stops) each car trails the one ahead. */
  carLag?: number;
}

export const CAR_LAG = 0.3;

/** The rating one puke pays at this chips and mult, rounded the way `scoreRide` does. */
export function ratingOf(chips: number, mult: number, shuttle: boolean): number {
  const r = Math.round(chips * (Math.round(mult * 100) / 100));
  return shuttle ? Math.round(r / 2) : r;
}

export function rideTimeline(input: TimelineInput): ScoreEvent[] {
  const { stops, mods, score, shuttle, riders } = input;
  const lag = input.carLag ?? CAR_LAG;
  const raw: ScoreEvent[] = [];
  const blank = { chips: 0, mult: 0, rating: 0, pukes: 0, total: 0, pay: 0 };

  // Pieces: chips on the first pass over each cell (a shuttle passes each twice
  // but its excitement counts each piece once). Thrill is scaled by the run's
  // thrill multiplier, rounded on the running sum so the pieces add up exactly.
  const seen = new Set<string>();
  const types = new Set<number>();
  let rawThrill = 0;
  let pieces = 0;
  let chipsSoFar = 0;
  stops.forEach((s, i) => {
    if (s.station) return;
    // A crossing is a second pass through the same cell: it counts as its own piece.
    const key = `${s.x},${s.y}${s.cross ? 'x' : ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    rawThrill += cellThrill(s, mods);
    pieces++;
    const chips = Math.round(rawThrill * mods.thrillMult) + pieces;
    raw.push({ ...blank, kind: 'chips', at: i, stop: i, tier: s.tier, amount: chips - chipsSoFar });
    chipsSoFar = chips;
    if (s.tier > 0 && !types.has(s.tier)) {
      types.add(s.tier);
      if (types.size > 1) raw.push({ ...blank, kind: 'mult', at: i + 0.01, stop: i, tier: s.tier, amount: 0.5 });
    }
    if (s.special === 'splash') raw.push({ ...blank, kind: 'mult', at: i + 0.015, stop: i, tier: s.tier, amount: SPLASH_MULT });
  });

  // Pukes: each rider's nausea builds piece by piece; a puke fires on the piece
  // where it passes another stomachful (same math as `pukesFor`).
  riders.forEach((r, car) => {
    let nausea = 0;
    let done = 0;
    stops.forEach((s, i) => {
      if (s.station) return;
      nausea += r.nausea(i);
      const due = pukesFor(nausea, r.stomach);
      for (let n = done + 1; n <= due; n++)
        raw.push({ ...blank, kind: 'puke', at: i + car * lag + 0.02 + n * 0.001, stop: i, car, nth: n, worth: r.worth, boss: r.boss });
      done = Math.max(done, due);
    });
  });

  raw.sort((a, b) => a.at - b.at);

  // Back at the station: attractions left to right, then the slam.
  const last = stops.length - 1;
  let at = last + Math.max(0, riders.length - 1) * lag + 1;
  for (const st of score.steps.slice(1)) {
    if (st.slot === undefined) continue; // The shuttle half is already in every rating.
    raw.push({ ...blank, kind: 'attraction', at: at++, stop: last, slot: st.slot, label: st.label, effect: st.effect });
  }
  raw.push({ ...blank, kind: 'slam', at, stop: last });

  // Walk the events and fill in the running state and each payout.
  let chips = 0;
  let mult = 1;
  let pukes = 0;
  let total = 0;
  for (const e of raw) {
    let pay = 0;
    if (e.kind === 'chips') chips += e.amount;
    else if (e.kind === 'mult') mult += e.amount;
    else if (e.kind === 'attraction') {
      chips += e.effect.chips ?? 0;
      mult += e.effect.mult ?? 0;
      mult *= e.effect.xmult ?? 1;
    } else if (e.kind === 'puke') {
      pukes += e.worth;
      pay = ratingOf(chips, mult, shuttle) * e.worth;
    } else {
      // The slam: every puke is re-paid at the final rating.
      chips = score.chips;
      mult = score.mult;
      pay = score.rating * pukes - total;
    }
    total += pay;
    Object.assign(e, { chips, mult, rating: e.kind === 'slam' ? score.rating : ratingOf(chips, mult, shuttle), pukes, total, pay });
  }
  return raw;
}

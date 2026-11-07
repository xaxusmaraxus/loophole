import type { Rng } from '../core/rng';

// Coaster Cards (experimental mode): the coaster is built from a deck of cards.
// Your ride is a row of empty slots. Each turn you play a card from your hand onto
// the end of the ride, merge two matching cards into the next element (2048-style),
// or discard one. When every slot is filled, the ride runs and scores. Between
// days you build your deck. Card tiers are the same elements as the main game:
// 1 Airtime Hill, 2 Lift Hill, 3 Helix, 4 Vertical Loop, 5 Corkscrew, 6 Cobra Roll, 7 Top Hat.
// Rules only: scoring a ride is passed in (the mode uses the real ride's scoring).

export const TOP_TIER = 7;

export type RewardId = 'helix' | 'loop' | 'lifts' | 'thin' | 'slot' | 'discard' | 'hand' | 'corkscrew' | 'tophat';

export interface RewardDef {
  name: string;
  desc: string;
  /** Earliest day it's offered. */
  from: number;
}

export const REWARDS: Record<RewardId, RewardDef> = {
  helix: { name: 'Two Helixes', desc: 'Add 2 Helix cards to your deck.', from: 1 },
  lifts: { name: 'Lift crew', desc: 'Add 2 Lift Hill cards: each powers up the next element.', from: 1 },
  loop: { name: 'A Vertical Loop', desc: 'Add a Vertical Loop card.', from: 2 },
  corkscrew: { name: 'A Corkscrew', desc: 'Add a Corkscrew card.', from: 4 },
  tophat: { name: 'A Top Hat', desc: 'Add a Top Hat card.', from: 6 },
  thin: { name: 'Clear the deck', desc: 'Remove your 3 smallest cards.', from: 1 },
  slot: { name: 'Longer ride', desc: '+1 slot in every ride (more to fill, more to score).', from: 2 },
  discard: { name: 'Extra discard', desc: '+1 discard every day.', from: 1 },
  hand: { name: 'Bigger hand', desc: '+1 card in your hand.', from: 3 },
};

export interface CardRun {
  /** Day of the run, from 1. */
  day: number;
  hearts: number;
  /** Your whole collection, as tiers. */
  deck: number[];
  /** Today's draw pile (top = last). */
  pile: number[];
  hand: number[];
  /** Today's ride: one tier per filled slot, in order. */
  ride: number[];
  slots: number;
  handSize: number;
  discardsPerDay: number;
  discards: number;
  /** Merges made today (for the results). */
  merges: number;
  target: number;
  /** Day scores so far. */
  scores: number[];
}

export const DAYS = 8;
export const START_DECK = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3];

/** Day targets (set from bot runs: tools/cards-bot.ts). */
export const CARD_TARGETS = [5000, 6000, 7200, 8600, 10300, 12400, 14900, 17900];

export function newCardRun(): CardRun {
  return { day: 1, hearts: 3, deck: [...START_DECK], pile: [], hand: [], ride: [], slots: 10, handSize: 5, discardsPerDay: 3, discards: 3, merges: 0, target: CARD_TARGETS[0], scores: [] };
}

/** Starts the run's current day: shuffle the deck, draw a hand, empty the ride. */
export function startCardDay(run: CardRun, rng: Rng): void {
  run.pile = rng.shuffle([...run.deck]);
  run.hand = [];
  run.ride = [];
  run.discards = run.discardsPerDay;
  run.merges = 0;
  run.target = CARD_TARGETS[run.day - 1] ?? Math.round(CARD_TARGETS[CARD_TARGETS.length - 1] * 1.5 ** (run.day - CARD_TARGETS.length));
  draw(run);
}

/** Fills the hand from the pile. */
export function draw(run: CardRun): void {
  while (run.hand.length < run.handSize && run.pile.length) run.hand.push(run.pile.pop()!);
}

export const rideFull = (run: CardRun) => run.ride.length >= run.slots;

/** The day can't go on: the ride is full, or the hand is empty and nothing's left to draw. */
export const dayOver = (run: CardRun) => rideFull(run) || (!run.hand.length && !run.pile.length);

/** Plays the hand's card i onto the end of the ride. */
export function playCard(run: CardRun, i: number): boolean {
  if (rideFull(run) || i < 0 || i >= run.hand.length) return false;
  run.ride.push(run.hand.splice(i, 1)[0]);
  draw(run);
  return true;
}

/** Can cards i and j merge? Two of the same element below a Top Hat. */
export function canMerge(run: CardRun, i: number, j: number): boolean {
  return i !== j && run.hand[i] !== undefined && run.hand[i] === run.hand[j] && run.hand[i] < TOP_TIER;
}

/** Merges cards i and j into one card a tier up (it takes i's place), then draws. */
export function mergeCards(run: CardRun, i: number, j: number): boolean {
  if (!canMerge(run, i, j)) return false;
  run.hand[i]++;
  run.hand.splice(j, 1);
  run.merges++;
  draw(run);
  return true;
}

/** Throws away card i and draws another (a few a day). */
export function discardCard(run: CardRun, i: number): boolean {
  if (run.discards <= 0 || i < 0 || i >= run.hand.length) return false;
  run.hand.splice(i, 1);
  run.discards--;
  draw(run);
  return true;
}

/** Records the day's score; a miss costs a heart. Returns whether the day was beaten. */
export function endCardDay(run: CardRun, score: number): boolean {
  run.scores.push(score);
  const passed = score >= run.target;
  if (!passed) run.hearts--;
  return passed;
}

export const runOver = (run: CardRun) => run.hearts <= 0 || run.day > DAYS;
export const runWon = (run: CardRun) => run.hearts > 0 && run.day > DAYS;

/** Three rewards to pick from after a day. */
export function rewardChoices(run: CardRun, rng: Rng): RewardId[] {
  const pool = (Object.keys(REWARDS) as RewardId[]).filter((id) => REWARDS[id].from <= run.day && !(id === 'hand' && run.handSize >= 7) && !(id === 'thin' && run.deck.length <= 12));
  return rng.shuffle(pool).slice(0, 3);
}

/** Applies a reward and moves on to the next day. */
export function takeReward(run: CardRun, id: RewardId | null): void {
  const add = (...t: number[]) => run.deck.push(...t);
  if (id === 'helix') add(3, 3);
  if (id === 'lifts') add(2, 2);
  if (id === 'loop') add(4);
  if (id === 'corkscrew') add(5);
  if (id === 'tophat') add(7);
  if (id === 'thin') {
    const sorted = [...run.deck].sort((a, b) => a - b).slice(0, 3);
    for (const t of sorted) run.deck.splice(run.deck.indexOf(t), 1);
  }
  if (id === 'slot') run.slots++;
  if (id === 'discard') run.discardsPerDay++;
  if (id === 'hand') run.handSize++;
  run.day++;
}

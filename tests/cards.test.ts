import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { canMerge, dayOver, discardCard, endCardDay, mergeCards, newCardRun, playCard, rewardChoices, startCardDay, takeReward } from '../src/cards/cardgame';
import { cardPark, cardScore, layRide } from '../src/cards/cardpark';

describe('Coaster Cards', () => {
  it('deals a hand, plays onto the ride, and ends the day when the ride is full', () => {
    const run = newCardRun();
    startCardDay(run, new Rng(1));
    expect(run.hand).toHaveLength(5);
    expect(run.pile).toHaveLength(15);
    let k = 0;
    while (!dayOver(run) && k++ < 50) playCard(run, 0);
    expect(run.ride).toHaveLength(10);
    expect(run.hand).toHaveLength(5);
  });

  it('merges two of a kind into the next element and draws; discards are limited', () => {
    const run = newCardRun();
    startCardDay(run, new Rng(2));
    run.hand = [1, 3, 1, 2, 2];
    run.pile = [4, 5];
    expect(canMerge(run, 0, 1)).toBe(false);
    expect(mergeCards(run, 0, 2)).toBe(true);
    expect(run.hand).toEqual([2, 3, 2, 2, 5]);
    run.hand = [7, 7];
    expect(canMerge(run, 0, 1)).toBe(false);
    run.discards = 1;
    expect(discardCard(run, 0)).toBe(true);
    expect(discardCard(run, 0)).toBe(false);
  });

  it('a missed target costs a heart; rewards grow the deck or the run', () => {
    const run = newCardRun();
    startCardDay(run, new Rng(3));
    expect(endCardDay(run, run.target - 1)).toBe(false);
    expect(run.hearts).toBe(2);
    const choices = rewardChoices(run, new Rng(4));
    expect(choices).toHaveLength(3);
    const n = run.deck.length;
    takeReward(run, 'helix');
    expect(run.deck.length).toBe(n + 2);
    expect(run.day).toBe(2);
    takeReward(run, 'thin');
    expect(run.deck.length).toBe(n - 1);
  });

  it('a card ride lays onto a real park loop and scores like the real ride', () => {
    const run = newCardRun();
    startCardDay(run, new Rng(5));
    const g = cardPark(run, 'CARDS');
    expect(g.board.ends[0].length).toBeGreaterThanOrEqual(run.slots);
    expect(g.board.tiles.every((t) => t === 0)).toBe(true);
    const flat = cardScore(g);
    run.ride = [2, 2, 7, 4, 5, 6, 3, 3, 1, 1];
    layRide(g, run);
    expect(g.stats.patterns.map((h) => h.id)).toContain('tower');
    expect(cardScore(g)).toBeGreaterThan(flat);
  });
});

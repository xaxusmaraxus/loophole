import { describe, expect, it } from 'vitest';
import { pickMoments } from '../src/ride/ride';

// Tiers: 0 Flat, 1 Airtime Hill, 2 Lift Hill, 3 Helix, 4 Vertical Loop, 5 Corkscrew, 6 Cobra Roll, 7 Top Hat.
describe('slow-motion picks', () => {
  it('prefers Top Hats, then the wildest inversions', () => {
    // vertical loop, top hat, helix, cobra roll, vertical loop, top hat
    expect([...pickMoments([4, 7, 3, 6, 4, 7])].sort()).toEqual([1, 3, 5]);
  });
  it('falls back to one wild piece when nothing inverts', () => {
    expect([...pickMoments([0, 3, 2, 3, 1])]).toEqual([1]);
  });
  it('fills with loops when there are few big pieces', () => {
    expect([...pickMoments([4, 0, 4, 4, 4])].sort()).toEqual([0, 2, 3]);
  });
  it('ranks a lift chain payoff above its kind', () => {
    // a lift charges the second loop: it beats the corkscrew
    const picks = [...pickMoments([4, 2, 4, 5, 4], [0, 0, 1, 0, 0])];
    expect(picks[0]).toBe(2);
    expect(picks.sort()).toEqual([0, 2, 3]);
  });
  it('gives the finale drop a moment', () => {
    expect([...pickMoments([1, 0, 2, 2], [0, 0, 0, 2])]).toEqual([3]);
  });
});

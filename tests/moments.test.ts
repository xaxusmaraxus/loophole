import { describe, expect, it } from 'vitest';
import { pickMoments } from '../src/ride/ride';

describe('slow-motion picks', () => {
  it('prefers the wildest inversions', () => {
    // tiers along the chain: loop, mega, drop, corkscrew, loop, mega
    expect([...pickMoments([5, 7, 3, 6, 5, 7])].sort()).toEqual([1, 3, 5]);
  });
  it('falls back to one drop when nothing inverts', () => {
    expect([...pickMoments([0, 3, 2, 3, 4])]).toEqual([1]);
  });
  it('fills with loops when there are few big pieces', () => {
    expect([...pickMoments([5, 0, 5, 5, 5])].sort()).toEqual([0, 2, 3]);
  });
});

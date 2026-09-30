import { describe, expect, it } from 'vitest';
import { TIERS, mergeTier } from '../src/puzzle/tiers';

describe('mergeTier', () => {
  it('promotes a tile one tier', () => {
    expect(mergeTier(0)).toBe(1);
  });

  it('caps at the top tier', () => {
    expect(mergeTier(TIERS.length - 1)).toBe(TIERS.length - 1);
  });
});

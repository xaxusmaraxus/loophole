// The merge ladder: two tiles of tier N merge into one tile of tier N+1.
// Stats feed the end-of-level ride (see docs/concepts.md).
export interface Tier {
  name: string;
  thrill: number;
  intensity: number;
}

export const TIERS: readonly Tier[] = [
  { name: 'Plank', thrill: 0, intensity: 0 },
  { name: 'Straight', thrill: 1, intensity: 0 },
  { name: 'Curve', thrill: 2, intensity: 1 },
  { name: 'Hill', thrill: 4, intensity: 2 },
  { name: 'Drop', thrill: 8, intensity: 4 },
  { name: 'Loop', thrill: 16, intensity: 8 },
  { name: 'Corkscrew', thrill: 32, intensity: 14 },
  { name: 'Mega Loop', thrill: 64, intensity: 24 },
];

export function mergeTier(tier: number): number {
  return Math.min(tier + 1, TIERS.length - 1);
}

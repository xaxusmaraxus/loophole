// Hue-shifted ramps (light, base, shade, dark). Outlines use each ramp's own
// dark instead of black, which keeps the pixel art soft.
export type Ramp = readonly [string, string, string, string];

export const TIER_RAMPS: readonly Ramp[] = [
  ['#e6e9f0', '#b8bfcc', '#7f889c', '#4a5064'], // Flat
  ['#f0d29a', '#d9a95f', '#a8743a', '#6b4526'], // Bump
  ['#b6ec8a', '#72c457', '#3f8f45', '#245a36'], // Hill
  ['#9fe3ff', '#45a8e0', '#2a6fb0', '#1d3f7a'], // Drop
  ['#d7b4ff', '#9d6ef0', '#6a45c0', '#3d2a80'], // Helix
  ['#ffb0a0', '#f0584e', '#b83344', '#6e1f36'], // Loop
  ['#ffd9a0', '#ff9a3c', '#d0602a', '#8a3524'], // Corkscrew
  ['#fff4b0', '#ffd23f', '#e0962a', '#9a5a1c'], // Mega Loop
];

export const PAL = {
  shadow: 'rgba(28, 22, 48, 0.28)',
  grass: ['#8fd16a', '#7cc25c', '#6bb052', '#4e8f45'] as Ramp,
  plaza: ['#efe2c6', '#e6d6b4', '#d9c7a0', '#a88d66'] as Ramp,
  dirt: ['#b88a5a', '#8f6440', '#6b4630', '#46301f'] as Ramp,
  leaf: ['#9be07a', '#5cb85c', '#3a8a4f', '#24593b'] as Ramp,
  trunk: '#7a4e2f',
  rock: ['#d9dbe6', '#a9adc0', '#7a7f99', '#4d5170'] as Ramp,
  water: ['#b9f0ff', '#5cc8f0', '#3a8fd6', '#285fa8'] as Ramp,
  wood: '#8a5a36',
  steel: '#8c96b8',
  tie: '#5b3f2e',
  white: '#fbf6ec',
  red: '#f0584e',
  gold: '#ffd23f',
  ink: '#2b2140',
  heart: '#ff5d8a',
  sick: '#a6e05a',
  car: ['#ffb0a0', '#f0584e', '#b83344', '#6e1f36'] as Ramp,
};

export const SKINS = ['#fbd9bd', '#eab893', '#c98d63', '#95603f', '#63402b'];
export const HAIRS = ['#3a2718', '#6b4428', '#b0602e', '#e8bf5a', '#e4e4ec', '#232338', '#e0484e', '#8a5ad0'];
export const SHIRTS = ['#f0584e', '#45a8e0', '#72c457', '#ffd23f', '#9d6ef0', '#ff9a3c', '#ff8fb8', '#35c2b0', '#fbf6ec'];
export const PANTS = ['#3a4a7a', '#4a4a5c', '#6b5238', '#2e5a8a'];

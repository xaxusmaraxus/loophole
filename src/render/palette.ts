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

// Index 5 is ghost-pale.
export const SKINS = ['#fbd9bd', '#eab893', '#c98d63', '#95603f', '#63402b', '#dfe6f5'];
export const HAIRS = ['#3a2718', '#6b4428', '#b0602e', '#e8bf5a', '#e4e4ec', '#232338', '#e0484e', '#8a5ad0'];
export const SHIRTS = ['#f0584e', '#45a8e0', '#72c457', '#ffd23f', '#9d6ef0', '#ff9a3c', '#ff8fb8', '#35c2b0', '#fbf6ec'];
// Index 4 is a ghost's sheet.
export const PANTS = ['#3a4a7a', '#4a4a5c', '#6b5238', '#2e5a8a', '#eef2fb'];

export interface ParkTheme {
  grass: Ramp;
  plaza: Ramp;
  plazaStyle: 'pavers' | 'planks';
  /** Sand or mud patches. */
  soft: Ramp;
  /** A constant color wash over the whole park, if any. */
  tint?: string;
}

export const THEMES: Record<'meadow' | 'boardwalk' | 'hollow' | 'finale', ParkTheme> = {
  meadow: { grass: PAL.grass, plaza: PAL.plaza, plazaStyle: 'pavers', soft: ['#f4dca0', '#e9c987', '#d2ae6a', '#a88550'] },
  boardwalk: {
    grass: ['#c2e08a', '#aed178', '#98c066', '#6f9a4c'],
    plaza: ['#e8c28c', '#d3a66c', '#b5864f', '#7e5a35'],
    plazaStyle: 'planks',
    soft: ['#fbe7b3', '#f1d696', '#dcbb74', '#b08e52'],
  },
  hollow: {
    grass: ['#8fa88a', '#7a9676', '#688466', '#48604c'],
    plaza: ['#9d98b3', '#86819e', '#716b89', '#524c68'],
    plazaStyle: 'pavers',
    soft: ['#9a7a58', '#826346', '#6a4f38', '#4a3626'],
    tint: 'rgba(70, 40, 120, 0.16)',
  },
  finale: {
    grass: PAL.grass,
    plaza: ['#fbe9f0', '#f3d6e2', '#e2bccd', '#b98ea3'],
    plazaStyle: 'pavers',
    soft: ['#f4dca0', '#e9c987', '#d2ae6a', '#a88550'],
  },
};

export const MYSTERY: Ramp = ['#c3b3ec', '#8b74c6', '#63509c', '#3d2f6b'];

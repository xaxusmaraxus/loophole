import type { Look } from '../riders/riders';
import { HAIRS, MYSTERY, PAL, PANTS, type Ramp, SHIRTS, SKINS, TIER_RAMPS } from './palette';

export type Ctx = CanvasRenderingContext2D;

export function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function bitmap(ctx: Ctx, rows: readonly string[], x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === '#') ctx.fillRect(x + c, y + r, 1, 1);
}

/** Deterministic hash for per-object variation (tree shapes etc). */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// 8x8 icons for each merge tier (index 0 = Flat, never drawn as a tile).
const ICONS: readonly (readonly string[])[] = [
  [],
  ['........', '........', '........', '...##...', '..#..#..', '.#....#.', '#......#', '........'],
  ['...##...', '..#..#..', '.#....#.', '.#....#.', '#......#', '#......#', '#......#', '........'],
  ['#.......', '##......', '#.#.....', '#..#....', '#...#...', '#....#..', '#.....##', '........'],
  ['.######.', '#......#', '#.####.#', '#.#..#.#', '#.#.##.#', '#.#....#', '#..#####', '........'],
  ['..####..', '.#....#.', '#......#', '#......#', '.#....#.', '..#..#..', '###..###', '........'],
  ['........', '.##..##.', '#..##..#', '#..##..#', '.##..##.', '........', '########', '........'],
  ['..####..', '.#.##.#.', '#.####.#', '#..##..#', '#.#..#.#', '.#....#.', '###..###', '........'],
];

export function drawIcon(ctx: Ctx, tier: number, x: number, y: number, color: string): void {
  bitmap(ctx, ICONS[tier] ?? [], x, y, color);
}

/** A tile as a little crate: top face with the icon, a front face below. x,y = cell top-left. */
export function drawCrate(ctx: Ctx, tier: number, x: number, y: number, flash = 0): void {
  const r = TIER_RAMPS[tier];
  px(ctx, x + 2, y + 14, 13, 2, PAL.shadow);
  px(ctx, x + 1, y + 11, 14, 4, r[2]);
  px(ctx, x + 1, y + 14, 14, 1, r[3]);
  px(ctx, x + 1, y + 1, 14, 10, r[1]);
  px(ctx, x + 1, y + 1, 14, 1, r[0]);
  px(ctx, x + 1, y + 1, 1, 10, r[0]);
  // Plank seams on the front face.
  px(ctx, x + 5, y + 11, 1, 3, r[3]);
  px(ctx, x + 10, y + 11, 1, 3, r[3]);
  drawIcon(ctx, tier, x + 4, y + 2, r[3]);
  if (flash > 0) {
    ctx.globalAlpha = flash;
    px(ctx, x + 1, y + 1, 14, 14, PAL.white);
    ctx.globalAlpha = 1;
  }
}

const QUESTION = ['..##..', '.#..#.', '....#.', '...#..', '..#...', '......', '..#...'];

/** A fogged tile: you can see a crate is there, not what's in it. */
export function drawMystery(ctx: Ctx, x: number, y: number): void {
  const r = MYSTERY;
  px(ctx, x + 2, y + 14, 13, 2, PAL.shadow);
  px(ctx, x + 1, y + 11, 14, 4, r[2]);
  px(ctx, x + 1, y + 14, 14, 1, r[3]);
  px(ctx, x + 1, y + 1, 14, 10, r[1]);
  px(ctx, x + 1, y + 1, 14, 1, r[0]);
  bitmap(ctx, QUESTION, x + 5, y + 3, r[0]);
}

// ---- People ---------------------------------------------------------------

export interface PersonPose {
  step?: number;
  sick?: boolean;
  scream?: boolean;
}

function skinOf(look: Look, sick?: boolean): string {
  return sick ? PAL.sick : SKINS[look.skin];
}

function drawHair(ctx: Ctx, look: Look, x: number, y: number): void {
  const hair = HAIRS[look.hair];
  switch (look.hairStyle) {
    case 'short':
      px(ctx, x + 1, y, 5, 2, hair);
      break;
    case 'long':
      px(ctx, x + 1, y, 5, 2, hair);
      px(ctx, x + 1, y + 2, 1, 3, hair);
      px(ctx, x + 5, y + 2, 1, 3, hair);
      break;
    case 'bun':
      px(ctx, x + 2, y - 1, 3, 1, hair);
      px(ctx, x + 1, y, 5, 2, hair);
      break;
    case 'spiky':
      px(ctx, x + 1, y, 5, 2, hair);
      px(ctx, x + 1, y - 1, 1, 1, hair);
      px(ctx, x + 3, y - 1, 1, 1, hair);
      px(ctx, x + 5, y - 1, 1, 1, hair);
      break;
    case 'cap':
      px(ctx, x + 1, y, 5, 2, SHIRTS[(look.shirt + 3) % SHIRTS.length]);
      px(ctx, x + 5, y + 1, 2, 1, SHIRTS[(look.shirt + 3) % SHIRTS.length]);
      break;
    case 'bald':
      break;
  }
}

function drawFace(ctx: Ctx, look: Look, x: number, y: number, pose: PersonPose): void {
  px(ctx, x + 1, y, 5, 5, skinOf(look, pose.sick));
  drawHair(ctx, look, x, y);
  const eye = PAL.ink;
  if (look.accessory === 'shades') px(ctx, x + 1, y + 2, 5, 1, eye);
  else {
    px(ctx, x + 2, y + 2, 1, 1, eye);
    px(ctx, x + 4, y + 2, 1, 1, eye);
    if (look.accessory === 'glasses') {
      px(ctx, x + 1, y + 2, 1, 1, '#c9c9d6');
      px(ctx, x + 3, y + 2, 1, 1, '#c9c9d6');
      px(ctx, x + 5, y + 2, 1, 1, '#c9c9d6');
    }
  }
  if (pose.scream) px(ctx, x + 3, y + 3, 1, 2, eye);
}

/** Standing person, feet at (fx, fy). About 7x11 (kids 7x9). */
export function drawPerson(ctx: Ctx, look: Look, fx: number, fy: number, pose: PersonPose = {}): void {
  if (look.big) {
    // Bosses: the same sprite at twice the size.
    ctx.save();
    ctx.translate(Math.round(fx), Math.round(fy));
    ctx.scale(2, 2);
    drawPerson(ctx, { ...look, big: false }, 0, 0, pose);
    ctx.restore();
    return;
  }
  const h = look.small ? 9 : 11;
  const x = Math.round(fx - 3);
  const y = Math.round(fy - h);
  px(ctx, x, fy - 1, 7, 2, PAL.shadow);
  const bodyH = look.small ? 3 : 4;
  const shirt = SHIRTS[look.shirt];
  const pants = PANTS[look.pants];
  const skin = skinOf(look, pose.sick);
  // Legs (alternate while walking).
  const s = pose.step ?? 0;
  px(ctx, x + 1, y + 5 + bodyH, 2, h - 5 - bodyH - (s === 1 ? 1 : 0), pants);
  px(ctx, x + 4, y + 5 + bodyH, 2, h - 5 - bodyH - (s === 2 ? 1 : 0), pants);
  // Body and arms.
  px(ctx, x + 1, y + 5, 5, bodyH, shirt);
  px(ctx, x, y + 5, 1, bodyH - 1, skin);
  px(ctx, x + 6, y + 5, 1, bodyH - 1, skin);
  drawFace(ctx, look, x, y, pose);
  if (look.accessory === 'corndog') {
    px(ctx, x + 7, y + 3, 1, 3, '#e0962a');
    px(ctx, x + 7, y + 6, 1, 1, PAL.white);
  } else if (look.accessory === 'camera') {
    px(ctx, x + 2, y + 6, 3, 2, PAL.ink);
  } else if (look.accessory === 'balloon') {
    px(ctx, x + 7, y - 6, 3, 3, PAL.red);
    px(ctx, x + 8, y - 3, 1, 8, '#e4e4ec');
  }
}

/** Head and shoulders, for riders sitting in a car. Top-left at (x, y). */
export function drawSeated(ctx: Ctx, look: Look, x: number, y: number, pose: PersonPose = {}): void {
  px(ctx, x + 1, y + 5, 5, 1, SHIRTS[look.shirt]);
  drawFace(ctx, look, x, y, pose);
}

export function drawPortrait(canvas: HTMLCanvasElement, look: Look): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPerson(ctx, { ...look, big: false, accessory: look.accessory === 'balloon' ? 'none' : look.accessory }, 5, canvas.height - 1);
}

export function drawCar(ctx: Ctx, x: number, y: number, ramp: Ramp = PAL.car): void {
  px(ctx, x, y, 7, 4, ramp[1]);
  px(ctx, x, y, 7, 1, ramp[0]);
  px(ctx, x, y + 3, 7, 1, ramp[3]);
  px(ctx, x + 1, y + 2, 5, 1, PAL.gold);
}

// ---- Thought bubbles --------------------------------------------------------

const MOODS: Record<string, readonly string[]> = {
  happy: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  meh: ['.....', '.....', '#.#.#', '.....', '.....'],
  sick: ['.###.', '#...#', '#.#.#', '#..#.', '.##..'],
  angry: ['..#..', '..#..', '..#..', '.....', '..#..'],
};

export function drawBubble(ctx: Ctx, mood: keyof typeof MOODS, cx: number, bottom: number): void {
  const x = Math.round(cx - 4);
  const y = Math.round(bottom - 8);
  px(ctx, x, y, 9, 7, PAL.ink);
  px(ctx, x + 1, y + 1, 7, 5, PAL.white);
  px(ctx, x + 1, y + 7, 2, 1, PAL.ink);
  const color = mood === 'happy' ? PAL.heart : mood === 'sick' ? '#5aa02a' : mood === 'angry' ? PAL.red : PAL.ink;
  bitmap(ctx, MOODS[mood], x + 2, y + 1, color);
}

// ---- Scenery ----------------------------------------------------------------

/** x,y = cell top-left, s = seed for variation. */
export function drawTree(ctx: Ctx, x: number, y: number, s: number): void {
  const cx = x + 8;
  const ground = y + 13;
  px(ctx, cx - 5, ground, 11, 2, PAL.shadow);
  px(ctx, cx - 1, ground - 5, 2, 6, PAL.trunk);
  const r = 5 + Math.floor(hash(s, 1) * 2);
  const cy = ground - 6 - r;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d = (dx * dx) / ((r + 1) * (r + 1)) + (dy * dy) / (r * r);
      const edge = hash(s, dx + 20, dy + 20) * 0.35;
      if (d > 1 - edge * 0.5) continue;
      const light = dx + dy < -r * 0.6 ? 0 : dx + dy > r * 0.5 ? 2 : 1;
      const speck = hash(s, dx, dy) < 0.12 ? 1 : 0;
      ctx.fillStyle = PAL.leaf[Math.min(3, light + speck)];
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
}

export function drawRock(ctx: Ctx, x: number, y: number, s: number): void {
  const w = 10 + Math.floor(hash(s, 2) * 3);
  const rx = x + 8 - Math.floor(w / 2);
  px(ctx, rx, y + 12, w + 1, 2, PAL.shadow);
  px(ctx, rx + 1, y + 5, w - 2, 7, PAL.rock[1]);
  px(ctx, rx, y + 7, w, 5, PAL.rock[1]);
  px(ctx, rx + 1, y + 5, w - 3, 2, PAL.rock[0]);
  px(ctx, rx, y + 10, w, 2, PAL.rock[2]);
  px(ctx, rx + 3, y + 8, 2, 1, PAL.rock[2]);
}

export function drawPond(ctx: Ctx, x: number, y: number, t: number): void {
  px(ctx, x + 2, y + 3, 12, 11, PAL.water[3]);
  px(ctx, x + 1, y + 5, 14, 7, PAL.water[3]);
  px(ctx, x + 3, y + 4, 10, 9, PAL.water[1]);
  px(ctx, x + 2, y + 6, 12, 5, PAL.water[1]);
  const shimmer = Math.floor(t / 500) % 3;
  px(ctx, x + 4 + shimmer, y + 6, 3, 1, PAL.water[0]);
  px(ctx, x + 8 - shimmer, y + 9, 2, 1, PAL.water[0]);
  px(ctx, x + 11, y + 4, 2, 2, PAL.leaf[1]);
}

export function drawStand(ctx: Ctx, x: number, y: number): void {
  px(ctx, x + 2, y + 13, 13, 2, PAL.shadow);
  px(ctx, x + 2, y + 6, 12, 8, PAL.white);
  px(ctx, x + 2, y + 12, 12, 2, PAL.plaza[3]);
  px(ctx, x + 4, y + 8, 8, 3, PAL.ink);
  px(ctx, x + 5, y + 9, 6, 1, '#e0962a');
  for (let i = 0; i < 7; i++) px(ctx, x + 1 + i * 2, y + 2, 2, 4, i % 2 ? PAL.white : PAL.red);
  px(ctx, x + 1, y + 5, 14, 1, '#b83344');
}

/** The station: a two-cell platform with a striped canopy. x,y = top-left of the left cell. */
export function drawStation(ctx: Ctx, x: number, y: number): void {
  const w = 32;
  px(ctx, x + 1, y + 14, w - 1, 2, PAL.shadow);
  px(ctx, x, y + 4, w, 10, PAL.rock[1]);
  px(ctx, x, y + 11, w, 3, PAL.rock[2]);
  px(ctx, x, y + 4, w, 1, PAL.rock[0]);
  // Yellow safety line along the platform edge.
  for (let i = 0; i < w; i += 4) px(ctx, x + i, y + 12, 2, 1, PAL.gold);
  // Posts and canopy.
  px(ctx, x + 1, y - 2, 1, 8, PAL.ink);
  px(ctx, x + w - 2, y - 2, 1, 8, PAL.ink);
  px(ctx, x + 15, y - 2, 1, 8, PAL.ink);
  for (let i = 0; i < w / 2; i++) px(ctx, x + i * 2, y - 5, 2, 4, i % 2 ? PAL.white : PAL.red);
  px(ctx, x, y - 2, w, 1, '#b83344');
  px(ctx, x + 11, y - 9, 10, 4, PAL.gold);
  px(ctx, x + 12, y - 8, 8, 2, PAL.ink);
}

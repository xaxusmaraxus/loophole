import { ATTRACTIONS, type AttractionId, type Theme } from './attractions';
import type { UpgradeId } from './run';

// The park plot: a backpack-style grid where everything you've built for the park
// sits. Attractions and upgrades take up room (commons and upgrades 1×1, rares
// 2×1 and turnable, boss legendaries 2×2), so space is the real budget.
// Placement matters:
//  - attractions score in reading order (top row first, left to right),
//  - an attraction gets +1 multiplier for each touching spot of its theme (a district),
//  - some attractions care what touches them (Ferris Wheel, Hall of Mirrors, Funnel Cake).
// The plot grows a row every time you break a boss.

export const PLOT_W = 5;
export const PLOT_START_H = 2;
export const PLOT_MAX_H = 5;
/** Spots waiting off the plot (bought with nowhere to go yet). They don't count. */
export const STASH_SIZE = 2;

export const UPGRADE_THEME: Record<UpgradeId, Theme> = {
  latenight: 'show',
  lumber: 'garden',
  hype: 'show',
  fries: 'food',
  billboard: 'show',
  landscaper: 'garden',
  scenic: 'garden',
  wrench: 'thrill',
  teacups: 'food',
  floodgates: 'garden',
  gantry: 'thrill',
  blueprints: 'show',
};

export type PlotRef = { kind: 'attraction'; id: AttractionId } | { kind: 'upgrade'; id: UpgradeId };

export type PlotItem = PlotRef & {
  uid: number;
  /** Scaling attractions (Season Pass) remember their growth here. */
  counter: number;
  x: number;
  y: number;
  /** Rares lie 2×1; turned they stand 1×2. */
  turned: boolean;
};

export interface Plot {
  w: number;
  h: number;
  items: PlotItem[];
  stash: PlotItem[];
}

export function emptyPlot(): Plot {
  return { w: PLOT_W, h: PLOT_START_H, items: [], stash: [] };
}

export function themeOf(r: PlotRef): Theme {
  return r.kind === 'attraction' ? ATTRACTIONS[r.id].theme : UPGRADE_THEME[r.id];
}

export function sizeOf(r: PlotRef, turned = false): { w: number; h: number } {
  if (r.kind === 'upgrade') return { w: 1, h: 1 };
  const rar = ATTRACTIONS[r.id].rarity;
  if (rar === 'legendary') return { w: 2, h: 2 };
  if (rar === 'rare') return turned ? { w: 1, h: 2 } : { w: 2, h: 1 };
  return { w: 1, h: 1 };
}

export function cellsOf(it: Pick<PlotItem, 'kind' | 'id' | 'x' | 'y' | 'turned'>): { x: number; y: number }[] {
  const { w, h } = sizeOf(it as PlotRef, it.turned);
  const out: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: it.x + dx, y: it.y + dy });
  return out;
}

/** Whether `r` fits at (x, y), ignoring the item with uid `ignore` (the one being moved). */
export function fits(p: Plot, r: PlotRef, x: number, y: number, turned: boolean, ignore = -1): boolean {
  const cells = cellsOf({ ...r, x, y, turned });
  if (cells.some((c) => c.x < 0 || c.y < 0 || c.x >= p.w || c.y >= p.h)) return false;
  const taken = new Set(p.items.filter((i) => i.uid !== ignore).flatMap((i) => cellsOf(i).map((c) => `${c.x},${c.y}`)));
  return cells.every((c) => !taken.has(`${c.x},${c.y}`));
}

/** The first spot `r` fits, in reading order, either way round. */
export function firstFit(p: Plot, r: PlotRef, ignore = -1): { x: number; y: number; turned: boolean } | null {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      for (const turned of [false, true]) if (fits(p, r, x, y, turned, ignore)) return { x, y, turned };
  return null;
}

/** Placed items in scoring (reading) order. */
export function readingOrder<T extends PlotItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Do two placed items share an edge? */
export function touches(a: PlotItem, b: PlotItem): boolean {
  if (a.uid === b.uid) return false;
  const bc = cellsOf(b);
  return cellsOf(a).some((c) => bc.some((d) => Math.abs(c.x - d.x) + Math.abs(c.y - d.y) === 1));
}

export function neighbors(p: Plot, it: PlotItem): PlotItem[] {
  return p.items.filter((o) => touches(it, o));
}

/** Touching neighbors of the same theme: the district bonus. */
export function district(p: Plot, it: PlotItem): number {
  const t = themeOf(it);
  return neighbors(p, it).filter((o) => themeOf(o) === t).length;
}

/** Free cells on the plot. */
export function freeCells(p: Plot): number {
  return p.w * p.h - p.items.reduce((a, i) => a + cellsOf(i).length, 0);
}

import type { Board } from '../puzzle/board';
import { idx } from '../puzzle/board';
import type { ParkId } from '../run/run';
import { type Col, Geo, rng, shade, v3 } from './geo';

// The lie of the land. Later parks aren't flat: the station stands up high (so the
// ride starts with a drop), and grassy hills rise out of the board, lifting the
// crates and the track built on them. It's all scenery: the puzzle and the scoring
// don't know about it.

export interface Hill {
  /** Cell rectangle, inclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  h: number;
}

export interface Terrain {
  hills: Hill[];
  /** How high the station deck stands above the plaza. */
  lift: number;
  /** Ground height above the board's grass at a world point. */
  height(x: number, z: number): number;
  /** Ground height under a cell's center. */
  cell(x: number, y: number): number;
}

/** Hill slopes run this far past the hill's cells. */
const FALL = 0.46;
/** The flat top stops a little inside the hill's outer cells. */
const INSET = 0.1;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hillHeight(hl: Hill, x: number, z: number): number {
  const dx = Math.max(hl.x0 + INSET - x, 0, x - (hl.x1 + 1 - INSET));
  const dz = Math.max(hl.y0 + INSET - z, 0, z - (hl.y1 + 1 - INSET));
  const d = Math.hypot(dx, dz);
  return hl.h * (1 - smooth(0, FALL, d));
}

const PLANS: Record<ParkId, { lift: number; hills: number; h: [number, number] }> = {
  meadow: { lift: 0, hills: 0, h: [0, 0] },
  boardwalk: { lift: 0.34, hills: 1, h: [0.28, 0.36] },
  hollow: { lift: 0.5, hills: 2, h: [0.3, 0.5] },
  finale: { lift: 0.62, hills: 3, h: [0.3, 0.5] },
};

export function makeTerrain(b: Board, park: ParkId, seed: number): Terrain {
  const n = b.size;
  const plan = PLANS[park] ?? PLANS.meadow;
  const r = rng(seed * 7 + 11);
  const hills: Hill[] = [];
  const taken = new Set<number>();
  // Hills stay off obstacles, off the row the track leaves the station from, and apart from each other.
  const free = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < n && y < n - 1 && !b.obstacles[idx(b, x, y)] && !taken.has(y * n + x);
  for (let k = 0, tries = 0; k < plan.hills && tries < 60; tries++) {
    const w = r() < 0.5 ? 2 : 1;
    const d = r() < 0.5 ? 2 : 1;
    const x0 = Math.floor(r() * (n - w + 1));
    const y0 = Math.floor(r() * (n - d));
    let ok = true;
    for (let y = y0 - 1; y <= y0 + d && ok; y++)
      for (let x = x0 - 1; x <= x0 + w && ok; x++) {
        const inside = x >= x0 && x < x0 + w && y >= y0 && y < y0 + d;
        if (inside && !free(x, y)) ok = false;
        if (!inside && taken.has(y * n + x)) ok = false;
      }
    if (!ok) continue;
    for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + w; x++) taken.add(y * n + x);
    const h = plan.h[0] + r() * (plan.h[1] - plan.h[0]);
    hills.push({ x0, y0, x1: x0 + w - 1, y1: y0 + d - 1, h: Math.round(h * 100) / 100 });
    k++;
  }
  const height = (x: number, z: number) => {
    if (x < 0 || z < 0 || x > n || z > n) return 0;
    let v = 0;
    for (const hl of hills) v = Math.max(v, hillHeight(hl, x, z));
    return v;
  };
  return { hills, lift: plan.lift, height, cell: (x, y) => height(x + 0.5, y + 0.5) };
}

/** The flat world, for code that runs without a park (tests, tools). */
export const FLAT: Terrain = { hills: [], lift: 0, height: () => 0, cell: () => 0 };

/**
 * Hills as clay mounds over the board: a height field, grass on top (keeping the
 * board's checker) with earthy slopes, so they read as part of the ground.
 */
export function hillGeo(t: Terrain, base: number, grass: [Col, Col], earth: Col, seed: number): Geo {
  const g = new Geo();
  const S = 0.1;
  const r = rng(seed);
  for (const hl of t.hills) {
    const ax = hl.x0 - FALL - 0.05;
    const bx = hl.x1 + 1 + FALL + 0.05;
    const az = hl.y0 - FALL - 0.05;
    const bz = hl.y1 + 1 + FALL + 0.05;
    const nx = Math.ceil((bx - ax) / S);
    const nz = Math.ceil((bz - az) / S);
    const P = (i: number, j: number) => {
      const x = ax + (i * (bx - ax)) / nx;
      const z = az + (j * (bz - az)) / nz;
      return v3(x, base + t.height(x, z) + 0.002, z);
    };
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = P(i, j);
        const b = P(i + 1, j);
        const c = P(i + 1, j + 1);
        const d = P(i, j + 1);
        const hi = Math.max(a.y, b.y, c.y, d.y) - base;
        if (hi < 0.004) continue;
        const cx = (a.x + c.x) / 2;
        const cz = (a.z + c.z) / 2;
        // Steep bits show earth; the flat top keeps the board's checker.
        const slope = (Math.max(a.y, b.y, c.y, d.y) - Math.min(a.y, b.y, c.y, d.y)) / S;
        const checker = (Math.floor(cx) + Math.floor(cz)) % 2 ? grass[0] : grass[1];
        const top = shade(checker, 0.04 + (r() - 0.5) * 0.03);
        const col = slope > 1.5 ? shade(earth, (r() - 0.5) * 0.06) : slope > 0.25 ? shade(checker, -0.05 - Math.min(0.12, slope * 0.08)) : top;
        g.quad(a, d, c, b, col, v3(cx, base - 1, cz));
      }
    // Clumps of grass and a few flowers on the slopes and the top.
    for (let k = 0; k < 10 + (hl.x1 - hl.x0 + 1) * (hl.y1 - hl.y0 + 1) * 6; k++) {
      const x = hl.x0 - 0.2 + r() * (hl.x1 - hl.x0 + 1.4);
      const z = hl.y0 - 0.2 + r() * (hl.y1 - hl.y0 + 1.4);
      const y = t.height(x, z);
      if (y < 0.03) continue;
      const checker = (Math.floor(x) + Math.floor(z)) % 2 ? grass[0] : grass[1];
      if (r() < 0.2) g.sphere(v3(x, base + y + 0.012, z), 0.018, ['#ff5d8a', '#ffd23f', '#fbf8f0'][Math.floor(r() * 3)], 1, 0.7, 1, 6, 4, true);
      else g.sphere(v3(x, base + y + 0.006, z), 0.03 + r() * 0.025, shade(checker, -0.1 - r() * 0.08), 1, 0.55, 1, 7, 4, true);
    }
  }
  return g;
}

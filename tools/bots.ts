// Bot policies for balancing and playtest metrics: random, greedy and smart (1-ply lookahead on a cloned game).
import { Game, RULES } from '../src/game';
import { DIRS, type Dir, cloneBoard, slide } from '../src/puzzle/board';
import { spun } from '../src/run/bossday';
import { Rng } from '../src/core/rng';

export type Action = { kind: 'swipe'; dir: Dir } | { kind: 'grow'; x: number; y: number } | { kind: 'close' };
export interface Policy {
  name: string;
  act(g: Game, rnd: () => number): Action;
}

/** A deep copy of a game (class instances keep their prototypes), for lookahead. */
export function cloneGame(g: Game): Game {
  const seen = new Map<unknown, unknown>();
  const copy = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    if (Array.isArray(v)) {
      const a: unknown[] = [];
      seen.set(v, a);
      for (const x of v) a.push(copy(x));
      return a;
    }
    if (v instanceof Map) { const m = new Map(); seen.set(v, m); for (const [k, x] of v) m.set(k, copy(x)); return m; }
    if (v instanceof Set) { const s = new Set(); seen.set(v, s); for (const x of v) s.add(copy(x)); return s; }
    const o = Object.create(Object.getPrototypeOf(v));
    seen.set(v, o);
    for (const k of Object.keys(v)) o[k] = copy((v as Record<string, unknown>)[k]);
    return o;
  };
  const c = copy(g) as Game;
  c.events = [];
  (c as unknown as { history: unknown[] }).history = [];
  return c;
}

export function apply(g: Game, a: Action): void {
  if (a.kind === 'swipe') g.swipe(a.dir);
  else if (a.kind === 'grow') g.tap(a.x, a.y);
  else g.open('circuit');
}

const realDir = (g: Game, d: Dir) => (g.fight && g.bossRule === 'spin' ? spun(d, g.fight.spin) : d);
const moves = (g: Game) => DIRS.filter((d) => slide(cloneBoard(g.board), realDir(g, d)).moved);
const affordable = (g: Game) => g.growCells.filter((c) => { const k = g.growCost(c.x, c.y); return k !== null && k <= g.banked; });
export const sureOf = (g: Game) => (RULES.score === 'ride' ? 0 : g.banked) + g.projected('circuit');
const bossOk = (g: Game) => { const boss = g.fight ? g.queue.find((r) => r.boss) : undefined; return !boss || g.pukes(boss, 'circuit') >= g.fight!.hp; };

export const randomBot: Policy = {
  name: 'random',
  act(g, rnd) {
    const sure = sureOf(g);
    if ((sure >= g.cfg.target && bossOk(g) && rnd() < 0.05) || g.actions > 300) return { kind: 'close' };
    const buys = affordable(g);
    const ms = moves(g);
    if (buys.length && (rnd() < 0.4 || !ms.length)) { const c = buys[Math.floor(rnd() * buys.length)]; return { kind: 'grow', ...c }; }
    if (ms.length) return { kind: 'swipe', dir: ms[Math.floor(rnd() * ms.length)] };
    return { kind: 'close' };
  },
};

/** The old season bot: buy a juicy tile when affordable, else the most-merging swipe. */
export function greedyBot(greed = 12): Policy {
  return {
    name: 'greedy',
    act(g, rnd) {
      const b = g.board;
      const sure = sureOf(g);
      const ok = bossOk(g);
      if ((ok && sure >= g.cfg.target * (1 + greed / 20)) || (g.room <= 2 && sure >= g.cfg.target) || g.actions > 300) return { kind: 'close' };
      let grow: { x: number; y: number; v: number } | null = null;
      for (const c of affordable(g)) {
        const v = b.tiles[c.y * b.size + c.x] + rnd() * 0.5;
        if (!grow || v > grow.v) grow = { ...c, v };
      }
      if (grow && grow.v >= 2.2) return { kind: 'grow', x: grow.x, y: grow.y };
      let best: Dir | null = null;
      let bestScore = -Infinity;
      for (const d of DIRS) {
        const r = slide(cloneBoard(b), realDir(g, d));
        if (!r.moved) continue;
        const score = r.merges.length * 1.5 + r.merges.reduce((a, m) => a + m.tier, 0) * 0.3 + rnd();
        if (score > bestScore) { bestScore = score; best = d; }
      }
      if (best) return { kind: 'swipe', dir: best };
      if (grow) return { kind: 'grow', x: grow.x, y: grow.y };
      return { kind: 'close' };
    },
  };
}

/** How good a position is: money now, income to come, and what closing would pay. */
function value(g: Game): number {
  if (g.phase !== 'build') return (g.result?.dayTotal ?? 0) * (g.result?.passed ? 1 : 0.3);
  const horizon = Math.min(40, 4 + g.room * 3);
  const close = g.projected('circuit');
  const bossBonus = g.fight ? (bossOk(g) ? g.cfg.target : -g.cfg.target * 0.5) : 0;
  const w = RULES.score === 'ride' ? 0.35 : 1;
  // Few free cells risk a jam.
  const jamRisk = RULES.jamPay < 1 && g.room <= 2 ? (1 - RULES.jamPay) * close * (3 - g.room) * 0.25 : 0;
  return w * (g.banked + g.rate * horizon) + close + bossBonus - jamRisk;
}

/** One-ply lookahead over every swipe and affordable grow (evaluated on a clone with a scrambled rng). */
export function smartBot(margin = 0.4): Policy {
  return {
    name: 'smart',
    act(g, rnd) {
      const sure = sureOf(g);
      if (g.actions > 300) return { kind: 'close' };
      const cands: Action[] = [...moves(g).map((dir) => ({ kind: 'swipe', dir }) as Action), ...affordable(g).map((c) => ({ kind: 'grow', ...c }) as Action)];
      if (!cands.length) return { kind: 'close' };
      let best: Action = cands[0];
      let bestV = -Infinity;
      for (const a of cands) {
        let v = 0;
        const samples = 1;
        for (let s = 0; s < samples; s++) {
          const c = cloneGame(g);
          c.rng = new Rng((g.rng.state ^ Math.floor(rnd() * 2 ** 31)) >>> 0);
          apply(c, a);
          v += value(c) / samples;
        }
        if (v > bestV) { bestV = v; best = a; }
      }
      // Close once the target is safe and the ride has stopped getting better fast enough.
      const ok = bossOk(g);
      if (ok && sure >= g.cfg.target * (1 + margin) && (g.room <= 3 || bestV < value(g) * 1.01)) return { kind: 'close' };
      if (ok && g.room <= 1 && sure >= g.cfg.target) return { kind: 'close' };
      return best;
    },
  };
}

/** The strategy-search winner: buy cheap pieces early, then hold out for bigger ones as the ride grows; play the day out. */
export function tunedBot(minTier = 2, rise = 4, fullAt = 2): Policy {
  return {
    name: 'tuned',
    act(g, rnd) {
      if (g.actions > 300) return { kind: 'close' };
      const b = g.board;
      const tile = (c: { x: number; y: number }) => b.tiles[c.y * b.size + c.x];
      const best = affordable(g).sort((u, v) => tile(v) - tile(u))[0];
      const need = minTier + Math.floor(b.ends[0].length / rise);
      if (best && (tile(best) >= need || g.room <= fullAt)) return { kind: 'grow', ...best };
      let bd: Dir | null = null;
      let bs = -Infinity;
      for (const d of moves(g)) {
        const r = slide(cloneBoard(b), realDir(g, d));
        const v = r.merges.length * 2 + r.merges.reduce((a, m) => a + m.tier, 0) * 0.5 + rnd() * 0.3;
        if (v > bs) { bs = v; bd = d; }
      }
      if (bd) return { kind: 'swipe', dir: bd };
      return best ? { kind: 'grow', ...best } : { kind: 'close' };
    },
  };
}

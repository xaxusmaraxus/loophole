// Skill-gap bench: every policy plays day 1 on the same seeds trying to score as much as it can
// (no target), so the score ratio between policies shows how much skill pays. Also pacing.
// Run: RULES='{"score":"ride"}' SEEDS=30 npx vite-node tools/bench.ts
import { Game, RULES } from '../src/game';
import { DIRS, cloneBoard, slide } from '../src/puzzle/board';
import { type Action, apply, cloneGame } from './bots';
import { Rng } from '../src/core/rng';
Object.assign(RULES, JSON.parse(process.env.RULES ?? '{}'));
const DAY = Number(process.env.DAY ?? 1);

type Pol = (g: Game, rnd: () => number) => Action;
const swipes = (g: Game) => DIRS.filter((d) => slide(cloneBoard(g.board), d).moved);
const buys = (g: Game) => g.growCells.filter((c) => (g.growCost(c.x, c.y) ?? 1e18) <= g.banked);
const score = (g: Game) => (RULES.score === 'ride' ? 0 : g.banked) + g.projected('circuit') * (g.jammed ? RULES.jamPay : 1);

const random: Pol = (g, rnd) => {
  if (g.actions > 15 && rnd() < 0.03) return { kind: 'close' };
  const b = buys(g), s = swipes(g);
  if (b.length && (rnd() < 0.4 || !s.length)) return { kind: 'grow', ...b[Math.floor(rnd() * b.length)] };
  if (s.length) return { kind: 'swipe', dir: s[Math.floor(rnd() * s.length)] };
  return { kind: 'close' };
};
const greedy: Pol = (g, rnd) => {
  if (g.room <= 2 && RULES.jamPay < 1) return { kind: 'close' };
  const b = buys(g);
  if (b.length) { let best = b[0]; for (const c of b) if (g.board.tiles[c.y * g.board.size + c.x] > g.board.tiles[best.y * g.board.size + best.x]) best = c; return { kind: 'grow', ...best }; }
  let bd = null as null | typeof DIRS[number], bs = -1;
  for (const d of swipes(g)) { const r = slide(cloneBoard(g.board), d); const v = r.merges.length + rnd() * 0.5; if (v > bs) { bs = v; bd = d; } }
  return bd ? { kind: 'swipe', dir: bd } : { kind: 'close' };
};
function val(g: Game): number {
  const horizon = Math.min(30, 3 + g.room * 3);
  const w = RULES.score === 'ride' ? 0.3 : 1;
  const close = g.projected('circuit');
  const risk = RULES.jamPay < 1 && g.room <= 2 ? (1 - RULES.jamPay) * close * (3 - g.room) * 0.3 : 0;
  return w * (g.banked + g.rate * horizon) + close - risk;
}
const smart: Pol = (g, rnd) => {
  const cands: Action[] = [...swipes(g).map((dir) => ({ kind: 'swipe', dir }) as Action), ...buys(g).map((c) => ({ kind: 'grow', ...c }) as Action)];
  if (!cands.length) return { kind: 'close' };
  let best = cands[0], bv = -Infinity;
  for (const a of cands) {
    let v = 0;
    for (let k = 0; k < 2; k++) {
      const c = cloneGame(g);
      c.rng = new Rng((g.rng.state ^ Math.floor(rnd() * 2 ** 31)) >>> 0);
      apply(c, a);
      v += (c.phase === 'build' ? val(c) : score(c)) / 2;
    }
    if (v > bv) { bv = v; best = a; }
  }
  // Stop when closing now beats the best move's expected outlook (or the board's nearly full under jam rules).
  if (RULES.jamPay < 1 && g.room <= 1) return { kind: 'close' };
  // Wait while there's room to grow; once nothing can be bought for a while and the board is full, close.
  if (g.room <= 0 && !buys(g).length) return { kind: 'close' };
  return best;
};

const seeds = Number(process.env.SEEDS ?? 20);
const pols: Record<string, Pol> = { random, greedy, smart };
const res: Record<string, { s: number[]; moves: number[]; grows: number[]; jams: number; len: number[]; pat: number[] }> = {};
for (const n of Object.keys(pols)) res[n] = { s: [], moves: [], grows: [], jams: 0, len: [], pat: [] };
for (let i = 0; i < seeds; i++) {
  for (const [n, p] of Object.entries(pols)) {
    let sd = 99 + i * 17;
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const g = new Game('D' + i);
    g.beginPark();
    // Jump to day DAY by passing the earlier days instantly.
    g.chooseNode(0, 0);
    for (let d = 1; d < DAY; d++) {
      g.cfg.target = 0; g.open('circuit'); g.rideDone(); g.continueFromResults();
      if (g.phase === 'reward') g.chooseReward(0);
      if (g.phase === 'map') { const col = (g.mapPos?.col ?? -1) + 1; const k = g.parkMap[col].findIndex((x: { kind: string }) => x.kind === 'day'); g.chooseNode(col, Math.max(0, k)); }
    }
    let grows = 0;
    for (let k = 0; k < 400 && g.phase === 'build'; k++) {
      const a = p(g, rnd);
      const L = g.board.ends[0].length;
      apply(g, a);
      if (g.board.ends[0].length > L) grows++;
      g.events.length = 0;
      if (a.kind === 'close') break;
    }
    if (g.phase === 'build') g.open('circuit');
    const r = g.result!;
    const R = res[n];
    R.s.push(r.dayTotal); R.moves.push(g.actions); R.grows.push(grows); R.len.push(g.board.ends[0].length); R.pat.push(r.grade.patterns.length);
    if (g.jammed) R.jams++;
  }
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const cv = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2))) / mean(a);
console.log(`RULES ${JSON.stringify(RULES)} day ${DAY} seeds ${seeds}`);
for (const [n, R] of Object.entries(res))
  console.log(`  ${n.padEnd(7)} score med ${med(R.s)} mean ${Math.round(mean(R.s))} cv ${cv(R.s).toFixed(2)}  moves med ${med(R.moves)}  grows ${med(R.grows)}  len ${med(R.len)}  patterns ${med(R.pat)}  jams ${R.jams}`);
console.log(`  skill gap: smart/random ${(mean(res.smart.s) / mean(res.random.s)).toFixed(2)}  smart/greedy ${(mean(res.smart.s) / mean(res.greedy.s)).toFixed(2)}  greedy/random ${(mean(res.greedy.s) / mean(res.random.s)).toFixed(2)}`);

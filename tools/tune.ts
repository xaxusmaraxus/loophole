// Strategy search: a family of parameterised policies plays day DAY on fixed seeds; the best
// parameter set stands in for a skilled player. Reports best vs random vs worst (how much decisions matter).
// Run: RULES='{"score":"ride"}' SEEDS=16 DAY=1 npx vite-node tools/tune.ts
import { Game, RULES } from '../src/game';
import { DIRS, cloneBoard, slide } from '../src/puzzle/board';
import { type Action, apply } from './bots';
Object.assign(RULES, JSON.parse(process.env.RULES ?? '{}'));
const DAY = Number(process.env.DAY ?? 1);
const SEEDS = Number(process.env.SEEDS ?? 16);

interface P { minTier: number; fullAt: number; closeRoom: number; corner: number; rise: number }
const swipes = (g: Game) => DIRS.filter((d) => slide(cloneBoard(g.board), d).moved);
const buys = (g: Game) => g.growCells.filter((c) => (g.growCost(c.x, c.y) ?? 1e18) <= g.banked);
const tileAt = (g: Game, c: { x: number; y: number }) => g.board.tiles[c.y * g.board.size + c.x];

function policy(p: P | null): (g: Game, rnd: () => number) => Action {
  return (g, rnd) => {
    if (!p) {
      if (g.actions > 15 && rnd() < 0.03) return { kind: 'close' };
      const b = buys(g), s = swipes(g);
      if (b.length && (rnd() < 0.4 || !s.length)) return { kind: 'grow', ...b[Math.floor(rnd() * b.length)] };
      return s.length ? { kind: 'swipe', dir: s[Math.floor(rnd() * s.length)] } : { kind: 'close' };
    }
    if (g.room <= p.closeRoom) return { kind: 'close' };
    const b = buys(g);
    const best = b.sort((u, v) => tileAt(g, v) - tileAt(g, u))[0];
    // Buy a tile of minTier or better; once the board's tight (room ≤ fullAt), buy the best on offer.
    const need = p.minTier + (p.rise ? Math.floor(g.board.ends[0].length / p.rise) : 0);
    if (best && (tileAt(g, best) >= need || g.room <= p.fullAt)) return { kind: 'grow', ...best };
    let bd = null as null | (typeof DIRS)[number], bs = -Infinity;
    for (const d of swipes(g)) {
      const c = cloneBoard(g.board);
      const r = slide(c, d);
      // Merges, plus (corner) keep the biggest tile next to the loop where it can be bought.
      let v = r.merges.length * 2 + r.merges.reduce((a, m) => a + m.tier, 0) * 0.5 + rnd() * 0.3;
      if (p.corner) { const g2 = g.growCells; v += p.corner * Math.max(0, ...g2.map((q) => c.tiles[q.y * c.size + q.x] ?? 0)); }
      if (v > bs) { bs = v; bd = d; }
    }
    if (bd) return { kind: 'swipe', dir: bd };
    return best ? { kind: 'grow', ...best } : { kind: 'close' };
  };
}

function play(seed: number, pol: ReturnType<typeof policy>): { score: number; moves: number; jam: boolean; len: number; grows: number; gap: number } {
  let sd = 99 + seed * 17;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const g = new Game('D' + seed);
  g.beginPark();
  g.chooseNode(0, 0);
  for (let d = 1; d < DAY; d++) {
    g.cfg.target = 0; g.open('circuit'); g.rideDone(); g.continueFromResults();
    if (g.phase === 'reward') g.chooseReward(0);
    if (g.phase === 'map') { const col = (g.mapPos?.col ?? -1) + 1; const k = g.parkMap[col].findIndex((x: { kind: string }) => x.kind === 'day'); g.chooseNode(col, Math.max(0, k)); }
  }
  let grows = 0, last = 0, gap = 0;
  for (let k = 0; k < 300 && g.phase === 'build'; k++) {
    const a = pol(g, rnd); const L = g.board.ends[0].length; apply(g, a); g.events.length = 0;
    if (g.board.ends[0].length > L) { grows++; gap = Math.max(gap, g.actions - last); last = g.actions; }
    if (a.kind === 'close') break;
  }
  if (g.phase === 'build') g.open('circuit');
  return { score: g.result!.dayTotal, moves: g.actions, jam: g.jammed, len: g.board.ends[0].length, grows, gap };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
function evalP(p: P | null) {
  const rs = [...Array(SEEDS).keys()].map((i) => play(i, policy(p)));
  return { p, score: mean(rs.map((r) => r.score)), moves: mean(rs.map((r) => r.moves)), jams: rs.filter((r) => r.jam).length, len: mean(rs.map((r) => r.len)), grows: mean(rs.map((r) => r.grows)), gap: mean(rs.map((r) => r.gap)) };
}
const grid: P[] = [];
for (const minTier of [1, 2, 3, 4, 5]) for (const fullAt of [-1, 2, 4]) for (const closeRoom of [-1, 0, 2]) for (const rise of [0, 4, 8]) grid.push({ minTier, fullAt, closeRoom, corner: 0, rise });
const results = grid.map(evalP).sort((a, b) => b.score - a.score);
const rnd = evalP(null);
const fmt = (r: ReturnType<typeof evalP>) => `score ${Math.round(r.score)} moves ${r.moves.toFixed(0)} grows ${r.grows.toFixed(1)} maxgap ${r.gap.toFixed(0)} len ${r.len.toFixed(0)} jams ${r.jams}/${SEEDS} ${JSON.stringify(r.p)}`;
console.log(`RULES ${JSON.stringify(RULES)} day ${DAY}`);
console.log('  best   ', fmt(results[0]));
console.log('  2nd    ', fmt(results[1]));
console.log('  median ', fmt(results[Math.floor(results.length / 2)]));
console.log('  worst  ', fmt(results[results.length - 1]));
console.log('  random ', fmt(rnd));
console.log(`  skill: best/random ${(results[0].score / rnd.score).toFixed(2)}  best/median ${(results[0].score / results[Math.floor(results.length / 2)].score).toFixed(2)}`);

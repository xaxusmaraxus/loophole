// Balancing bot: plays many seeded seasons with a simple strategy and prints
// score percentiles per day against the targets. It never builds for bosses on
// purpose, so treat its numbers as a floor, not as what a player can do.
// Run: npx vite-node tools/season-bot.ts
import { Game } from '../src/game';
import { DIRS, type Dir, canConnect, cloneBoard, head, slide } from '../src/puzzle/board';
import { spun } from '../src/run/bossday';

/**
 * The always-running ride: grow the loop into a juicy tile when there's one
 * (a Hill or better), else make the best merge; close the park once today's
 * tickets clear the target with room to spare, or when the board gets tight.
 */
function playDay(g: Game, rnd: () => number, greed: number) {
  let guard = 0;
  while (g.phase === 'build' && guard++ < 400) {
    const b = g.board;
    const sure = g.banked + g.projected('circuit');
    if (sure >= g.cfg.target * (1 + greed / 20) || (g.room <= 2 && sure >= g.cfg.target) || guard > 300) { g.open('circuit'); break; }
    // Grow: the best bulge by the tiles it takes in.
    let grow: { x: number; y: number; v: number } | null = null;
    for (const c of g.growCells) {
      const v = b.tiles[c.y * b.size + c.x] + rnd() * 0.5;
      if (!grow || v > grow.v) grow = { ...c, v };
    }
    if (grow && grow.v >= 2.2) { g.tap(grow.x, grow.y); continue; }
    let best: Dir | null = null;
    let bestScore = -Infinity;
    for (const d of DIRS) {
      const c = cloneBoard(b);
      const r = slide(c, g.fight && g.bossRule === 'spin' ? spun(d, g.fight.spin) : d);
      if (!r.moved) continue;
      const score = r.merges.length * 1.5 + r.merges.reduce((a, m) => a + m.tier, 0) * 0.3 + rnd();
      if (score > bestScore) { bestScore = score; best = d; }
    }
    if (best) g.swipe(best);
    else if (grow) g.tap(grow.x, grow.y);
    else { g.open('circuit'); break; }
  }
  if (g.phase === 'build') g.open();
  g.events.length = 0;
  if (g.phase === 'ride') g.rideDone();
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const perDay: Record<number, number[]> = {};
const targets: Record<number, number> = {};
let wins = 0, reached: number[] = []; let bossFails = 0, bossDays = 0; const rounds: Record<number, number> = {}; const perBoss: Record<string, number[]> = {};
for (let run = 0; run < 200; run++) {
  const g = new Game('B' + run);
  const greed = 8 + Math.floor(rnd() * 14);
  let guard = 0;
  while (guard++ < 60) {
    if (g.phase === 'intro') g.beginPark();
    if (g.phase === 'map') {
      const col = (g.mapPos?.col ?? -1) + 1;
      g.chooseNode(col, Math.floor(rnd() * g.parkMap[col].length));
      continue;
    }
    if (g.phase === 'shop') { g.buy(0); g.buy(1); g.leaveShop(); continue; }
    if (g.phase === 'egg') { g.crackEgg(); g.takeFromEgg(0); if (g.phase === 'egg') g.closeEgg(); continue; }
    if (g.phase === 'conquered') { g.chooseReward(0); continue; }
    if (g.phase === 'reward') { const a = g.offer.findIndex((o) => o.kind === 'attraction'); a >= 0 && g.slotsFree ? g.chooseReward(a) : g.chooseReward(0); continue; }
    if (g.phase === 'build') {
      playDay(g, rnd, greed);
      const r = g.result!;
      (perDay[g.dayNum] ??= []).push(r.total);
      if (g.cfg.boss && !r.again) { bossDays++; if (!r.bossPuked) bossFails++; rounds[r.round] = (rounds[r.round] ?? 0) + (r.passed ? 1 : 0); const pb = (perBoss[g.cfg.boss] ??= [0, 0, 0]); pb[0]++; if (r.bossPuked) pb[1]++; if (r.passed) pb[2]++; }
      targets[g.dayNum] = g.cfg.node === 'boss' ? targets[g.dayNum] ?? r.target : r.target;
      g.continueFromResults();
      if (g.phase === 'won') { wins++; break; }
      if (g.phase === 'over') break;
      continue;
    }
    break;
  }
  reached.push(g.dayNum);
}
for (const [d, arr] of Object.entries(perDay)) {
  arr.sort((a, b) => a - b);
  const q = (p: number) => arr[Math.floor(p * (arr.length - 1))];
  console.log(`day ${d}: target~${targets[+d]}  n=${arr.length}  p25 ${q(0.25)}  median ${q(0.5)}  p75 ${q(0.75)}  p90 ${q(0.9)}`);
}
reached.sort((a, b) => a - b);
console.log('boss days won on ride', JSON.stringify(rounds));
console.log('per boss [days, broken, cleared]', JSON.stringify(perBoss));
console.log('wins', wins, 'median day reached', reached[Math.floor(reached.length / 2)], 'boss fails', bossFails, 'of', bossDays);

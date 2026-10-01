// Balancing bot: plays many seeded seasons with a simple strategy and prints
// score percentiles per day against the targets. It never builds for bosses on
// purpose, so treat its numbers as a floor, not as what a player can do.
// Run: npx vite-node tools/season-bot.ts
import { Game } from '../src/game';
import { DIRS, type Dir, canConnect, cloneBoard, head, slide } from '../src/puzzle/board';
import { spun } from '../src/run/bossday';

/**
 * Snake-style: try each swipe on a copy, prefer ones that feed big pieces into
 * the track, merge, and keep the two ends close; cash out once the ride is
 * long enough or the board gets crowded.
 */
function playDay(g: Game, rnd: () => number, greed: number) {
  let guard = 0;
  while (g.phase === 'build' && guard++ < 400) {
    const b = g.board;
    const len = b.ends[0].length + b.ends[1].length;
    if (canConnect(b) && (len >= greed || g.room <= 4)) { g.open('circuit'); break; }
    let best: Dir | null = null;
    let bestScore = -Infinity;
    for (const d of DIRS) {
      const c = cloneBoard(b);
      // Dr. Vertigo turns the controls: simulate where the swipe really goes.
      const r = slide(c, g.fight && g.bossRule === 'spin' ? spun(d, g.fight.spin) : d);
      if (!r.moved) continue;
      const fed = r.eaten.reduce((a, e) => a + e.cell.tier, 0);
      const [h0, h1] = [head(c, 0), head(c, 1)];
      const gap = Math.abs(h0.x - h1.x) + Math.abs(h0.y - h1.y);
      const closing = len >= greed * 0.6 ? -gap * 2 : 0;
      const score = fed * (len < greed ? 1.5 : 0.5) + r.merges.length * 1.2 + closing + rnd() * 1.5;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    if (!best) { g.open(); break; }
    g.swipe(best);
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

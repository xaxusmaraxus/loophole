// Playtest metrics: plays seeded seasons with several bot policies and reports
// pacing (moves and buys per day), skill gap (how much better play pays), near
// misses, grades and win rates. Run: RUNS=20 npx vite-node tools/metrics.ts [random,greedy,smart]
import { Game, RULES } from '../src/game';
Object.assign(RULES, JSON.parse(process.env.RULES ?? '{}'));
const TARGET_MULT = Number(process.env.TARGET_MULT ?? 1);
import { type Policy, apply, greedyBot, randomBot, smartBot, tunedBot } from './bots';

interface DayLog { total: number; target: number; day: number; boss: boolean; moves: number; grows: number; firstGrow: number; maxGap: number; ratio: number; passed: boolean; bossFail: boolean; grade: string; patterns: number; roar: number; len: number; gridlock: boolean; choices: number }

function playSeason(seed: string, policy: Policy, rndSeed: number): { days: DayLog[]; won: boolean; reached: number } {
  let s = rndSeed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = new Game(seed);
  const days: DayLog[] = [];
  for (let guard = 0; guard < 80; guard++) {
    if (g.phase === 'intro') g.beginPark();
    else if (g.phase === 'map') { const col = (g.mapPos?.col ?? -1) + 1; g.chooseNode(col, Math.floor(rnd() * g.parkMap[col].length)); }
    else if (g.phase === 'shop') { g.buy(0); g.buy(1); g.leaveShop(); }
    else if (g.phase === 'egg') { g.crackEgg(); g.takeFromEgg(0); if (g.phase === 'egg') g.closeEgg(); }
    else if (g.phase === 'conquered') g.chooseReward(0);
    else if (g.phase === 'reward') { const a = g.offer.findIndex((o) => o.kind === 'attraction'); a >= 0 && g.slotsFree ? g.chooseReward(a) : g.chooseReward(0); }
    else if (g.phase === 'build') {
      g.cfg.target = Math.round(g.cfg.target * TARGET_MULT);
      let grows = 0, firstGrow = -1, lastGrow = 0, maxGap = 0, choiceSum = 0, steps = 0;
      while (g.phase === 'build' && steps++ < 400) {
        const a = policy.act(g, rnd);
        choiceSum += g.growCells.filter((c) => (g.growCost(c.x, c.y) ?? 1e18) <= g.banked).length + 1;
        if (a.kind === 'grow') { const before = g.board.ends[0].length; apply(g, a); if (g.board.ends[0].length > before) { grows++; if (firstGrow < 0) firstGrow = g.actions; maxGap = Math.max(maxGap, g.actions - lastGrow); lastGrow = g.actions; } }
        else apply(g, a);
        g.events.length = 0;
        if (a.kind === 'close') break;
      }
      const gridlock = g.jammed;
      if (g.phase === 'build') g.open('circuit');
      if (g.phase === 'ride') g.rideDone();
      const r = g.result!;
      days.push({ total: r.dayTotal, target: r.target, day: g.dayNum, boss: !!g.cfg.boss, moves: g.actions, grows, firstGrow, maxGap: Math.max(maxGap, g.actions - lastGrow), ratio: r.dayTotal / Math.max(1, r.target), passed: r.passed, bossFail: !!g.cfg.boss && !r.bossPuked, grade: r.grade.letter, patterns: r.grade.patterns.length, roar: r.grade.bestRoar, len: g.board.ends[0].length, gridlock, choices: choiceSum / Math.max(1, steps) });
      g.continueFromResults();
      if (g.phase === 'won' || g.phase === 'over') break;
    } else break;
  }
  return { days, won: g.phase === 'won', reached: g.dayNum };
}

const q = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');

const runs = Number(process.env.RUNS ?? 20);
const names = (process.argv[2] ?? 'random,greedy,smart').split(',');
const all: Record<string, Policy> = { random: randomBot, greedy: greedyBot(), smart: smartBot(), tuned: tunedBot() };
for (const n of names) {
  const p = all[n];
  const days: DayLog[] = [];
  let wins = 0; const reached: number[] = [];
  const t0 = Date.now();
  for (let i = 0; i < runs; i++) { const r = playSeason('M' + i, p, 7 + i * 31); days.push(...r.days); if (r.won) wins++; reached.push(r.reached); }
  const d1 = days.filter((d) => d.day === 1);
  const normal = days.filter((d) => !d.boss);
  const bossD = days.filter((d) => d.boss);
  const grades: Record<string, number> = {};
  for (const d of days) grades[d.grade] = (grades[d.grade] ?? 0) + 1;
  const jams = days.filter((d) => d.gridlock).length;
  const near = days.filter((d) => !d.passed && d.ratio >= 0.75 && !d.bossFail).length;
  console.log(`== ${n} (${runs} seasons, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log(`  win ${wins}/${runs}  median day reached ${q(reached, 0.5)}  boss fail ${bossD.filter((d) => d.bossFail).length}/${bossD.length}  near-miss days ${near}  jams ${jams}/${days.length}`);
  console.log(`  moves/day p25 ${q(normal.map((d) => d.moves), 0.25)} med ${q(normal.map((d) => d.moves), 0.5)} p75 ${q(normal.map((d) => d.moves), 0.75)}   grows/day med ${q(normal.map((d) => d.grows), 0.5)}   first grow med ${q(normal.map((d) => d.firstGrow), 0.5)}   max gap med ${q(normal.map((d) => d.maxGap), 0.5)}`);
  console.log(`  day1 ratio med ${f(q(d1.map((d) => d.ratio), 0.5), 2)}  all-days ratio p25 ${f(q(normal.map((d) => d.ratio), 0.25), 2)} med ${f(q(normal.map((d) => d.ratio), 0.5), 2)}  pass ${normal.filter((d) => d.passed).length}/${normal.length}`);
  const per: string[] = [];
  for (let d = 1; d <= 10; d++) { const ds = days.filter((x) => x.day === d && !x.boss); if (ds.length) per.push(`d${d}:${Math.round(q(ds.map((x) => x.total), 0.5) / 1000)}k/${Math.round(ds[0].target / 1000)}k m${q(ds.map((x) => x.moves), 0.5)}`); }
  console.log('  per day (median total / target, moves): ' + per.join('  '));
  console.log(`  ride len med ${q(days.map((d) => d.len), 0.5)}  patterns med ${q(days.map((d) => d.patterns), 0.5)}  best roar med ${q(days.map((d) => d.roar), 0.5)}  choices/move ${f(days.reduce((a, d) => a + d.choices, 0) / days.length, 2)}  grades ${JSON.stringify(grades)}`);
}

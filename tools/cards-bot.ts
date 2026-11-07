// Coaster Cards balance: plays runs with random, greedy and lookahead policies and
// prints per-day scores (median) against targets, win rates and the skill gap.
// Run: RUNS=40 npx vite-node tools/cards-bot.ts
import { Rng } from '../src/core/rng';
import { type CardRun, DAYS, canMerge, dayOver, discardCard, endCardDay, mergeCards, newCardRun, playCard, rewardChoices, runOver, startCardDay, takeReward } from '../src/cards/cardgame';
import { cardPark, cardScore, layRide } from '../src/cards/cardpark';
import type { Game } from '../src/game';

type Act = { k: 'play'; i: number } | { k: 'merge'; i: number; j: number } | { k: 'discard'; i: number };
function acts(run: CardRun): Act[] {
  const out: Act[] = run.hand.map((_, i) => ({ k: 'play', i }) as Act);
  for (let i = 0; i < run.hand.length; i++) for (let j = i + 1; j < run.hand.length; j++) if (canMerge(run, i, j)) out.push({ k: 'merge', i, j });
  if (run.discards > 0) run.hand.forEach((_, i) => out.push({ k: 'discard', i }));
  return out;
}
function doAct(run: CardRun, a: Act) {
  if (a.k === 'play') playCard(run, a.i);
  else if (a.k === 'merge') mergeCards(run, a.i, a.j);
  else discardCard(run, a.i);
}
const clone = (r: CardRun): CardRun => JSON.parse(JSON.stringify(r));

type Pol = (run: CardRun, g: Game, rnd: () => number) => Act;
const random: Pol = (run, _g, rnd) => { const a = acts(run).filter((x) => x.k !== 'discard' || rnd() < 0.2); return a[Math.floor(rnd() * a.length)]; };
const greedy: Pol = (run) => {
  const a = acts(run);
  const m = a.filter((x) => x.k === 'merge').sort((u, v) => run.hand[(v as { i: number }).i] - run.hand[(u as { i: number }).i])[0];
  if (m) return m;
  let best = 0;
  run.hand.forEach((t, i) => { if (t > run.hand[best]) best = i; });
  return { k: 'play', i: best };
};
/** One-ply lookahead: the ride's score as if it ran now, plus what the hand could still add. */
const look: Pol = (run, g, rnd) => {
  let best: Act | null = null, bv = -Infinity;
  for (const a of acts(run)) {
    const r = clone(run);
    // A scrambled draw: don't peek at the real pile order.
    r.pile = r.pile.sort(() => rnd() - 0.5);
    doAct(r, a);
    layRide(g, r);
    const left = r.slots - r.ride.length;
    const handV = [...r.hand].sort((x, y) => y - x).slice(0, left).reduce((s, t) => s + t * t, 0);
    const v = cardScore(g) * (1 + 0.15 * handV / Math.max(1, left * 9)) + (a.k === 'discard' ? -2 : 0);
    if (v > bv) { bv = v; best = a; }
  }
  layRide(g, run);
  return best!;
};

const runs = Number(process.env.RUNS ?? 30);
for (const [name, pol] of Object.entries({ random, greedy, look })) {
  const per: number[][] = Array.from({ length: DAYS }, () => []);
  let wins = 0;
  const reached: number[] = [];
  for (let n = 0; n < runs; n++) {
    let s = 11 + n * 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const rng = new Rng(100 + n);
    const run = newCardRun();
    while (!runOver(run)) {
      startCardDay(run, rng);
      const g = cardPark(run, `B${n}`);
      for (let k = 0; k < 80 && !dayOver(run); k++) doAct(run, pol(run, g, rnd));
      layRide(g, run);
      const score = cardScore(g);
      per[run.day - 1].push(score);
      endCardDay(run, score);
      if (run.hearts <= 0) break;
      const ch = rewardChoices(run, rng);
      takeReward(run, ch[Math.floor(rnd() * ch.length)]);
    }
    if (run.hearts > 0) wins++;
    reached.push(Math.min(run.day, DAYS));
  }
  const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
  console.log(`${name.padEnd(7)} wins ${wins}/${runs}  median day ${med(reached)}  per-day median: ${per.map((a, d) => `d${d + 1}:${med(a)}`).join(' ')}`);
}

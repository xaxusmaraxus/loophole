// Text harness for playtesting by hand: replays a seed and a move list, then prints the state.
// Run: npx vite-node tools/play.ts SEED "l r u d t3,4 c n0 s"   (n<i>: map node, s: skip shop/rewards)
import { Game, RULES } from '../src/game';
Object.assign(RULES, JSON.parse(process.env.RULES ?? '{}'));
import { trackAt, idx } from '../src/puzzle/board';
import { PIECES } from '../src/puzzle/pieces';
import { PATTERNS } from '../src/puzzle/patterns';

const [seed = 'P1', script = ''] = process.argv.slice(2);
const g = new Game(seed);
const D = { l: 'left', r: 'right', u: 'up', d: 'down' } as const;
const log: string[] = [];
function auto() {
  // Step through non-build screens with simple defaults.
  for (let k = 0; k < 20; k++) {
    if (g.phase === 'intro') g.beginPark();
    else if (g.phase === 'ride') g.rideDone();
    else return;
  }
}
for (const tok of script.split(/\s+/).filter(Boolean)) {
  auto();
  const before = g.banked;
  if (tok in D) g.swipe(D[tok as keyof typeof D]);
  else if (tok[0] === 't') { const [x, y] = tok.slice(1).split(',').map(Number); g.tap(x, y); }
  else if (tok === 'c') g.open('circuit');
  else if (tok[0] === 'n') { const col = (g.mapPos?.col ?? -1) + 1; g.chooseNode(col, Number(tok.slice(1))); }
  else if (tok === 'g') g.continueFromResults();
  else if (tok[0] === 'w') g.chooseReward(Number(tok.slice(1)));
  else if (tok === 's') { if (g.phase === 'shop') g.leaveShop(); else if (g.phase === 'reward') g.skipReward(); }
  else if (tok[0] === 'b') g.buy(Number(tok.slice(1)));
  for (const e of g.events) {
    if (e.type === 'pattern') log.push(`  ${tok}: PATTERN ${PATTERNS[e.id].name}${e.fresh ? ' (new!)' : ''}`);
    if (e.type === 'roar' && e.lost >= 3) log.push(`  ${tok}: roar lost (${e.lost})`);
    if (e.type === 'broke') log.push(`  ${tok}: can't afford (${e.cost})`);
    if (e.type === 'blocked') log.push(`  ${tok}: blocked`);
  }
  g.events.length = 0;
  void before;
}
auto();
console.log(log.slice(-12).join('\n'));
console.log(`phase ${g.phase}  day ${g.dayNum}  node ${g.cfg?.node}  hearts ${g.hearts}  funds ${g.funds}`);
if (g.phase === 'build') {
  const b = g.board;
  const growSet = new Map(g.growCells.map((c) => [`${c.x},${c.y}`, g.growCost(c.x, c.y)]));
  const rows: string[] = ['    ' + [...Array(b.size).keys()].map((x) => ` ${x}  `).join('')];
  for (let y = 0; y < b.size; y++) {
    let r = ` ${y}  `;
    for (let x = 0; x < b.size; x++) {
      const i = idx(b, x, y);
      const t = trackAt(b, x, y);
      if (t) r += `[${t.tier}] `;
      else if (b.obstacles[i]) r += ' XX ';
      else if (b.tiles[i]) r += growSet.has(`${x},${y}`) ? ` ${b.tiles[i]}$ ` : `  ${b.tiles[i]} `;
      else r += '  . ';
    }
    rows.push(r);
  }
  rows.push(`    station at x=${b.station.x},${b.station.x + 1}`);
  console.log(rows.join('\n'));
  const order = g.rideCells().map((c) => c.tier).join(' ');
  console.log(`ride: ${order}`);
  console.log(`tide +${g.tide}  wallet ${g.banked}  target ${g.cfg.target}  hype ${g.hypeRate.toFixed(1)}/move × ${g.ticketPrice}  roar ${g.roar}  room ${g.room}  moves ${g.actions}`);
  const s = g.score('circuit');
  console.log(`rating ${s.rating} (chips ${g.stats.chips} × mult ${g.stats.mult})  closing now ≈ ${g.banked + g.projected('circuit')}  queue ${g.queue.length}`);
  console.log(`patterns: ${g.stats.patterns.map((p) => PATTERNS[p.id].name).join(', ') || '-'}`);
  console.log(`buy ($): ${[...growSet].map(([k, c]) => `${k}:${c}`).join('  ')}`);
  console.log(`tiers: ${PIECES.map((p, i) => `${i}=${p.name}`).join(' ')}`);
} else if (g.result) {
  const r = g.result;
  console.log(`result: total ${r.total} dayTotal ${r.dayTotal}/${r.target} passed ${r.passed} grade ${r.grade.letter} ${r.grade.tips.join(' | ')}`);
}
if (g.phase === 'map') console.log('map next col options:', g.parkMap[(g.mapPos?.col ?? -1) + 1]?.map((n: { kind: string }) => n.kind).join(','));
if (g.phase === 'reward') console.log('offer:', JSON.stringify(g.offer));
if (g.phase === 'shop') console.log('shop:', JSON.stringify(g.shop));

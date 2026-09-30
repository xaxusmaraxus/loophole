import { Rng, randomSeed } from './core/rng';
import {
  type Board,
  type Dir,
  type End,
  type Pt,
  type SwipeResult,
  type TrackCell,
  build,
  buildTargets,
  canConnect,
  canShuttle,
  cloneBoard,
  head,
  idx,
  isWall,
  resolveChains,
  rideOrder,
  step,
  swipe,
  trackCells,
} from './puzzle/board';
import { MAX_TIER, type RideStats, rideStats } from './puzzle/pieces';
import { type Rider, makeBoss, makeRider, makeVip, pieceNausea, pukesFor, riderWorth } from './riders/riders';
import { ATTRACTION_SLOTS, type OwnedAttraction, type Score, scoreRide } from './run/attractions';
import { type ScoreEvent, rideTimeline } from './run/timeline';
import {
  type BusRider,
  type DayConfig,
  EGGS,
  type EggItem,
  type EggKind,
  eggContents,
  type Mods,
  NODE_INFO,
  type NodeKind,
  type ParkMap,
  type Reward,
  SEASON_ORDER,
  type ShopItem,
  priceScale,
  TOOLS,
  type ToolId,
  type UpgradeId,
  dayConfig,
  generateBoard,
  generateParkMap,
  modsFor,
  rewardOffer,
  sellValue,
  shopStock,
} from './run/run';

export type Phase = 'intro' | 'map' | 'build' | 'ride' | 'results' | 'reward' | 'shop' | 'egg' | 'over' | 'won';
export type RideKind = 'circuit' | 'shuttle';

/** Why a rider joined the queue. */
export type ArrivalReason = 'walkin' | 'buzz' | 'chain';

export type GameEvent =
  | { type: 'day' }
  | { type: 'swipe'; result: SwipeResult }
  | { type: 'build'; laid: TrackCell; end: End }
  | { type: 'blocked' }
  | { type: 'arrive'; rider: Rider; reason: ArrivalReason }
  | { type: 'open'; kind: RideKind }
  | { type: 'dark' }
  | { type: 'tool'; tool: ToolId; at?: Pt }
  | { type: 'undo' };

export interface RiderTicket {
  rider: Rider;
  pukes: number;
  paid: number;
}

export interface DayResult {
  kind: RideKind;
  stats: RideStats;
  /** Excitement × multiplier, with each attraction's step, for the report. */
  score: Score;
  tickets: RiderTicket[];
  total: number;
  target: number;
  /** The boss (if any) puked at least once. */
  bossPuked: boolean;
  passed: boolean;
  /** The score as it builds up during the ride: sums exactly to `total`. */
  timeline: ScoreEvent[];
}

interface Snapshot {
  board: Board;
  queue: Rider[];
  daylight: number;
  actions: number;
  buzz: number;
  bestCombo: number;
  chainLinks: number;
  selected: End;
  tools: Record<ToolId, number>;
  rngState: number;
  nextId: number;
}

const HEARTS = 3;
const BEST_KEY = 'loophole.bestScore';
/** A walk-in rider arrives every this many swipes. */
const WALKIN_EVERY = 5;
/**
 * The standing ride draws a crowd over time: each swipe adds (base excitement / BUZZ_PER)
 * to a meter, and every full point brings a rider. Building early pays off in riders.
 */
const BUZZ_PER = 40;

export class Game {
  seed = '';
  rng = new Rng(0);
  dayNum = 1;
  hearts = HEARTS;
  runScore = 0;
  upgrades: UpgradeId[] = [];
  attractions: OwnedAttraction[] = [];
  /** Tool charges carried through the run. */
  tools: Record<ToolId, number> = emptyTools();
  /** A tool waiting for its target tap (the crane remembers its first pick). */
  aiming: { tool: ToolId; first?: Pt } | null = null;
  mods: Mods = modsFor([]);
  cfg!: DayConfig;
  board!: Board;
  queue: Rider[] = [];
  daylight = 0;
  actions = 0;
  bestCombo = 0;
  /** Chain links set off today (Chain Gang counts these). */
  chainLinks = 0;
  /** The track end that keyboard builds extend. */
  selected: End = 0;
  undos = 0;
  phase: Phase = 'intro';
  result: DayResult | null = null;
  offer: Reward[] = [];
  /** Park funds: tickets sold beyond each day's target, spent in the shop. */
  funds = 0;
  shop: ShopItem[] = [];
  /** Index into SEASON_ORDER. */
  parkIndex = 0;
  parkMap: ParkMap = [];
  /** Where you are on the current park's map (null before the first node). */
  mapPos: { col: number; node: number } | null = null;
  /** Nodes already visited in this park, in order. */
  visited: { col: number; node: number }[] = [];
  /** Rider types from bus tours: one of each joins the line every morning. */
  crowd: BusRider[] = [];
  /** The capsule egg being opened, if any. */
  egg: { kind: EggKind; items: EggItem[]; picksLeft: number; cracked: boolean; returnTo: 'shop' | 'map' } | null = null;
  /** A one-line message for the map screen (e.g. what a repair stop did). */
  notice: string | null = null;
  best = loadBest();
  events: GameEvent[] = [];
  private rewardFrom: 'day' | 'treasure' = 'day';
  private buzz = 0;
  private nextId = 1;
  private history: Snapshot[] = [];

  constructor(seed = randomSeed()) {
    this.newRun(seed);
  }

  newRun(seed = randomSeed()): void {
    this.seed = seed;
    this.rng = Rng.fromSeed(seed);
    this.dayNum = 1;
    this.hearts = HEARTS;
    this.runScore = 0;
    this.upgrades = [];
    this.attractions = [];
    this.crowd = [];
    this.egg = null;
    this.funds = 0;
    this.tools = { ...emptyTools(), paint: 1 };
    this.mods = modsFor([]);
    this.enterPark(0);
  }

  // ---- Season and map ------------------------------------------------------

  get node(): NodeKind {
    return this.cfg.node;
  }

  /** Nodes on the map you may pick next. */
  isReachable(col: number): boolean {
    return this.phase === 'map' && col === (this.mapPos?.col ?? -1) + 1;
  }

  private enterPark(index: number): void {
    this.parkIndex = index;
    this.parkMap = generateParkMap(SEASON_ORDER[index], this.rng);
    this.mapPos = null;
    this.visited = [];
    this.notice = null;
    // Show the new park behind its intro card.
    this.startDay(this.parkMap[0][0].kind);
    this.phase = 'intro';
  }

  /** Dismiss the park intro card and go to the map (the finale starts right away). */
  beginPark(): void {
    if (this.phase !== 'intro') return;
    if (SEASON_ORDER[this.parkIndex] === 'finale') {
      this.mapPos = { col: 0, node: 0 };
      this.startDay('finale');
    } else this.phase = 'map';
  }

  chooseNode(col: number, node: number): void {
    const n = this.parkMap[col]?.[node];
    if (!n || !this.isReachable(col)) return;
    this.mapPos = { col, node };
    this.visited.push({ col, node });
    this.notice = null;
    if (NODE_INFO[n.kind].isDay) {
      this.startDay(n.kind);
      return;
    }
    if (n.kind === 'shop') {
      this.shop = shopStock(this.rng, this.dayNum, this.attractions.map((a) => a.id));
      this.phase = 'shop';
    } else if (n.kind === 'repair') {
      if (this.hearts < HEARTS) {
        this.hearts++;
        this.notice = 'The mechanics patched things up: +1 heart.';
      } else {
        const bonus = Math.round((100 * priceScale(this.dayNum)) / 10) * 10;
        this.funds += bonus;
        this.notice = `Hearts were already full, so the repair crew handed over ${bonus} in funds.`;
      }
      this.advance();
    } else if (n.kind === 'treasure') {
      this.openEgg(this.rng.pick(Object.keys(EGGS) as EggKind[]), 'map');
    }
  }

  /** After a node is done: on to the next column, or the next park. */
  private advance(): void {
    const lastCol = this.parkMap.length - 1;
    if ((this.mapPos?.col ?? -1) >= lastCol) this.enterPark(this.parkIndex + 1);
    else this.phase = 'map';
  }

  // ---- A day at the park -----------------------------------------------------

  private startDay(node: NodeKind): void {
    this.cfg = dayConfig(this.dayNum, this.mods, node);
    this.board = generateBoard(this.cfg, this.rng);
    this.queue = [];
    for (let i = 0; i < this.cfg.startRiders; i++) this.queue.push(this.newRider());
    for (const kind of this.crowd) this.queue.push(makeRider(this.rng, this.dayNum, this.nextId++, this.cfg.park.id, kind));
    if (node === 'vip') this.queue.unshift(makeVip(this.rng, this.dayNum, this.nextId++));
    if (this.cfg.boss) this.queue.unshift(makeBoss(this.rng, this.cfg.boss, this.nextId++));
    this.daylight = this.cfg.daylight;
    this.actions = 0;
    this.buzz = 0;
    this.bestCombo = 0;
    this.chainLinks = 0;
    this.selected = 0;
    this.aiming = null;
    this.undos = this.mods.undos;
    this.history = [];
    this.result = null;
    this.phase = 'build';
    this.events.push({ type: 'day' });
  }

  private newRider(): Rider {
    return makeRider(this.rng, this.dayNum, this.nextId++, this.cfg.park.id);
  }

  /** Stats of the track as a full circuit. */
  get stats(): RideStats {
    return rideStats(trackCells(this.board), this.mods);
  }

  get slotsFree(): boolean {
    return this.attractions.length < ATTRACTION_SLOTS;
  }

  private has(id: string): boolean {
    return this.attractions.some((a) => a.id === id);
  }

  /** How much nausea it takes to make this rider puke once, after upgrades and attractions. */
  stomach(r: Rider): number {
    return r.stomach + this.mods.stomachDelta - (this.has('corndogcart') ? 2 : 0);
  }

  /** Nausea one piece gives this rider, including attraction bonuses. */
  nausea(r: Rider, tier: number): number {
    return pieceNausea(r, tier) + (tier === 4 && this.has('tilttable') ? 3 : 0);
  }

  /** How many times this rider would puke if the ride opened now as `kind`. A shuttle passes each piece twice. */
  pukes(r: Rider, kind: RideKind = this.openKind ?? 'circuit'): number {
    const stops = rideOrder(this.board, kind).filter((s) => !s.station);
    return pukesFor(stops.reduce((a, s) => a + this.nausea(r, s.tier), 0), this.stomach(r));
  }

  /** Excitement × multiplier if the ride opened now as `kind`. */
  score(kind: RideKind): Score {
    const pukers = this.queue.filter((r) => this.pukes(r, kind) > 0).length;
    const ctx = { stats: this.stats, riders: this.queue.length, pukers, chainLinks: this.chainLinks, daylightLeft: Math.max(0, this.daylight) };
    return scoreRide(ctx, this.attractions, kind === 'shuttle');
  }

  /** What opening right now would be: a circuit if the ends meet, else a shuttle. */
  get openKind(): RideKind | null {
    if (this.phase !== 'build') return null;
    if (canConnect(this.board)) return 'circuit';
    return canShuttle(this.board) ? 'shuttle' : null;
  }

  /** Every puke pays the rating, times the rider's worth (VIPs, influencers, ghosts, bosses). */
  points(r: Rider, pukes: number, rating: number): number {
    return pukes * rating * riderWorth(r);
  }

  /** Tickets if the ride opened now as `kind`. */
  projected(kind: RideKind): number {
    const rating = this.score(kind).rating;
    return this.queue.reduce((a, r) => a + this.points(r, this.pukes(r, kind), rating), 0);
  }

  private snapshot(): void {
    this.history.push({
      board: cloneBoard(this.board),
      queue: this.queue.map((r) => ({ ...r })),
      daylight: this.daylight,
      actions: this.actions,
      buzz: this.buzz,
      bestCombo: this.bestCombo,
      chainLinks: this.chainLinks,
      selected: this.selected,
      tools: { ...this.tools },
      rngState: this.rng.state,
      nextId: this.nextId,
    });
  }

  swipe(dir: Dir): void {
    if (this.phase !== 'build') return;
    this.aiming = null;
    if (this.daylight <= 0) {
      // After sunset the tiles stay put; building and opening still work.
      this.events.push({ type: 'blocked' });
      return;
    }
    this.snapshot();
    const result = swipe(this.board, dir, this.rng, {
      hillChance: this.mods.hillChance,
      spawns: this.mods.spawns,
    });
    if (!result) {
      // Nothing moved, so nothing changed: drop the snapshot, spend no daylight.
      this.history.pop();
      this.events.push({ type: 'blocked' });
      return;
    }
    this.bestCombo = Math.max(this.bestCombo, result.mergeCount);
    this.chainLinks += result.chain.waves.length;
    this.events.push({ type: 'swipe', result });
    // Chain reactions draw a crowd: one new rider per link.
    for (let i = 0; i < result.chain.waves.length; i++) this.arrive('chain');
    this.tick();
  }

  /** A tap on the park: aims the active tool, or builds. */
  tap(x: number, y: number): void {
    if (this.aiming) this.aimAt(x, y);
    else this.buildAt(x, y);
  }

  /** Arm a tool (or use it right away if it needs no target). Tapping the armed tool again disarms it. */
  useTool(id: ToolId): void {
    if (this.phase !== 'build' || !this.tools[id]) return;
    if (this.aiming?.tool === id) {
      this.aiming = null;
      return;
    }
    if (TOOLS[id].aim) {
      this.aiming = { tool: id };
      return;
    }
    this.snapshot();
    this.tools[id]--;
    this.aiming = null;
    if (id === 'coffee') this.daylight += 5;
    if (id === 'megaphone') for (let i = 0; i < 3; i++) this.arrive('buzz');
    this.events.push({ type: 'tool', tool: id });
  }

  private aimAt(x: number, y: number): void {
    const aim = this.aiming!;
    const b = this.board;
    const i = idx(b, x, y);
    const fail = (): void => {
      this.events.push({ type: 'blocked' });
    };
    if (aim.tool === 'dynamite') {
      if (!b.obstacles[i]) return fail();
      this.snapshot();
      b.obstacles[i] = null;
      this.spend('dynamite', { x, y });
      return;
    }
    if (aim.tool === 'paint') {
      if (!b.tiles[i] || b.tiles[i] >= MAX_TIER || isWall(b, x, y)) return fail();
      this.snapshot();
      const before = [...b.tiles];
      b.tiles[i]++;
      this.spend('paint', { x, y });
      this.settle(before, [], [{ x, y }]);
      return;
    }
    // Crane: first tap picks a tile, second tap moves it (swapping with whatever is there).
    if (isWall(b, x, y)) return fail();
    if (!aim.first) {
      if (!b.tiles[i]) return fail();
      this.aiming = { tool: 'crane', first: { x, y } };
      return;
    }
    const a = aim.first;
    const j = idx(b, a.x, a.y);
    if (a.x === x && a.y === y) {
      this.aiming = { tool: 'crane' };
      return;
    }
    this.snapshot();
    const before = [...b.tiles];
    [b.tiles[i], b.tiles[j]] = [b.tiles[j], b.tiles[i]];
    const moved = [
      { from: a, to: { x, y }, tier: before[j] },
      ...(before[i] ? [{ from: { x, y }, to: a, tier: before[i] }] : []),
    ];
    this.spend('crane', { x, y });
    this.settle(before, moved, [a, { x, y }].filter((p) => b.tiles[idx(b, p.x, p.y)]));
  }

  private spend(tool: ToolId, at: Pt): void {
    this.tools[tool]--;
    this.aiming = null;
    this.events.push({ type: 'tool', tool, at });
  }

  /** After a tool changes tiles, let chains resolve and animate like a swipe (without the slide or a spawn). */
  private settle(before: number[], moved: { from: Pt; to: Pt; tier: number }[], seeds: Pt[]): void {
    const b = this.board;
    const movedFrom = new Set(moved.map((m) => idx(b, m.from.x, m.from.y)));
    const slides = moved.map((m) => ({ ...m, merged: false }));
    for (let k = 0; k < before.length; k++)
      if (before[k] && !movedFrom.has(k)) {
        const p = { x: k % b.size, y: Math.floor(k / b.size) };
        slides.push({ from: p, to: p, tier: b.tiles[k] || before[k], merged: false });
      }
    const slid = [...b.tiles];
    const chain = resolveChains(b, seeds);
    const mergeCount = chain.waves.reduce((a, w) => a + w.length, 0);
    this.bestCombo = Math.max(this.bestCombo, mergeCount);
    this.chainLinks += chain.waves.length;
    this.events.push({ type: 'swipe', result: { dir: 'up', slides, merges: [], slid, chain, spawned: [], sunk: [], mergeCount } });
    for (let w = 0; w < chain.waves.length; w++) this.arrive('chain');
  }

  /** Build into (x, y) from whichever end can reach it, preferring the selected one. */
  buildAt(x: number, y: number): void {
    if (this.phase !== 'build') return;
    const targets = buildTargets(this.board).filter((t) => t.x === x && t.y === y);
    if (!targets.length) {
      this.events.push({ type: 'blocked' });
      return;
    }
    const end = targets.find((t) => t.end === this.selected)?.end ?? targets[0].end;
    this.doBuild(end, x, y);
  }

  /** Keyboard building: extend the selected end one cell in `dir`. */
  buildDir(dir: Dir): void {
    if (this.phase !== 'build') return;
    const t = step(head(this.board, this.selected), dir);
    if (!buildTargets(this.board, this.selected).some((c) => c.x === t.x && c.y === t.y)) {
      this.events.push({ type: 'blocked' });
      return;
    }
    this.doBuild(this.selected, t.x, t.y);
  }

  private doBuild(end: End, x: number, y: number): void {
    this.snapshot();
    const laid = build(this.board, end, x, y)!;
    this.selected = end;
    this.events.push({ type: 'build', laid, end });
    // Building is free: only swipes spend daylight.
  }

  selectEnd(end?: End): void {
    if (this.phase !== 'build') return;
    this.selected = end ?? (this.selected === 0 ? 1 : 0);
  }

  private arrive(reason: ArrivalReason): void {
    if (this.queue.length >= this.cfg.maxQueue) return;
    const rider = this.newRider();
    this.queue.push(rider);
    this.events.push({ type: 'arrive', rider, reason });
  }

  /** One swipe's worth of daylight passes. */
  private tick(): void {
    this.actions++;
    this.daylight--;
    if (this.actions % WALKIN_EVERY === 0) this.arrive('walkin');
    this.buzz += this.stats.chips / BUZZ_PER;
    while (this.buzz >= 1) {
      this.buzz -= 1;
      this.arrive('buzz');
    }
    if (this.daylight === 0) this.events.push({ type: 'dark' });
  }

  open(kind: RideKind | null = this.openKind): void {
    if (this.phase !== 'build' || !kind) return;
    if (kind === 'circuit' && !canConnect(this.board)) return;
    if (kind === 'shuttle' && !canShuttle(this.board)) return;
    this.aiming = null;
    const score = this.score(kind);
    this.board.opened = kind;
    this.finishDay(kind, score);
  }

  undo(): void {
    if (this.phase !== 'build' || !this.undos || !this.history.length) return;
    const s = this.history.pop()!;
    this.board = s.board;
    this.queue = s.queue;
    this.daylight = s.daylight;
    this.actions = s.actions;
    this.buzz = s.buzz;
    this.bestCombo = s.bestCombo;
    this.chainLinks = s.chainLinks;
    this.selected = s.selected;
    this.tools = s.tools;
    this.aiming = null;
    this.rng.state = s.rngState;
    this.nextId = s.nextId;
    this.undos--;
    this.events.push({ type: 'undo' });
  }

  private finishDay(kind: RideKind, score: Score): void {
    const stats = this.stats;
    const tickets: RiderTicket[] = this.queue.map((rider) => {
      const pukes = this.pukes(rider, kind);
      return { rider, pukes, paid: this.points(rider, pukes, score.rating) };
    });
    const total = tickets.reduce((a, t) => a + t.paid, 0);
    const boss = tickets.find((t) => t.rider.boss);
    const bossPuked = !boss || boss.pukes > 0;
    const timeline = rideTimeline({
      stops: rideOrder(this.board, kind),
      mods: this.mods,
      score,
      shuttle: kind === 'shuttle',
      riders: this.queue.map((r) => ({ nausea: (t: number) => this.nausea(r, t), stomach: this.stomach(r), worth: riderWorth(r), boss: !!r.boss })),
    });
    this.result = { kind, stats, score, tickets, total, target: this.cfg.target, bossPuked, passed: total >= this.cfg.target && bossPuked, timeline };
    // The ride plays out on the board first; the renderer calls rideDone() after.
    this.phase = 'ride';
    this.events.push({ type: 'open', kind });
  }

  /** Called by the renderer when the ride animation ends. */
  rideDone(): void {
    if (this.phase === 'ride') this.phase = 'results';
  }

  continueFromResults(): void {
    if (this.phase !== 'results' || !this.result) return;
    const r = this.result;
    this.runScore += r.total;
    if (r.passed) {
      this.funds += r.total - r.target;
      for (const a of this.attractions) if (a.id === 'seasonpass') a.counter++;
    } else this.hearts--;
    if (this.hearts <= 0 || (r.passed && this.cfg.node === 'finale')) {
      this.phase = this.hearts <= 0 ? 'over' : 'won';
      if (this.runScore > this.best) {
        this.best = this.runScore;
        saveBest(this.best);
      }
      return;
    }
    this.offer = rewardOffer(this.rng, this.attractions.map((a) => a.id), this.slotsFree, this.cfg.node === 'storm');
    this.rewardFrom = 'day';
    this.phase = 'reward';
  }

  chooseReward(i: number): void {
    const r = this.offer[i];
    if (this.phase !== 'reward' || !r) return;
    if (r.kind === 'upgrade') {
      this.upgrades.push(r.id);
      this.mods = modsFor(this.upgrades);
    } else if (r.kind === 'tool') this.tools[r.id] += TOOLS[r.id].charges;
    else if (this.slotsFree) this.attractions.push({ id: r.id, counter: 0 });
    this.afterReward();
  }

  /** Skip the reward (e.g. when attraction slots are full). */
  skipReward(): void {
    if (this.phase === 'reward') this.afterReward();
  }

  private afterReward(): void {
    if (this.rewardFrom === 'treasure') return this.advance();
    // A missed finale runs again the next day; otherwise the day is done.
    if (this.cfg.node === 'finale') return this.startDay('finale');
    this.dayNum++;
    this.advance();
  }

  buy(i: number): void {
    const item = this.shop[i];
    if (this.phase !== 'shop' || !item || item.sold || this.funds < item.price) return;
    if (item.kind === 'heart' && this.hearts >= HEARTS) return;
    if (item.kind === 'attraction' && !this.slotsFree) return;
    this.funds -= item.price;
    item.sold = true;
    if (item.kind === 'egg') this.openEgg(item.id, 'shop');
    else if (item.kind === 'tool') this.tools[item.id] += TOOLS[item.id].charges;
    else if (item.kind === 'upgrade') {
      this.upgrades.push(item.id);
      this.mods = modsFor(this.upgrades);
    } else if (item.kind === 'attraction') this.attractions.push({ id: item.id, counter: 0 });
    else this.hearts++;
  }

  // ---- Capsule eggs --------------------------------------------------------

  private openEgg(kind: EggKind, returnTo: 'shop' | 'map'): void {
    const items = eggContents(this.rng, kind, this.dayNum, this.attractions.map((a) => a.id));
    this.egg = { kind, items, picksLeft: EGGS[kind].picks, cracked: false, returnTo };
    this.phase = 'egg';
  }

  crackEgg(): void {
    if (this.phase === 'egg' && this.egg) this.egg.cracked = true;
  }

  canTakeFromEgg(i: number): boolean {
    const item = this.egg?.items[i];
    return !!item && !(item.kind === 'attraction' && !this.slotsFree);
  }

  takeFromEgg(i: number): void {
    const egg = this.egg;
    if (this.phase !== 'egg' || !egg?.cracked || !this.canTakeFromEgg(i)) return;
    const [item] = egg.items.splice(i, 1);
    if (item.kind === 'attraction') this.attractions.push({ id: item.id, counter: 0 });
    else if (item.kind === 'tool') this.tools[item.id] += TOOLS[item.id].charges;
    else this.crowd.push(item.id);
    egg.picksLeft--;
    if (egg.picksLeft <= 0 || !egg.items.length) this.closeEgg();
  }

  /** Leave the egg (also when you'd rather not take anything). */
  closeEgg(): void {
    if (this.phase !== 'egg' || !this.egg) return;
    const back = this.egg.returnTo;
    this.egg = null;
    if (back === 'shop') this.phase = 'shop';
    else this.advance();
  }

  leaveShop(): void {
    if (this.phase === 'shop') this.advance();
  }

  /** Sell an attraction to free its slot. */
  sellAttraction(i: number): void {
    if (!this.attractions[i] || this.phase === 'ride') return;
    this.attractions.splice(i, 1);
    this.funds += sellValue(this.dayNum);
  }

  /** Reorder attractions: they score left to right. */
  moveAttraction(i: number, by: -1 | 1): void {
    const j = i + by;
    if (!this.attractions[i] || !this.attractions[j] || this.phase === 'ride') return;
    [this.attractions[i], this.attractions[j]] = [this.attractions[j], this.attractions[i]];
  }
}

function emptyTools(): Record<ToolId, number> {
  return { coffee: 0, paint: 0, crane: 0, dynamite: 0, megaphone: 0 };
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(n: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    // Storage can be unavailable (private mode); best score just won't persist.
  }
}

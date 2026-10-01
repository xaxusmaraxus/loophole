import { Rng, randomSeed } from './core/rng';
import {
  type Board,
  DIRS,
  type Dir,
  type End,
  type Pt,
  type RideStop,
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
import { BRAKES_NAUSEA, MAX_TIER, type RideStats, SPECIALS, type SpecialId, rideStats } from './puzzle/pieces';
import { type PlayRecord, type UnlockId, checkUnlocks, emptyRecord, startingKit, unlockedSpecials } from './run/unlocks';
import { BOSSES, BOSS_POOL, BOSS_ROUNDS, type BossId, type Rider, makeBoss, makeRider, makeVip, pieceNausea, pukesFor, riderWorth } from './riders/riders';
import { type OwnedAttraction, type Score, scoreRide } from './run/attractions';
import { type BossFight, DEMANDS, ROUND_DAYLIGHT, SECONDS_EVERY, SPIN_EVERY, WAVE_EVERY, WHISTLE_COST, pickDemands, spun } from './run/bossday';
import {
  PLOT_MAX_H,
  type Plot,
  type PlotItem,
  type PlotRef,
  STASH_SIZE,
  cellsOf,
  district,
  emptyPlot,
  firstFit,
  fits,
  freeCells,
  neighbors,
  readingOrder,
  themeOf,
} from './run/plot';
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
  SPECIAL_CHARGES,
  type ShopItem,
  priceScale,
  TOOLS,
  type ToolId,
  type UpgradeId,
  dayConfig,
  generateBoard,
  generateParkMap,
  legendaryOffer,
  modsFor,
  rewardOffer,
  sellValue,
  shopStock,
} from './run/run';

export type Phase = 'intro' | 'map' | 'build' | 'ride' | 'results' | 'reward' | 'conquered' | 'shop' | 'egg' | 'over' | 'won';
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
  | { type: 'special'; special: SpecialId; at: Pt }
  | { type: 'unlock'; id: UnlockId }
  /** A boss rule kicked in: a wave sloshed the board, the controls spun, or Barry had a snack. */
  | { type: 'boss'; what: 'wave' | 'spin' | 'snack'; dir?: Dir }
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
  /** The boss (if any) is broken: their composure is gone. */
  bossPuked: boolean;
  /** Times the boss puked on this ride. */
  bossHits: number;
  /** Boss composure left after this ride, and before it. */
  bossHp: number;
  bossHpBefore: number;
  /** Ride number on a boss day (1 otherwise). */
  round: number;
  /** Tickets today, earlier rides included: what the target is measured against. */
  dayTotal: number;
  /** The Mayor's demands weren't met, so the Mayor sat it out. */
  refused: boolean;
  /** The boss isn't done yet: another ride follows today. */
  again: boolean;
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
  specials: Record<SpecialId, number>;
  fight: BossFight | null;
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
  /** The park plot: every attraction and upgrade you've built, on a grid. */
  plot: Plot = emptyPlot();
  /** Who waits at the end of this park (drawn from the park's pool when you arrive). */
  parkBoss: BossId = 'barry';
  /** Today's boss fight, if it's a boss day. */
  fight: BossFight | null = null;
  /** Tool charges carried through the run. */
  tools: Record<ToolId, number> = emptyTools();
  /** Special piece charges (Launch, Water Splash, Brake Run), fitted onto built track. */
  specials: Record<SpecialId, number> = emptySpecials();
  /** A tool (or special piece) waiting for its target tap (the crane remembers its first pick). */
  aiming: { tool: ToolId | SpecialId; first?: Pt } | null = null;
  /** Everything done across seasons, for unlocks. The page loads and saves it. */
  record: PlayRecord = emptyRecord();
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
  private rewardFrom: 'day' | 'treasure' | 'boss' = 'day';
  private nextUid = 1;
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
    this.plot = emptyPlot();
    this.fight = null;
    this.crowd = [];
    this.egg = null;
    this.funds = 0;
    this.tools = { ...emptyTools(), paint: 1 };
    this.specials = emptySpecials();
    // Unlocked starting kit.
    const kit = startingKit(this.record);
    for (const [t, n] of Object.entries(kit.tools)) this.tools[t as ToolId] += n ?? 0;
    for (const [t, n] of Object.entries(kit.specials)) this.specials[t as SpecialId] += n ?? 0;
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
    this.parkBoss = this.rng.pick(BOSS_POOL[SEASON_ORDER[index]]);
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
      this.shop = shopStock(this.rng, this.dayNum, this.ownedIds, unlockedSpecials(this.record));
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
    this.cfg = dayConfig(this.dayNum, this.mods, node, this.parkBoss);
    if (this.has('buffet')) this.cfg.maxQueue -= 3;
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
    const boss = this.cfg.boss;
    this.fight = boss
      ? { round: 1, hp: BOSSES[boss].composure, max: BOSSES[boss].composure, banked: 0, wave: this.rng.pick(DIRS), spin: 0, demands: BOSSES[boss].rule === 'demands' ? pickDemands(this.rng) : [] }
      : null;
    this.phase = 'build';
    this.events.push({ type: 'day' });
  }

  /** The boss wasn't broken yet: the track comes down, they get back in line, and you go again. */
  private nextRound(): void {
    const f = this.fight!;
    f.round++;
    f.banked += this.result!.total;
    f.wave = this.rng.pick(DIRS);
    const b = this.board;
    b.ends = [[], []];
    b.opened = null;
    this.daylight = Math.ceil(this.cfg.daylight * ROUND_DAYLIGHT);
    this.actions = 0;
    this.buzz = 0;
    this.selected = 0;
    this.aiming = null;
    this.undos = this.mods.undos;
    this.history = [];
    this.result = null;
    this.phase = 'build';
    this.events.push({ type: 'day' });
  }

  /** The boss rule in force today, if any. */
  get bossRule() {
    return this.cfg.boss ? BOSSES[this.cfg.boss].rule : null;
  }

  /** The Mayor's demands, each with whether the ride meets it now. */
  demands(kind: RideKind = this.openKind ?? 'circuit'): { text: string; met: boolean }[] {
    const s = this.stats;
    return (this.fight?.demands ?? []).map((d) => ({ text: DEMANDS[d].text, met: DEMANDS[d].met(s, kind === 'circuit') }));
  }

  /** On Inspection Day, the Mayor only rides if every demand is met. */
  refuses(r: Rider, kind: RideKind): boolean {
    return !!r.boss && this.bossRule === 'demands' && this.demands(kind).some((d) => !d.met);
  }

  // ---- The park plot ---------------------------------------------------------

  /** Attractions on the plot, in scoring order, with what touches them. */
  get attractions(): (OwnedAttraction & { uid: number })[] {
    const p = this.plot;
    const placed = readingOrder(p.items).filter((i): i is PlotItem & { kind: 'attraction' } => i.kind === 'attraction');
    return placed.map((it) => ({
      uid: it.uid,
      id: it.id,
      counter: it.counter,
      touching: placed.flatMap((o, j) => (neighbors(p, it).includes(o) ? [j] : [])),
      district: district(p, it),
    }));
  }

  /** Upgrades on the plot (stashed ones don't count). */
  get upgrades(): UpgradeId[] {
    return this.plot.items.flatMap((i) => (i.kind === 'upgrade' ? [i.id] : []));
  }

  /** Every attraction you own, placed or stashed (so offers don't repeat them). */
  get ownedIds() {
    return [...this.plot.items, ...this.plot.stash].flatMap((i) => (i.kind === 'attraction' ? [i.id] : []));
  }

  private refreshMods(): void {
    this.mods = modsFor(this.upgrades);
  }

  /** Room for one more thing: a free cell, or a free stash space. */
  get slotsFree(): boolean {
    return freeCells(this.plot) > 0 || this.plot.stash.length < STASH_SIZE;
  }

  canGain(r: PlotRef): boolean {
    return !!firstFit(this.plot, r) || this.plot.stash.length < STASH_SIZE;
  }

  /** Puts something new on the plot (first free spot), or in the stash if it doesn't fit. */
  gain(r: PlotRef): boolean {
    const at = firstFit(this.plot, r);
    if (!at && this.plot.stash.length >= STASH_SIZE) return false;
    const it = { ...r, uid: this.nextUid++, counter: 0, x: at?.x ?? -1, y: at?.y ?? -1, turned: at?.turned ?? false } as PlotItem;
    (at ? this.plot.items : this.plot.stash).push(it);
    this.refreshMods();
    return true;
  }

  /** The plot can be rearranged between days, not while a day is on. */
  get canEditPlot(): boolean {
    return this.phase !== 'build' && this.phase !== 'ride';
  }

  private findItem(uid: number): PlotItem | undefined {
    return this.plot.items.find((i) => i.uid === uid) ?? this.plot.stash.find((i) => i.uid === uid);
  }

  /** Move a spot (from the plot or the stash) to (x, y). */
  placeItem(uid: number, x: number, y: number, turned?: boolean): boolean {
    const it = this.findItem(uid);
    if (!it || !this.canEditPlot) return false;
    const t = turned ?? it.turned;
    if (!fits(this.plot, it, x, y, t, uid)) return this.swapInto(it, x, y, t);
    Object.assign(it, { x, y, turned: t });
    const k = this.plot.stash.indexOf(it);
    if (k >= 0) {
      this.plot.stash.splice(k, 1);
      this.plot.items.push(it);
    }
    this.refreshMods();
    return true;
  }

  /**
   * Dropping onto a spot of the same shape swaps the two (from the stash, the
   * other one goes to the dock instead).
   */
  private swapInto(it: PlotItem, x: number, y: number, turned: boolean, dry = false): boolean {
    const p = this.plot;
    const mine = cellsOf({ ...it, x, y, turned });
    const hit = p.items.filter((o) => o !== it && cellsOf(o).some((c) => mine.some((m) => m.x === c.x && m.y === c.y)));
    const o = hit[0];
    if (hit.length !== 1 || o.x !== x || o.y !== y || o.turned !== turned) return false;
    const a = cellsOf({ ...it, x: 0, y: 0, turned });
    const b = cellsOf({ ...o, x: 0, y: 0 });
    if (a.length !== b.length || a.some((c, k) => c.x !== b[k].x || c.y !== b[k].y)) return false;
    if (dry) return true;
    const inStash = p.stash.indexOf(it);
    if (inStash >= 0) {
      p.stash[inStash] = o;
      p.items = p.items.map((i) => (i === o ? it : i));
      Object.assign(o, { x: -1, y: -1 });
    } else Object.assign(o, { x: it.x, y: it.y, turned: it.turned });
    Object.assign(it, { x, y, turned });
    this.refreshMods();
    return true;
  }

  /** Whether a spot could be dropped at (x, y): it fits, or swaps with a same-shaped spot. */
  canPlace(uid: number, x: number, y: number, turned: boolean): boolean {
    const it = this.findItem(uid);
    return !!it && (fits(this.plot, it, x, y, turned, uid) || this.swapInto(it, x, y, turned, true));
  }

  /** Take a spot off the plot into the stash. */
  stashItem(uid: number): boolean {
    const p = this.plot;
    const k = p.items.findIndex((i) => i.uid === uid);
    if (k < 0 || !this.canEditPlot || p.stash.length >= STASH_SIZE) return false;
    const [it] = p.items.splice(k, 1);
    it.x = it.y = -1;
    p.stash.push(it);
    this.refreshMods();
    return true;
  }

  /** Sell a spot (placed or stashed) for funds. */
  sellItem(uid: number): void {
    const it = this.findItem(uid);
    if (!it || !this.canEditPlot) return;
    const p = this.plot;
    p.items = p.items.filter((i) => i !== it);
    p.stash = p.stash.filter((i) => i !== it);
    this.funds += sellValue(this.dayNum, cellsOf({ ...it, x: 0, y: 0 }).length);
    this.refreshMods();
  }

  private newRider(): Rider {
    return makeRider(this.rng, this.dayNum, this.nextId++, this.cfg.park.id);
  }

  /** Stats of the track as a full circuit. */
  get stats(): RideStats {
    return rideStats(trackCells(this.board), this.mods);
  }

  private has(id: string): boolean {
    return this.attractions.some((a) => a.id === id);
  }

  /** How much nausea it takes to make this rider puke once, after upgrades and attractions. */
  stomach(r: Rider): number {
    let s = r.stomach + this.mods.stomachDelta - (this.has('corndogcart') ? 2 : 0) - (this.has('buffet') ? 3 : 0);
    // Funnel Cake Stands: 1 smaller for each Food spot touching one.
    for (const it of this.plot.items) if (it.kind === 'attraction' && it.id === 'funnelcake') s -= neighbors(this.plot, it).filter((o) => themeOf(o) === 'food').length;
    // Big Barry snacks while you build.
    if (r.boss && this.bossRule === 'seconds') s += Math.floor(this.actions / SECONDS_EVERY);
    return s;
  }

  /** Nausea one piece gives this rider, including attraction bonuses. */
  nausea(r: Rider, tier: number): number {
    if (tier === 3 && this.has('gravitywell')) return 0;
    let n = pieceNausea(r, tier) + (tier === 4 && this.has('tilttable') ? 3 : 0);
    if (tier >= 5 && this.has('gravitywell')) n += 2;
    return n;
  }

  /**
   * Nausea the stop at index i of a ride gives this rider: its piece, doubled right
   * after a Launch, plus the jolt of a Brake Run.
   */
  stopNausea(r: Rider, stops: readonly RideStop[], i: number): number {
    const s = stops[i];
    if (s.station) return 0;
    // Granny Grit has seen it all: only the first piece of each type gets to her.
    if (r.boss && this.bossRule === 'seenitall' && stops.slice(0, i).some((o) => !o.station && o.tier === s.tier)) return 0;
    let n = this.nausea(r, s.tier);
    let j = i - 1;
    while (j >= 0 && stops[j].station) j--;
    if (j >= 0 && stops[j].special === 'launch') n *= 2;
    if (s.special === 'brakes') n += BRAKES_NAUSEA;
    return n;
  }

  /** How many times this rider would puke if the ride opened now as `kind`. A shuttle passes each piece twice. */
  pukes(r: Rider, kind: RideKind = this.openKind ?? 'circuit'): number {
    if (this.refuses(r, kind)) return 0;
    const stops = rideOrder(this.board, kind);
    return pukesFor(stops.reduce((a, _s, i) => a + this.stopNausea(r, stops, i), 0), this.stomach(r));
  }

  /** Excitement × multiplier if the ride opened now as `kind`. */
  score(kind: RideKind): Score {
    const counts = this.queue.map((r) => this.pukes(r, kind));
    const pukers = counts.filter((n) => n > 0).length;
    const pukes = counts.reduce((a, n) => a + n, 0);
    const ctx = { stats: this.stats, riders: this.queue.length, pukers, pukes, chainLinks: this.chainLinks, daylightLeft: Math.max(0, this.daylight) };
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
      specials: { ...this.specials },
      fight: this.fight && { ...this.fight },
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
    // Dr. Vertigo: the controls have turned.
    if (this.fight && this.bossRule === 'spin') dir = spun(dir, this.fight.spin);
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
    // Lifeguard Lou: no running! A swipe that merges nothing costs extra.
    if (this.bossRule === 'whistle' && result.mergeCount === 0) this.daylight -= WHISTLE_COST - 1;
    this.tick();
  }

  /** A tap on the park: aims the active tool, or builds. */
  tap(x: number, y: number): void {
    if (this.aiming) this.aimAt(x, y);
    else this.buildAt(x, y);
  }

  /** Arm a special piece: the next tap on built track fits it there. Tapping it again disarms it. */
  useSpecial(id: SpecialId): void {
    if (this.phase !== 'build' || !this.specials[id]) return;
    this.aiming = this.aiming?.tool === id ? null : { tool: id };
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
    if (aim.tool in SPECIALS) {
      // Fits onto the first pass of a built track cell that has no special yet.
      const id = aim.tool as SpecialId;
      const cell = b.ends.flat().find((c) => c.x === x && c.y === y && !c.cross);
      if (!cell || cell.special) return fail();
      this.snapshot();
      const [e, k] = b.ends[0].includes(cell) ? [0, b.ends[0].indexOf(cell)] : [1, b.ends[1].indexOf(cell)];
      b.ends[e][k].special = id;
      this.specials[id]--;
      this.aiming = null;
      this.events.push({ type: 'special', special: id, at: { x, y } });
      return;
    }
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
    this.bossTick();
    this.buzz += this.stats.chips / BUZZ_PER;
    while (this.buzz >= 1) {
      this.buzz -= 1;
      this.arrive('buzz');
    }
    if (this.daylight === 0) this.events.push({ type: 'dark' });
  }

  /** Boss rules that run on the swipe clock. */
  private bossTick(): void {
    const f = this.fight;
    if (!f) return;
    const rule = this.bossRule;
    if (rule === 'seconds' && this.actions % SECONDS_EVERY === 0) this.events.push({ type: 'boss', what: 'snack' });
    if (rule === 'spin' && this.actions % SPIN_EVERY === 0) {
      f.spin = (f.spin + 1) % 4;
      this.events.push({ type: 'boss', what: 'spin' });
    }
    if (rule === 'waves' && this.actions % WAVE_EVERY === 0) {
      const dir = f.wave;
      f.wave = this.rng.pick(DIRS);
      this.events.push({ type: 'boss', what: 'wave', dir });
      // The wave slides every loose tile one way. Merges and chains happen as usual; nothing new washes up.
      const result = swipe(this.board, dir, this.rng, { hillChance: this.mods.hillChance, spawns: 0 });
      if (result) {
        this.chainLinks += result.chain.waves.length;
        this.events.push({ type: 'swipe', result });
      }
    }
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
    this.specials = s.specials;
    this.fight = s.fight;
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
    const f = this.fight;
    const bossHits = boss?.pukes ?? 0;
    const hpBefore = f?.hp ?? 0;
    if (f) f.hp = Math.max(0, f.hp - bossHits);
    const bossPuked = !f || f.hp <= 0;
    const dayTotal = (f?.banked ?? 0) + total;
    const passed = dayTotal >= this.cfg.target && bossPuked;
    const refused = !!boss && this.refuses(boss.rider, kind);
    const stops = rideOrder(this.board, kind);
    const timeline = rideTimeline({
      stops,
      mods: this.mods,
      score,
      shuttle: kind === 'shuttle',
      riders: this.queue.map((r) => ({ nausea: (i: number) => (this.refuses(r, kind) ? 0 : this.stopNausea(r, stops, i)), stomach: this.stomach(r), worth: riderWorth(r), boss: !!r.boss })),
    });
    this.result = {
      kind,
      stats,
      score,
      tickets,
      total,
      target: this.cfg.target,
      bossPuked,
      bossHits,
      bossHp: f?.hp ?? 0,
      bossHpBefore: hpBefore,
      round: f?.round ?? 1,
      dayTotal,
      refused,
      again: !!f && !passed && f.round < BOSS_ROUNDS,
      passed,
      timeline,
    };
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
    // The season record, for unlocks.
    const rec = this.record;
    rec.totalPukes += r.tickets.reduce((a, t) => a + t.pukes, 0);
    rec.bestRide = Math.max(rec.bestRide, r.total);
    // Bosses go on the trophy shelf once broken.
    const boss = this.cfg.boss;
    if (boss && r.bossPuked && !rec.bosses.includes(boss)) rec.bosses.push(boss);
    if (r.again) {
      this.unlockCheck();
      return this.nextRound();
    }
    if (r.passed) {
      this.funds += r.dayTotal - r.target;
      for (const it of this.plot.items) if (it.kind === 'attraction' && it.id === 'seasonpass') it.counter++;
    } else this.hearts--;
    if (this.hearts <= 0 || (r.passed && this.cfg.node === 'finale')) {
      this.phase = this.hearts <= 0 ? 'over' : 'won';
      rec.seasons++;
      if (this.phase === 'won') rec.wins++;
      this.unlockCheck();
      if (this.runScore > this.best) {
        this.best = this.runScore;
        saveBest(this.best);
      }
      return;
    }
    this.unlockCheck();
    // A broken boss: the park grows a row, and drops a legendary.
    if (r.passed && this.cfg.node === 'boss') {
      this.plot.h = Math.min(PLOT_MAX_H, this.plot.h + 1);
      this.offer = legendaryOffer(this.rng, this.ownedIds);
      this.rewardFrom = 'boss';
      this.phase = 'conquered';
      return;
    }
    this.offer = rewardOffer(this.rng, this.ownedIds, this.slotsFree, this.cfg.node === 'storm', unlockedSpecials(this.record));
    this.rewardFrom = 'day';
    this.phase = 'reward';
  }

  /** Whether a reward on offer can be taken right now (attractions and upgrades need room). */
  canTake(r: Reward): boolean {
    return r.kind === 'attraction' || r.kind === 'upgrade' ? this.canGain(r) : true;
  }

  chooseReward(i: number): void {
    const r = this.offer[i];
    if ((this.phase !== 'reward' && this.phase !== 'conquered') || !r || !this.canTake(r)) return;
    if (r.kind === 'upgrade' || r.kind === 'attraction') this.gain(r);
    else if (r.kind === 'tool') this.tools[r.id] += TOOLS[r.id].charges;
    else if (r.kind === 'special') this.specials[r.id] += SPECIAL_CHARGES;
    this.afterReward();
  }

  /** Skip the reward (e.g. when attraction slots are full). */
  skipReward(): void {
    if (this.phase === 'reward' || this.phase === 'conquered') this.afterReward();
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
    if ((item.kind === 'attraction' || item.kind === 'upgrade') && !this.canGain(item)) return;
    this.funds -= item.price;
    item.sold = true;
    if (item.kind === 'egg') this.openEgg(item.id, 'shop');
    else if (item.kind === 'tool') this.tools[item.id] += TOOLS[item.id].charges;
    else if (item.kind === 'special') this.specials[item.id] += SPECIAL_CHARGES;
    else if (item.kind === 'upgrade' || item.kind === 'attraction') this.gain(item);
    else this.hearts++;
  }

  /** New unlocks earned: they go into the record and out as events for the page to celebrate. */
  private unlockCheck(): void {
    for (const id of checkUnlocks(this.record)) this.events.push({ type: 'unlock', id });
  }

  // ---- Capsule eggs --------------------------------------------------------

  private openEgg(kind: EggKind, returnTo: 'shop' | 'map'): void {
    const items = eggContents(this.rng, kind, this.dayNum, this.ownedIds);
    this.egg = { kind, items, picksLeft: EGGS[kind].picks, cracked: false, returnTo };
    this.phase = 'egg';
  }

  crackEgg(): void {
    if (this.phase === 'egg' && this.egg) this.egg.cracked = true;
  }

  canTakeFromEgg(i: number): boolean {
    const item = this.egg?.items[i];
    return !!item && !(item.kind === 'attraction' && !this.canGain(item));
  }

  takeFromEgg(i: number): void {
    const egg = this.egg;
    if (this.phase !== 'egg' || !egg?.cracked || !this.canTakeFromEgg(i)) return;
    const [item] = egg.items.splice(i, 1);
    if (item.kind === 'attraction') this.gain(item);
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
}

function emptySpecials(): Record<SpecialId, number> {
  return { launch: 0, splash: 0, brakes: 0 };
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

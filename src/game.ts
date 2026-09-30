import { Rng, randomSeed } from './core/rng';
import {
  type Board,
  type Dir,
  type End,
  type SwipeResult,
  type TrackCell,
  build,
  buildTargets,
  canConnect,
  canShuttle,
  type Pt,
  cloneBoard,
  head,
  idx,
  isWall,
  resolveChains,
  step,
  swipe,
  trackCells,
} from './puzzle/board';
import { MAX_TIER, type RideStats, rideStats } from './puzzle/pieces';
import { type Rider, type Verdict, evaluate, makeRider } from './riders/riders';
import {
  type DayConfig,
  type Mods,
  type Reward,
  TOOLS,
  type ToolId,
  type UpgradeId,
  dayConfig,
  generateBoard,
  modsFor,
  rewardOffer,
} from './run/run';

export type Phase = 'build' | 'ride' | 'results' | 'reward' | 'over';
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
  verdict: Verdict;
  paid: number;
}

export interface DayResult {
  kind: RideKind;
  stats: RideStats;
  tickets: RiderTicket[];
  score: number;
  target: number;
  passed: boolean;
}

interface Snapshot {
  board: Board;
  queue: Rider[];
  daylight: number;
  actions: number;
  buzz: number;
  bestCombo: number;
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
 * The standing ride draws a crowd over time: each swipe adds excitement / BUZZ_PER
 * to a meter, and every full point brings a rider. Building early pays off in riders.
 */
const BUZZ_PER = 80;

export class Game {
  seed = '';
  rng = new Rng(0);
  dayNum = 1;
  hearts = HEARTS;
  runScore = 0;
  upgrades: UpgradeId[] = [];
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
  /** The track end that keyboard builds extend. */
  selected: End = 0;
  undos = 0;
  phase: Phase = 'build';
  result: DayResult | null = null;
  offer: Reward[] = [];
  best = loadBest();
  events: GameEvent[] = [];
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
    this.tools = { ...emptyTools(), paint: 1 };
    this.mods = modsFor([]);
    this.startDay();
  }

  private startDay(): void {
    this.cfg = dayConfig(this.dayNum, this.mods);
    this.board = generateBoard(this.cfg, this.rng);
    this.queue = [];
    for (let i = 0; i < this.cfg.startRiders; i++) this.queue.push(this.newRider());
    this.daylight = this.cfg.daylight;
    this.actions = 0;
    this.buzz = 0;
    this.bestCombo = 0;
    this.selected = 0;
    this.aiming = null;
    this.undos = this.mods.undos;
    this.history = [];
    this.result = null;
    this.phase = 'build';
    this.events.push({ type: 'day' });
  }

  private newRider(): Rider {
    return makeRider(this.rng, this.dayNum, this.nextId++);
  }

  /** Stats of the track as a full circuit. */
  get stats(): RideStats {
    return rideStats(trackCells(this.board), this.mods);
  }

  /** What opening right now would be: a circuit if the ends meet, else a shuttle. */
  get openKind(): RideKind | null {
    if (this.phase !== 'build') return null;
    if (canConnect(this.board)) return 'circuit';
    return canShuttle(this.board) ? 'shuttle' : null;
  }

  statsFor(kind: RideKind): RideStats {
    return rideStats(trackCells(this.board), this.mods, kind === 'shuttle');
  }

  predict(r: Rider): Verdict {
    return evaluate(r, this.stats, this.mods.toleranceBonus);
  }

  ticket(verdict: Verdict, excitement: number): number {
    if (verdict === 'happy') return excitement * this.mods.tipMult;
    if (verdict === 'sick') return Math.round(excitement / 2);
    return excitement;
  }

  /** Tickets if the ride opened now as `kind`. */
  projected(kind: RideKind): number {
    const s = this.statsFor(kind);
    return this.queue.reduce((a, r) => a + this.ticket(evaluate(r, this.stats, this.mods.toleranceBonus), s.excitement), 0);
  }

  private snapshot(): void {
    this.history.push({
      board: cloneBoard(this.board),
      queue: this.queue.map((r) => ({ ...r })),
      daylight: this.daylight,
      actions: this.actions,
      buzz: this.buzz,
      bestCombo: this.bestCombo,
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
    const result = swipe(this.board, dir, this.rng, { hillChance: this.mods.hillChance, spawns: this.mods.spawns });
    if (!result) {
      // Nothing moved, so nothing changed: drop the snapshot, spend no daylight.
      this.history.pop();
      this.events.push({ type: 'blocked' });
      return;
    }
    this.bestCombo = Math.max(this.bestCombo, result.mergeCount);
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
    // Crane: first tap picks a cell, second tap swaps it with another.
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
    this.events.push({ type: 'swipe', result: { dir: 'up', slides, merges: [], slid, chain, spawned: [], mergeCount } });
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
    this.buzz += this.stats.excitement / BUZZ_PER;
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
    this.board.opened = kind;
    this.finishDay(kind);
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
    this.selected = s.selected;
    this.tools = s.tools;
    this.aiming = null;
    this.rng.state = s.rngState;
    this.nextId = s.nextId;
    this.undos--;
    this.events.push({ type: 'undo' });
  }

  private finishDay(kind: RideKind): void {
    const stats = this.statsFor(kind);
    const tickets: RiderTicket[] = this.queue.map((rider) => {
      const verdict = evaluate(rider, this.stats, this.mods.toleranceBonus);
      return { rider, verdict, paid: this.ticket(verdict, stats.excitement) };
    });
    const score = tickets.reduce((a, t) => a + t.paid, 0);
    this.result = { kind, stats, tickets, score, target: this.cfg.target, passed: score >= this.cfg.target };
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
    this.runScore += this.result.score;
    if (!this.result.passed) this.hearts--;
    if (this.hearts <= 0) {
      this.phase = 'over';
      if (this.runScore > this.best) {
        this.best = this.runScore;
        saveBest(this.best);
      }
      return;
    }
    this.offer = rewardOffer(this.rng);
    this.phase = 'reward';
  }

  chooseReward(i: number): void {
    const r = this.offer[i];
    if (this.phase !== 'reward' || !r) return;
    if (r.kind === 'upgrade') {
      this.upgrades.push(r.id);
      this.mods = modsFor(this.upgrades);
    } else this.tools[r.id] += TOOLS[r.id].charges;
    this.dayNum++;
    this.startDay();
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

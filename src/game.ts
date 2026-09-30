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
  cloneBoard,
  head,
  step,
  swipe,
  trackCells,
} from './puzzle/board';
import { type RideStats, rideStats } from './puzzle/pieces';
import { type Rider, type Verdict, evaluate, makeRider } from './riders/riders';
import {
  type DayConfig,
  type Mods,
  type PerkId,
  dayConfig,
  generateBoard,
  modsFor,
  perkOffer,
} from './run/run';

export type Phase = 'build' | 'ride' | 'results' | 'perk' | 'over';
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
  | { type: 'undo' };

export interface RiderTicket {
  rider: Rider;
  verdict: Verdict;
  paid: number;
}

export interface DayResult {
  kind: RideKind | null;
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
  rngState: number;
  nextId: number;
}

const HEARTS = 3;
const BEST_KEY = 'loophole.bestScore';
/** A walk-in rider arrives every this many actions. */
const WALKIN_EVERY = 5;
/** Every time Excitement passes another multiple of this, word gets around. */
const BUZZ_STEP = 12;

export class Game {
  seed = '';
  rng = new Rng(0);
  dayNum = 1;
  hearts = HEARTS;
  runScore = 0;
  perks: PerkId[] = [];
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
  offer: PerkId[] = [];
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
    this.perks = [];
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
      rngState: this.rng.state,
      nextId: this.nextId,
    });
  }

  swipe(dir: Dir): void {
    if (this.phase !== 'build') return;
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
    this.checkBuzz();
    this.tick();
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

  /** A wilder ride draws more people. */
  private checkBuzz(): void {
    const level = Math.floor(this.stats.excitement / BUZZ_STEP);
    while (this.buzz < level) {
      this.buzz++;
      this.arrive('buzz');
    }
  }

  private tick(): void {
    this.actions++;
    this.daylight--;
    if (this.actions % WALKIN_EVERY === 0) this.arrive('walkin');
    if (this.daylight <= 0) {
      // Dusk: open whatever we have. Nothing built means nothing to ride.
      const kind = this.openKind;
      if (kind) this.open(kind, true);
      else this.finishDay(null);
    }
  }

  open(kind: RideKind | null = this.openKind, atDusk = false): void {
    if (this.phase !== 'build' || !kind) return;
    if (kind === 'circuit' && !canConnect(this.board)) return;
    if (kind === 'shuttle' && !canShuttle(this.board)) return;
    this.board.opened = kind;
    if (atDusk) this.events.push({ type: 'dark' });
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
    this.rng.state = s.rngState;
    this.nextId = s.nextId;
    this.undos--;
    this.events.push({ type: 'undo' });
  }

  private finishDay(kind: RideKind | null): void {
    const stats = this.statsFor(kind ?? 'shuttle');
    const tickets: RiderTicket[] = kind
      ? this.queue.map((rider) => {
          const verdict = evaluate(rider, this.stats, this.mods.toleranceBonus);
          return { rider, verdict, paid: this.ticket(verdict, stats.excitement) };
        })
      : this.queue.map((rider) => ({ rider, verdict: 'meh' as Verdict, paid: 0 }));
    const score = tickets.reduce((a, t) => a + t.paid, 0);
    this.result = { kind, stats, tickets, score, target: this.cfg.target, passed: score >= this.cfg.target };
    // Both play out on the board first; the renderer calls rideDone() after.
    this.phase = 'ride';
    if (kind) this.events.push({ type: 'open', kind });
    else this.events.push({ type: 'dark' });
  }

  /** Called by the renderer when the ride (or empty-dusk) animation ends. */
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
    this.offer = perkOffer(this.rng);
    this.phase = 'perk';
  }

  choosePerk(id: PerkId): void {
    if (this.phase !== 'perk') return;
    this.perks.push(id);
    this.mods = modsFor(this.perks);
    this.dayNum++;
    this.startDay();
  }
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

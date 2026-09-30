import { Rng, randomSeed } from './core/rng';
import {
  type Board,
  type Dir,
  type MoveResult,
  applyMove,
  cloneBoard,
  isStuck,
  layKind,
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

export type GameEvent =
  | { type: 'day' }
  | { type: 'move'; result: MoveResult }
  | { type: 'blocked'; dir: Dir }
  | { type: 'leave'; rider: Rider }
  | { type: 'arrive'; rider: Rider }
  | { type: 'close' }
  | { type: 'stuck' }
  | { type: 'hype'; amount: number }
  | { type: 'undo' };

export interface DayResult {
  stats: RideStats;
  verdicts: { rider: Rider; verdict: Verdict }[];
  happy: number;
  quota: number;
  stuck: boolean;
  passed: boolean;
}

interface Snapshot {
  board: Board;
  queue: Rider[];
  swipes: number;
  bestCombo: number;
  rngState: number;
  nextId: number;
}

const HEARTS = 3;
const BEST_KEY = 'loophole.best';

export class Game {
  seed = '';
  rng = new Rng(0);
  dayNum = 1;
  hearts = HEARTS;
  happyTotal = 0;
  perks: PerkId[] = [];
  mods: Mods = modsFor([]);
  cfg!: DayConfig;
  board!: Board;
  queue: Rider[] = [];
  swipes = 0;
  bestCombo = 0;
  undos = 0;
  phase: Phase = 'build';
  result: DayResult | null = null;
  offer: PerkId[] = [];
  best = loadBest();
  events: GameEvent[] = [];
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
    this.happyTotal = 0;
    this.perks = [];
    this.mods = modsFor([]);
    this.startDay();
  }

  private startDay(): void {
    this.cfg = dayConfig(this.dayNum, this.mods);
    this.board = generateBoard(this.cfg, this.rng);
    this.queue = [];
    for (let i = 0; i < this.cfg.startRiders; i++) this.queue.push(this.newRider());
    this.swipes = 0;
    this.bestCombo = 0;
    this.undos = this.mods.undos;
    this.history = [];
    this.result = null;
    this.phase = 'build';
    this.events.push({ type: 'day' });
  }

  private newRider(): Rider {
    return makeRider(this.rng, this.dayNum, this.nextId++, this.mods.patienceBonus);
  }

  get stats(): RideStats {
    return rideStats(this.board.path, this.mods);
  }

  predict(r: Rider): Verdict {
    return evaluate(r, this.stats, this.mods.toleranceBonus);
  }

  swipe(dir: Dir): void {
    if (this.phase !== 'build') return;
    if (!layKind(this.board, dir)) {
      this.events.push({ type: 'blocked', dir });
      return;
    }
    this.history.push({
      board: cloneBoard(this.board),
      queue: this.queue.map((r) => ({ ...r })),
      swipes: this.swipes,
      bestCombo: this.bestCombo,
      rngState: this.rng.state,
      nextId: this.nextId,
    });
    const result = applyMove(this.board, dir, this.rng, { hillChance: this.mods.hillChance, spawns: this.mods.spawns })!;
    this.events.push({ type: 'move', result });
    if (result.kind === 'close') {
      this.finishDay(false);
      return;
    }
    this.swipes++;
    this.bestCombo = Math.max(this.bestCombo, result.mergeCount);
    // Chain reactions entertain the queue: each link buys everyone a swipe.
    const hype = result.chain.waves.length;
    if (hype) {
      for (const r of this.queue) r.patience = Math.min(r.maxPatience, r.patience + hype);
      this.events.push({ type: 'hype', amount: hype });
    }
    for (const r of [...this.queue]) {
      r.patience--;
      if (r.patience <= 0) {
        this.queue.splice(this.queue.indexOf(r), 1);
        this.events.push({ type: 'leave', rider: r });
      }
    }
    if (this.swipes % this.mods.arrivalEvery === 0 && this.queue.length < this.cfg.maxQueue) {
      const r = this.newRider();
      this.queue.push(r);
      this.events.push({ type: 'arrive', rider: r });
    }
    if (isStuck(this.board)) this.finishDay(true);
  }

  undo(): void {
    if (this.phase !== 'build' || !this.undos || !this.history.length) return;
    const s = this.history.pop()!;
    this.board = s.board;
    this.queue = s.queue;
    this.swipes = s.swipes;
    this.bestCombo = s.bestCombo;
    this.rng.state = s.rngState;
    this.nextId = s.nextId;
    this.undos--;
    this.events.push({ type: 'undo' });
  }

  private finishDay(stuck: boolean): void {
    const stats = this.stats;
    const verdicts = stuck
      ? this.queue.map((rider) => ({ rider, verdict: 'meh' as Verdict }))
      : this.queue.map((rider) => ({ rider, verdict: evaluate(rider, stats, this.mods.toleranceBonus) }));
    const happy = verdicts.filter((v) => v.verdict === 'happy').length;
    this.result = { stats, verdicts, happy, quota: this.cfg.quota, stuck, passed: !stuck && happy >= this.cfg.quota };
    // Both play out on the board first; the renderer calls rideDone() after.
    this.phase = 'ride';
    this.events.push({ type: stuck ? 'stuck' : 'close' });
  }

  /** Called by the renderer when the ride (or dead-end) animation ends. */
  rideDone(): void {
    if (this.phase === 'ride') this.phase = 'results';
  }

  continueFromResults(): void {
    if (this.phase !== 'results' || !this.result) return;
    this.happyTotal += this.result.happy;
    if (!this.result.passed) this.hearts--;
    if (this.hearts <= 0) {
      this.phase = 'over';
      if (this.happyTotal > this.best) {
        this.best = this.happyTotal;
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

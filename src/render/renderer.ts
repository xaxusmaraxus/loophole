import type { Game } from '../game';
import {
  type Board,
  DELTA,
  type Dir,
  type Pt,
  type ChainStep,
  type End,
  type SwipeResult as MoveResult,
  type TrackCell,
  buildTargets,
  canConnect,
  head,
  isStation,
  isWall,
  stationPoint,
  rideOrder,
  trackAt,
  trackCells,
  trackLinks,
  idx,
  step,
} from '../puzzle/board';
import type { Rider } from '../riders/riders';
import { RideAnim } from '../ride/ride';
import { sfx } from '../core/sfx';
import { drawText, textWidth } from './font';
import { C, DECK, STATION_DECK } from './metrics';
import { PAL, type ParkTheme, THEMES, TIER_RAMPS } from './palette';
import {
  type Ctx,
  drawBubble,
  drawCrate,
  drawMystery,
  drawPerson,
  drawPond,
  drawRock,
  drawStand,
  drawStation,
  drawTree,
  hash,
  px,
} from './sprites';

const FRONT = 8;
const SLIDE_MS = 100;
const WAVE_MS = 170;
/** Pennant colors for the two track ends. */
const END_COLORS = ['#f0584e', '#45a8e0'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Word {
  text: string;
  x: number;
  y: number;
  life: number;
  max: number;
  color: string;
}

export interface Walker {
  look: Rider['look'];
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  sick?: boolean;
  mood?: 'happy' | 'meh' | 'sick' | 'angry';
  delay: number;
}

export class Renderer {
  readonly ctx: Ctx;
  W = 0;
  H = 0;
  scale = 1;
  onRideDone: () => void = () => {};
  private terrain: HTMLCanvasElement = document.createElement('canvas');
  private tileAnim: { start: number; move: MoveResult; fired: number } | null = null;
  private combo: { value: number; bumped: number; until: number } | null = null;
  private shake = { until: 0, mag: 0 };
  private comboEl = document.getElementById('combo');
  /** Plaza margins in cells; the station's side is deeper to fit the queue. */
  private margin = { l: 1, t: 1, r: 1, b: 1 };
  private flashes = new Map<number, number>();
  private particles: Particle[] = [];
  private words: Word[] = [];
  private walkers: Walker[] = [];
  private riderPos = new Map<number, { x: number; y: number; moving: boolean }>();
  private links = new Map<string, Pt[]>();
  private lamps: Pt[] = [];
  /** Cells the fog hides this frame (Haunted Hollow). */
  private fogged = new Set<number>();
  private ride: RideAnim | null = null;
  private now = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly game: Game,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.setupDay();
  }

  // ---- Geometry --------------------------------------------------------------

  cellX(x: number): number {
    return (this.margin.l + x) * C;
  }

  cellY(y: number): number {
    return (this.margin.t + y) * C;
  }

  center(p: Pt): Pt {
    return { x: this.cellX(p.x) + 8, y: this.cellY(p.y) + 9 };
  }

  private get board(): Board {
    return this.game.board;
  }

  private get theme(): ParkTheme {
    return THEMES[this.game.cfg.park.id];
  }

  /** In fog, only cells within two steps of the station or any track are visible. */
  private updateFog(): void {
    this.fogged.clear();
    const b = this.board;
    if (!this.game.cfg.park.fog || this.game.phase === 'ride' || this.game.phase === 'results') return;
    const seen = [stationPoint(b, 0), stationPoint(b, 1), ...trackCells(b)];
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++)
        if (!seen.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) <= 2)) this.fogged.add(idx(b, x, y));
  }

  /** Draws a tile crate, or a mystery crate if its cell is fogged. */
  private crate(tier: number, x: number, y: number, cell: Pt, flash = 0): void {
    if (this.fogged.has(idx(this.board, cell.x, cell.y))) drawMystery(this.ctx, x, y);
    else drawCrate(this.ctx, tier, x, y, flash);
  }

  /** Middle of the two-cell platform below the board. */
  stationCenter(): Pt {
    const c = this.center(this.board.station);
    return { x: c.x + 8, y: c.y };
  }

  /** Feet position of the i-th rider in the queue: a line below the platform, wrapping to a second row. */
  slot(i: number): Pt {
    const sc = this.stationCenter();
    const spacing = 10;
    const dir = this.W - sc.x > sc.x ? 1 : -1;
    const room = dir > 0 ? this.W - sc.x - 8 : sc.x - 8;
    const perRow = Math.max(1, Math.floor(room / spacing) + 1);
    const row = i < perRow ? 0 : 1;
    const k = row ? i - perRow : i;
    return { x: sc.x + dir * k * spacing - (row ? dir * 5 : 0), y: sc.y + 21 + row * 12 };
  }

  private sideDir(): Pt {
    return { x: Math.sign(this.slot(1).x - this.slot(0).x) || 1, y: 0 };
  }

  // ---- Setup -----------------------------------------------------------------

  private setupDay(): void {
    const n = this.board.size;
    // The platform takes the first row below the board; the queue stands below it.
    this.margin = { l: 1, t: 1, r: 1, b: 3 };
    this.W = (n + this.margin.l + this.margin.r) * C;
    this.H = (n + this.margin.t + this.margin.b) * C + FRONT;
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.buildTerrain();
    this.tileAnim = null;
    this.combo = null;
    this.ride = null;
    this.walkers = [];
    this.particles = [];
    this.words = [];
    this.riderPos.clear();
    const side = this.sideDir();
    this.game.queue.forEach((r, i) => {
      const s = this.slot(i);
      this.riderPos.set(r.id, { x: s.x + side.x * (40 + i * 12), y: s.y + side.y * (40 + i * 12), moving: true });
    });
    this.fit();
  }

  fit(): void {
    const area = this.canvas.closest('.park') ?? this.canvas.parentElement!;
    const availW = area.clientWidth;
    // Leave room for the controls below and the attraction strip and banner above.
    const above = ['attractions', 'dayBanner'].reduce((h, id) => h + (document.getElementById(id)?.offsetHeight ?? 0), 0);
    const reserved = (document.fullscreenElement ? 200 : 250) + above;
    const availH = Math.max(260, window.innerHeight - reserved);
    // Fractional scales are fine: the canvas is upscaled with nearest-neighbor.
    this.scale = Math.max(1, Math.min(availW / this.W, availH / this.H));
    this.canvas.style.width = `${this.W * this.scale}px`;
    this.canvas.style.height = `${this.H * this.scale}px`;
  }

  private buildTerrain(): void {
    const b = this.board;
    const t = this.terrain;
    t.width = this.W;
    t.height = this.H;
    const ctx = t.getContext('2d')!;
    const day = this.game.dayNum + this.game.seed.charCodeAt(0);
    const ground = this.H - FRONT;
    const th = this.theme;
    px(ctx, 0, 0, this.W, ground, th.plaza[1]);
    if (th.plazaStyle === 'planks') {
      // Boardwalk: long planks with staggered seams and nail heads.
      for (let y = 0; y < ground; y += 5) {
        px(ctx, 0, y, this.W, 1, th.plaza[2]);
        const off = Math.floor(hash(day, y) * 20);
        for (let x = off; x < this.W; x += 24) {
          px(ctx, x, y, 1, 5, th.plaza[2]);
          if (hash(day, x, y) < 0.3) px(ctx, x + 1, y + 1, 22, 4, th.plaza[0]);
          px(ctx, x + 2, y + 2, 1, 1, th.plaza[3]);
        }
      }
    } else {
      // Pavers.
      for (let y = 0; y < ground; y += 8)
        for (let x = 0; x < this.W; x += 8) {
          const off = (y / 8) % 2 ? 4 : 0;
          const v = hash(day, x, y);
          if (v < 0.12) px(ctx, x + off, y, 8, 8, th.plaza[0]);
          px(ctx, x + off, y, 8, 1, th.plaza[2]);
          px(ctx, x + off, y, 1, 8, th.plaza[2]);
        }
    }
    // Diorama front: the park is a little slab of earth.
    px(ctx, 0, ground, this.W, FRONT, PAL.dirt[1]);
    px(ctx, 0, ground, this.W, 2, PAL.plaza[3]);
    px(ctx, 0, ground + 5, this.W, 3, PAL.dirt[2]);
    for (let x = 0; x < this.W; x += 3) if (hash(day, x, 99) < 0.3) px(ctx, x, ground + 3 + Math.floor(hash(x, day) * 4), 2, 1, PAL.dirt[0]);
    // Grass plot.
    const bx = this.cellX(0);
    const by = this.cellY(0);
    const bw = b.size * C;
    px(ctx, bx - 1, by - 1, bw + 2, bw + 4, th.grass[3]);
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) px(ctx, bx + x * C, by + y * C, C, C, (x + y) % 2 ? th.grass[1] : th.grass[2]);
    px(ctx, bx, by + bw, bw, 2, PAL.dirt[1]);
    for (let y = 0; y < bw; y++)
      for (let x = 0; x < bw; x++) {
        const v = hash(day, x + 300, y + 300);
        if (v < 0.04) px(ctx, bx + x, by + y, 1, 1, th.grass[0]);
        else if (v < 0.07) px(ctx, bx + x, by + y, 1, 1, th.grass[3]);
        else if (v < 0.074) px(ctx, bx + x, by + y, 1, 1, hash(x, y) < 0.5 ? PAL.gold : PAL.heart);
      }
    // Sand or mud patches: soft edges, speckles.
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        if (!b.soft[idx(b, x, y)]) continue;
        const cx = bx + x * C;
        const cy = by + y * C;
        px(ctx, cx + 1, cy + 1, C - 2, C - 2, th.soft[1]);
        px(ctx, cx, cy + 3, C, C - 6, th.soft[1]);
        px(ctx, cx + 3, cy, C - 6, C, th.soft[1]);
        for (let k = 0; k < 14; k++) {
          const sx = Math.floor(hash(day, x * 31 + k, y) * 14) + 1;
          const sy = Math.floor(hash(day, y * 17 + k, x) * 14) + 1;
          px(ctx, cx + sx, cy + sy, 1, 1, k % 3 ? th.soft[2] : th.soft[0]);
        }
      }
    // A few lamp posts on the plaza corners.
    this.lamps = [];
    for (const [lx, ly] of [
      [6, 10],
      [this.W - 8, 10],
      [6, ground - 6],
      [this.W - 8, ground - 6],
    ]) {
      this.lamps.push({ x: lx, y: ly - 10 });
      px(ctx, lx, ly - 9, 1, 10, PAL.ink);
      px(ctx, lx - 1, ly - 11, 3, 2, PAL.gold);
      px(ctx, lx - 1, ly + 1, 3, 1, PAL.shadow);
    }
  }

  // ---- Events ----------------------------------------------------------------

  handleEvents(): void {
    for (const e of this.game.events.splice(0)) {
      switch (e.type) {
        case 'day':
          this.setupDay();
          break;
        case 'swipe':
          this.tileAnim = { start: this.now, move: e.result, fired: -1 };
          this.combo = null;
          break;
        case 'build': {
          const c = this.center(e.laid);
          this.dust(c.x, c.y, 8, PAL.plaza[2]);
          this.flashes.set(idx(this.board, e.laid.x, e.laid.y), this.now + 150);
          sfx.lay();
          break;
        }
        case 'blocked':
          this.shake = { until: this.now + 90, mag: 1 };
          sfx.blocked();
          break;
        case 'arrive': {
          const s = this.slot(this.game.queue.indexOf(e.rider));
          const side = this.sideDir();
          this.riderPos.set(e.rider.id, { x: s.x + side.x * 60, y: s.y + side.y * 60, moving: true });
          if (e.reason !== 'walkin') this.word(e.reason === 'chain' ? 'WOW' : 'OOH', s.x, s.y - 24, PAL.gold);
          break;
        }
        case 'undo':
          this.tileAnim = null;
          break;
        case 'open':
          sfx.open();
          this.startRide();
          break;
        case 'dark': {
          const sc = this.stationCenter();
          this.word('SUNSET', sc.x, sc.y - 24, PAL.gold);
          sfx.meh();
          break;
        }
        case 'tool': {
          const at = e.at ? this.center(e.at) : this.stationCenter();
          if (e.tool === 'dynamite') {
            this.burst(at.x, at.y - 4, 22, [PAL.gold, PAL.red, PAL.rock[1]]);
            this.word('BOOM', at.x, at.y - 18, PAL.gold);
            this.shake = { until: this.now + 260, mag: 3 };
            sfx.blocked();
            sfx.chain(1);
          } else if (e.tool === 'paint' && e.at) {
            this.flashes.set(idx(this.board, e.at.x, e.at.y), this.now + 200);
            this.burst(at.x, at.y - 4, 10, [PAL.heart, PAL.gold, PAL.white]);
            sfx.merge(3);
          } else if (e.tool === 'coffee') {
            this.word('+5 SWIPES', at.x, at.y - 24, PAL.gold);
            sfx.hype();
          } else if (e.tool === 'megaphone') {
            this.word('COME RIDE!', at.x, at.y - 24, PAL.white);
            sfx.open();
          } else sfx.lay();
          break;
        }
      }
    }
  }

  /** Board cell under a page coordinate, or null. */
  cellAt(clientX: number, clientY: number): Pt | null {
    const r = this.canvas.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * this.W;
    const py = ((clientY - r.top) / r.height) * this.H;
    const x = Math.floor(px / C) - this.margin.l;
    const y = Math.floor(py / C) - this.margin.t;
    return x >= 0 && y >= 0 && x < this.board.size && y < this.board.size ? { x, y } : null;
  }

  private startRide(): void {
    const result = this.game.result!;
    const sc = this.stationCenter();
    if (!result.kind) return;
    // Riders walk onto the platform, then the train leaves.
    this.game.queue.forEach((r, i) => {
      const p = this.riderPos.get(r.id);
      if (!p) return;
      this.walkers.push({ look: r.look, x: p.x, y: p.y, tx: sc.x, ty: sc.y, speed: 45, delay: i * 70 });
    });
    this.riderPos.clear();
    this.ride = new RideAnim(this, rideOrder(this.board, result.kind), result, this.game, this.now + 900);
  }

  // ---- Effects ---------------------------------------------------------------

  dust(x: number, y: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ x, y, vx: Math.cos(a) * 20, vy: Math.sin(a) * 12 - 10, g: 30, life: 0, max: 0.4, color, size: 1 });
    }
  }

  burst(x: number, y: number, n: number, ramp: readonly string[]): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const v = 30 + Math.random() * 30;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - 15, g: 60, life: 0, max: 0.5 + Math.random() * 0.3, color: ramp[i % 3], size: i % 4 === 0 ? 2 : 1 });
    }
  }

  puke(x: number, y: number): void {
    for (let i = 0; i < 8; i++)
      this.particles.push({ x, y, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 20, g: 120, life: 0, max: 0.7, color: i % 2 ? PAL.sick : '#6fae2e', size: 1 });
  }

  hat(x: number, y: number, color: string): void {
    this.particles.push({ x, y, vx: (Math.random() - 0.5) * 40, vy: -50, g: 90, life: 0, max: 1.3, color, size: 2 });
  }

  heart(x: number, y: number): void {
    this.particles.push({ x, y, vx: 0, vy: -14, g: 0, life: 0, max: 0.9, color: PAL.heart, size: 2 });
  }

  word(text: string, x: number, y: number, color: string): void {
    const w = textWidth(text);
    const cx = Math.max(2, Math.min(this.W - w - 2, x - w / 2));
    this.words.push({ text, x: cx, y: Math.max(8, y), life: 0, max: 1.1, color });
  }

  addWalker(w: Walker): void {
    this.walkers.push(w);
  }

  // ---- Frame -----------------------------------------------------------------

  frame(now: number): void {
    const dt = Math.min(0.05, (now - this.now) / 1000 || 0);
    this.now = now;
    this.handleEvents();
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = PAL.plaza[1];
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    if (now < this.shake.until) {
      const m = this.shake.mag;
      ctx.translate(Math.round((Math.random() - 0.5) * 2 * m), Math.round((Math.random() - 0.5) * 2 * m));
    }
    this.fireTileEffects();
    this.updateFog();
    ctx.drawImage(this.terrain, 0, 0);

    const behind = (y: number) => y < this.cellY(0) + 4;
    this.drawQueue(dt, behind);
    this.drawTrackShadows();
    this.drawRows();
    this.drawSlidingTiles();
    this.drawTargets();
    this.drawQueue(0, (y) => !behind(y));
    this.updateWalkers(dt);
    if (this.ride) {
      this.ride.update(now, dt);
      this.ride.draw(ctx, now);
      if (this.ride.finished(now)) {
        this.ride = null;
        this.onRideDone();
      }
    }
    if (this.theme.tint) {
      ctx.fillStyle = this.theme.tint;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    this.drawDusk();
    this.drawParticles(dt);
    this.drawCombo();
    ctx.restore();
  }

  /** Late in the day the light warms up, then turns to dusk and the lamps come on. */
  private drawDusk(): void {
    const frac = this.game.daylight / this.game.cfg.daylight;
    const ctx = this.ctx;
    if (frac < 0.6 && frac >= 0.3) {
      ctx.fillStyle = `rgba(255, 150, 70, ${((0.6 - frac) / 0.3) * 0.12})`;
      ctx.fillRect(0, 0, this.W, this.H);
    } else if (frac < 0.3) {
      const k = Math.min(1, (0.3 - frac) / 0.3);
      ctx.fillStyle = `rgba(255, 150, 70, ${0.12 * (1 - k)})`;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.fillStyle = `rgba(40, 30, 100, ${0.1 + k * 0.28})`;
      ctx.fillRect(0, 0, this.W, this.H);
      for (const l of this.lamps) {
        ctx.fillStyle = `rgba(255, 220, 120, ${0.18 + k * 0.2})`;
        ctx.beginPath();
        ctx.arc(l.x, l.y, 7, 0, Math.PI * 2);
        ctx.fill();
        px(ctx, l.x - 1, l.y - 1, 3, 2, '#fff3b0');
      }
    }
  }

  private drawTrackShadows(): void {
    const b = this.board;
    for (const c of trackCells(b)) {
      const p = this.center(c);
      px(this.ctx, p.x - 5, p.y + 1, 11, 3, PAL.shadow);
    }
  }

  private drawRows(): void {
    const b = this.board;
    const ctx = this.ctx;
    const anim = this.tileAnim !== null;
    const dayKey = this.game.dayNum * 131 + this.game.seed.charCodeAt(1);
    this.links = trackLinks(b);
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        const cx = this.cellX(x);
        const cy = this.cellY(y);
        const ob = b.obstacles[idx(b, x, y)];
        if (ob === 'tree') drawTree(ctx, cx, cy, dayKey + x * 7 + y * 13);
        else if (ob === 'rock') drawRock(ctx, cx, cy, dayKey + x + y * 5);
        else if (ob === 'pond') drawPond(ctx, cx, cy, this.now);
        else if (ob === 'stand') drawStand(ctx, cx, cy);
        const tc = trackAt(b, x, y);
        if (tc) this.drawTrackCell(tc);
        const tier = b.tiles[idx(b, x, y)];
        if (tier && !anim) this.crate(tier, cx, cy, { x, y }, this.flashAt(idx(b, x, y)));
      }
    // The platform sits in front of the board's bottom edge.
    drawStation(ctx, this.cellX(b.station.x), this.cellY(b.station.y));
    this.drawStationTrack();
  }

  private animLength(m: MoveResult): number {
    return SLIDE_MS + m.chain.waves.length * WAVE_MS;
  }

  /** Slide, then each chain wave in turn: the grabbed tile flies into the merged one. */
  private drawSlidingTiles(): void {
    const a = this.tileAnim;
    if (!a) return;
    const el = this.now - a.start;
    const m = a.move;
    const b = this.board;
    const ease = (t: number) => 1 - (1 - t) * (1 - t);
    if (el < SLIDE_MS) {
      const e = ease(el / SLIDE_MS);
      for (const s of m.slides) {
        const x = this.cellX(s.from.x) + (this.cellX(s.to.x) - this.cellX(s.from.x)) * e;
        const y = this.cellY(s.from.y) + (this.cellY(s.to.y) - this.cellY(s.from.y)) * e;
        this.crate(s.tier, x, y, s.to);
      }
      return;
    }
    const k = Math.floor((el - SLIDE_MS) / WAVE_MS);
    const e = ease(((el - SLIDE_MS) % WAVE_MS) / (WAVE_MS * 0.6));
    const base = k === 0 ? m.slid : m.chain.frames[k - 1];
    const wave: ChainStep[] = m.chain.waves[k] ?? [];
    const busy = new Set(wave.flatMap((w) => [idx(b, w.from.x, w.from.y), idx(b, w.to.x, w.to.y)]));
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        const i = idx(b, x, y);
        if (base[i] && !busy.has(i)) this.crate(base[i], this.cellX(x), this.cellY(y), { x, y }, this.flashAt(i));
      }
    for (const w of wave) {
      this.crate(w.tier - 1, this.cellX(w.to.x), this.cellY(w.to.y), w.to);
      const t = Math.min(1, e);
      const x = this.cellX(w.from.x) + (this.cellX(w.to.x) - this.cellX(w.from.x)) * t;
      const y = this.cellY(w.from.y) + (this.cellY(w.to.y) - this.cellY(w.from.y)) * t - Math.sin(t * Math.PI) * 5;
      this.crate(w.tier - 1, x, y, w.to);
    }
  }

  private flashAt(i: number): number {
    const until = this.flashes.get(i) ?? 0;
    return until > this.now ? Math.min(1, (until - this.now) / 160) : 0;
  }

  /** Fires sounds, bursts and the combo counter as the animation reaches each stage. */
  private fireTileEffects(): void {
    const a = this.tileAnim;
    if (!a) return;
    const m = a.move;
    const el = this.now - a.start;
    const stage = el < SLIDE_MS ? -1 : Math.min(m.chain.waves.length, Math.floor((el - SLIDE_MS) / WAVE_MS) + 1);
    // Retire a finished animation here, before anything is drawn this frame, so
    // the board draws its static tiles instead of skipping them for a frame.
    const done = el >= this.animLength(m);
    while (a.fired < stage) {
      a.fired++;
      const b = this.board;
      if (a.fired === 0) {
        // Slide merges land.
        m.merges.forEach((mg, i) => {
          this.flashes.set(idx(b, mg.x, mg.y), this.now + 160);
          const c = this.center(mg);
          this.dust(c.x, c.y - 4, 6, TIER_RAMPS[mg.tier][0]);
          sfx.merge(i + 1);
        });
        if (m.merges.length) this.bumpCombo(m.merges.length);
        if (!m.chain.waves.length) this.finishMove(m);
      } else {
        // Chain wave lands: bigger each link.
        const wave = m.chain.waves[a.fired - 1];
        const link = a.fired;
        for (const w of wave) {
          this.flashes.set(idx(b, w.to.x, w.to.y), this.now + 200);
          const c = this.center(w.to);
          this.burst(c.x, c.y - 4, 8 + link * 4, TIER_RAMPS[w.tier]);
        }
        this.word(`CHAIN ${link + 1}`, this.center(wave[0].to).x, this.center(wave[0].to).y - 18, PAL.gold);
        this.shake = { until: this.now + 140 + link * 40, mag: Math.min(3, link) };
        sfx.chain(m.merges.length + link);
        this.bumpCombo((this.combo?.value ?? m.merges.length) + wave.length);
        if (a.fired === m.chain.waves.length) this.finishMove(m);
      }
    }
    if (done) this.tileAnim = null;
  }

  private finishMove(m: MoveResult): void {
    for (const s of m.spawned) this.flashes.set(idx(this.board, s.x, s.y), this.now + 140);
    for (const k of m.sunk) {
      const c = this.center(k);
      this.dust(c.x, c.y + 2, 6, this.theme.soft[2]);
      if (!k.tier) this.word('GLUB', c.x, c.y - 14, this.theme.soft[0]);
    }
    if (m.sunk.length) sfx.meh();
    if (m.chain.waves.length) sfx.hype();
  }

  private bumpCombo(value: number): void {
    if (value < 2) return;
    this.combo = { value, bumped: this.now, until: this.now + 900 + value * 120 };
    const el = this.comboEl;
    if (!el) return;
    el.textContent = `${value >= 6 ? 'Mega' : 'Combo'} ×${value}`;
    el.dataset.level = value >= 6 ? 'mega' : value >= 4 ? 'big' : 'small';
    el.classList.remove('pop');
    void el.offsetWidth; // restart the pop animation
    el.classList.add('pop');
  }

  /** The combo counter is page text over the canvas, so it stays crisp at any size. */
  private drawCombo(): void {
    const el = this.comboEl;
    if (!el) return;
    const c = this.combo;
    const visible = !!c && this.now < c.until;
    el.classList.toggle('show', visible);
    if (!c || !visible) return;
    const cx = this.cellX(0) + (this.board.size * C) / 2;
    const cy = this.cellY(0) + (this.board.size * C) / 2;
    el.style.left = `${cx * this.scale}px`;
    el.style.top = `${cy * this.scale}px`;
    // Size to the board so the counter never spills outside the park.
    const k = c.value >= 6 ? 0.17 : c.value >= 4 ? 0.15 : 0.13;
    el.style.fontSize = `${Math.round(this.board.size * C * this.scale * k)}px`;
  }

  // ---- Track -----------------------------------------------------------------

  private deckAt(p: Pt): number {
    const b = this.board;
    if (isStation(b, p)) return STATION_DECK;
    const c = trackAt(b, p.x, p.y);
    return c ? DECK[c.tier] : 0;
  }

  private dirBetween(a: Pt, b: Pt): Pt {
    return { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
  }

  private linksOf(p: Pt): Pt[] {
    return this.links.get(`${p.x},${p.y}`) ?? [];
  }

  private drawStationTrack(): void {
    const b = this.board;
    const [a, c] = [stationPoint(b, 0), stationPoint(b, 1)];
    const [ca, cc] = [this.center(a), this.center(c)];
    // Platform rails between the two cells, then each side's link up into the park.
    this.halfSegment(ca, STATION_DECK, { x: 1, y: 0 }, STATION_DECK, 0);
    this.halfSegment(cc, STATION_DECK, { x: -1, y: 0 }, STATION_DECK, 0);
    for (const [p, cp] of [
      [a, ca],
      [c, cc],
    ] as const)
      for (const q of this.linksOf(p)) this.halfSegment(cp, STATION_DECK, this.dirBetween(p, q), (STATION_DECK + this.deckAt(q)) / 2, 0);
  }

  private drawTrackCell(cell: TrackCell): void {
    const ctx = this.ctx;
    const h = DECK[cell.tier];
    const c = this.center(cell);
    // Supports: timber for low track, steel lattice for tall pieces.
    if (h >= 5) {
      px(ctx, c.x - 3, c.y - h + 2, 1, h + 1, PAL.steel);
      px(ctx, c.x + 3, c.y - h + 2, 1, h + 1, PAL.steel);
      for (let k = 0; k < h; k += 3) px(ctx, c.x - 2, c.y - h + 3 + k, 5, 1, '#6b7496');
    } else {
      px(ctx, c.x - 1, c.y - h + 2, 2, h + 1, PAL.wood);
    }
    const links = this.linksOf(cell);
    for (const q of links) this.halfSegment(c, h, this.dirBetween(cell, q), (h + this.deckAt(q)) / 2, cell.tier);
    this.drawElement(c, h, cell.tier);
  }

  private halfSegment(c: Pt, h0: number, d: Pt, h1: number, tier: number): void {
    const ctx = this.ctx;
    const ramp = TIER_RAMPS[tier];
    for (let i = 0; i <= 8; i++) {
      const h = Math.round(h0 + (h1 - h0) * (i / 8));
      if (d.x !== 0) {
        const x = c.x + d.x * i;
        const y = c.y - h;
        if (i % 2 === 0) px(ctx, x, y - 2, 1, 5, PAL.tie);
        px(ctx, x, y - 2, 1, 1, ramp[0]);
        px(ctx, x, y + 2, 1, 1, ramp[1]);
        px(ctx, x, y + 3, 1, 1, ramp[3]);
      } else {
        const y = c.y + d.y * i - h;
        if (i % 2 === 0) px(ctx, c.x - 2, y, 5, 1, PAL.tie);
        px(ctx, c.x - 2, y, 1, 1, ramp[0]);
        px(ctx, c.x + 2, y, 1, 1, ramp[1]);
        px(ctx, c.x + 3, y, 1, 1, ramp[3]);
      }
    }
  }

  /** Loops, corkscrews and helixes rise above their cell. */
  private drawElement(c: Pt, h: number, tier: number): void {
    const ramp = TIER_RAMPS[tier];
    const ring = (cx: number, cy: number, rx: number, ry: number, thick: boolean) => {
      for (let a = 0; a < Math.PI * 2; a += 0.12) {
        const x = cx + Math.sin(a) * rx;
        const y = cy - Math.cos(a) * ry;
        px(this.ctx, x, y, 1, 1, ramp[1]);
        if (thick) px(this.ctx, x, y + 1, 1, 1, ramp[3]);
      }
    };
    if (tier === 4) ring(c.x, c.y - h, 6, 3, true);
    else if (tier === 5) ring(c.x, c.y - h - 6, 5, 6, true);
    else if (tier === 6) {
      ring(c.x - 3, c.y - h - 4, 3, 4, true);
      ring(c.x + 3, c.y - h - 5, 3, 5, true);
    } else if (tier === 7) {
      ring(c.x, c.y - h - 8, 7, 8, true);
      ring(c.x, c.y - h - 8, 5, 6, false);
    }
  }

  // ---- Build targets and track ends -----------------------------------------

  private drawTargets(): void {
    if (this.game.phase !== 'build') return;
    const b = this.board;
    const ctx = this.ctx;
    const blink = Math.floor(this.now / 300) % 2 === 0;
    const sel = this.game.selected;
    const corners = (x: number, y: number, col: string) => {
      for (const [cx, cy, w, hh] of [
        [x, y, 4, 1], [x, y, 1, 4], [x + 12, y, 4, 1], [x + 15, y, 1, 4],
        [x, y + 15, 4, 1], [x, y + 12, 1, 4], [x + 12, y + 15, 4, 1], [x + 15, y + 12, 1, 4],
      ])
        px(ctx, cx, cy, w, hh, col);
    };
    const aim = this.game.aiming;
    if (aim) {
      this.drawAimTargets(aim, corners, blink);
      return;
    }
    const targets = buildTargets(b);
    // The other end's targets first, so the selected end's gold corners win on shared cells.
    for (const t of targets.filter((t) => t.end !== sel)) corners(this.cellX(t.x), this.cellY(t.y), END_COLORS[t.end]);
    for (const t of targets.filter((t) => t.end === sel)) corners(this.cellX(t.x), this.cellY(t.y), blink ? PAL.gold : PAL.white);
    // Pennants mark each open end; the selected one waves.
    for (const end of [0, 1] as End[]) {
      const h = head(b, end);
      const c = this.center(h);
      const wave = end === sel && blink ? 1 : 0;
      const ox = end === 0 ? -5 : 3;
      const top = c.y - this.deckAt(h) - 12;
      px(ctx, c.x + ox, top, 1, 9, PAL.ink);
      px(ctx, c.x + ox + 1, top + wave, 4, 3, END_COLORS[end]);
      px(ctx, c.x + ox + 1, top + 1 + wave, 2, 1, PAL.white);
    }
    if (canConnect(b)) {
      const [a, c] = [this.center(head(b, 0)), this.center(head(b, 1))];
      drawText(ctx, 'GO!', (a.x + c.x) / 2 - 5, Math.min(a.y, c.y) - 26 + (blink ? 0 : -1), PAL.gold, PAL.ink);
    }
  }

  private drawAimTargets(aim: NonNullable<Game['aiming']>, corners: (x: number, y: number, col: string) => void, blink: boolean): void {
    const b = this.board;
    const col = blink ? PAL.heart : PAL.white;
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        const i = idx(b, x, y);
        const tile = b.tiles[i];
        const wall = isWall(b, x, y);
        const ok =
          aim.tool === 'dynamite' ? !!b.obstacles[i] : aim.tool === 'paint' ? !!tile && tile < 7 && !wall : aim.first ? !wall : !!tile && !wall;
        if (ok) corners(this.cellX(x), this.cellY(y), col);
      }
    if (aim.first) {
      const x = this.cellX(aim.first.x);
      const y = this.cellY(aim.first.y);
      px(this.ctx, x, y, 16, 1, PAL.gold);
      px(this.ctx, x, y + 15, 16, 1, PAL.gold);
      px(this.ctx, x, y, 1, 16, PAL.gold);
      px(this.ctx, x + 15, y, 1, 16, PAL.gold);
    }
  }

  // ---- People ----------------------------------------------------------------

  private drawQueue(dt: number, include: (y: number) => boolean): void {
    if (this.game.phase !== 'build' && this.game.phase !== 'intro') return;
    const queue = this.game.queue;
    const order = queue.map((r, i) => ({ r, i })).sort((a, b) => this.slot(a.i).y - this.slot(b.i).y);
    for (const { r, i } of order) {
      const target = this.slot(i);
      let p = this.riderPos.get(r.id);
      if (!p) {
        p = { ...target, moving: false };
        this.riderPos.set(r.id, p);
      }
      if (dt > 0) {
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dist = Math.hypot(dx, dy);
        const stepLen = 50 * dt;
        p.moving = dist > 0.5;
        if (dist <= stepLen) {
          p.x = target.x;
          p.y = target.y;
        } else {
          p.x += (dx / dist) * stepLen;
          p.y += (dy / dist) * stepLen;
        }
      }
      if (!include(p.y)) continue;
      const stepFrame = p.moving ? 1 + (Math.floor(this.now / 120) % 2) : 0;
      drawPerson(this.ctx, r.look, p.x, p.y, { step: stepFrame });
      if (this.game.phase === 'build' && !p.moving) {
        const mood = this.game.pukes(r) > 0 ? 'sick' : 'meh';
        const top = p.y - (r.look.big ? 22 : r.look.small ? 9 : 11) - 2;
        drawBubble(this.ctx, mood, p.x, top);
      }
    }
  }

  private updateWalkers(dt: number): void {
    const ctx = this.ctx;
    this.walkers.sort((a, b) => a.y - b.y);
    for (const w of this.walkers) {
      if (w.delay > 0) {
        w.delay -= dt * 1000;
        drawPerson(ctx, w.look, w.x, w.y, { sick: w.sick });
        continue;
      }
      const dx = w.tx - w.x;
      const dy = w.ty - w.y;
      const dist = Math.hypot(dx, dy);
      const s = w.speed * dt;
      if (dist <= s) {
        w.x = w.tx;
        w.y = w.ty;
      } else {
        w.x += (dx / dist) * s;
        w.y += (dy / dist) * s;
      }
      drawPerson(ctx, w.look, w.x, w.y, { step: 1 + (Math.floor(this.now / 120) % 2), sick: w.sick });
      if (w.mood) drawBubble(ctx, w.mood, w.x, w.y - (w.look.big ? 22 : w.look.small ? 9 : 11) - 2);
    }
    this.walkers = this.walkers.filter(
      (w) => !(w.x === w.tx && w.y === w.ty) && w.x > -20 && w.y > -20 && w.x < this.W + 20 && w.y < this.H + 20,
    );
  }

  private drawParticles(dt: number): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      p.life += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      px(ctx, p.x, p.y, p.size, p.size, p.color);
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const w of this.words) {
      w.life += dt;
      const rise = Math.min(1, w.life / 0.3) * 6;
      if (w.life < w.max) drawText(ctx, w.text, w.x, w.y - rise, w.color, PAL.ink);
    }
    this.words = this.words.filter((w) => w.life < w.max);
  }
}

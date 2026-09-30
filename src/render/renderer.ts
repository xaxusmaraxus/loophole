import type { Game } from '../game';
import {
  type Board,
  DELTA,
  type Dir,
  type Pt,
  type SlideMove,
  idx,
  layKind,
  step,
} from '../puzzle/board';
import type { Rider } from '../riders/riders';
import { RideAnim } from '../ride/ride';
import { drawText, textWidth } from './font';
import { C, DECK, STATION_DECK } from './metrics';
import { PAL, TIER_RAMPS } from './palette';
import {
  type Ctx,
  drawBubble,
  drawCrate,
  drawPerson,
  drawPond,
  drawRock,
  drawStand,
  drawStation,
  drawTree,
  hash,
  px,
} from './sprites';

const M = 2;
const FRONT = 8;
const SLIDE_MS = 100;

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
  private tileAnim: { start: number; slides: SlideMove[] } | null = null;
  private flashes = new Map<number, number>();
  private particles: Particle[] = [];
  private words: Word[] = [];
  private walkers: Walker[] = [];
  private riderPos = new Map<number, { x: number; y: number; moving: boolean }>();
  private blocked: { at: Pt; t: number } | null = null;
  private ride: RideAnim | null = null;
  private now = 0;
  private stuckUntil = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly game: Game,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.setupDay();
  }

  // ---- Geometry --------------------------------------------------------------

  cellX(x: number): number {
    return (M + x) * C;
  }

  cellY(y: number): number {
    return (M + y) * C;
  }

  center(p: Pt): Pt {
    return { x: this.cellX(p.x) + 8, y: this.cellY(p.y) + 9 };
  }

  private get board(): Board {
    return this.game.board;
  }

  private outward(): Pt {
    const { station: s, size: n } = this.board;
    if (s.y === 0) return { x: 0, y: -1 };
    if (s.y === n - 1) return { x: 0, y: 1 };
    if (s.x === 0) return { x: -1, y: 0 };
    return { x: 1, y: 0 };
  }

  /** Feet position of the i-th rider in the queue. */
  slot(i: number): Pt {
    const o = this.outward();
    const sc = this.center(this.board.station);
    const vertical = o.y !== 0;
    const spacing = vertical ? 10 : 21;
    const along = vertical ? sc.x : sc.y;
    const limit = vertical ? this.W : this.H - FRONT;
    const dir = limit - along > along ? 1 : -1;
    const room = dir > 0 ? limit - along - 6 : along - 10;
    const perRow = Math.max(1, Math.floor(room / spacing) + 1);
    const row = i < perRow ? 0 : 1;
    const k = row ? i - perRow : i;
    const depth = 17 + row * 14;
    return vertical
      ? { x: sc.x + dir * k * spacing, y: sc.y + 4 + o.y * depth }
      : { x: sc.x + o.x * (depth - 3 + row * -3), y: sc.y + 4 + dir * k * spacing };
  }

  private sideDir(): Pt {
    const o = this.outward();
    const s = this.slot(1);
    const s0 = this.slot(0);
    return o.y !== 0 ? { x: Math.sign(s.x - s0.x) || 1, y: 0 } : { x: 0, y: Math.sign(s.y - s0.y) || 1 };
  }

  // ---- Setup -----------------------------------------------------------------

  private setupDay(): void {
    const n = this.board.size;
    this.W = (n + M * 2) * C;
    this.H = this.W + FRONT;
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.buildTerrain();
    this.tileAnim = null;
    this.ride = null;
    this.stuckUntil = 0;
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
    const availH = Math.max(240, window.innerHeight - 140);
    this.scale = Math.max(1, Math.floor(Math.min(availW / this.W, availH / this.H)));
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
    // Plaza pavers.
    px(ctx, 0, 0, this.W, ground, PAL.plaza[1]);
    for (let y = 0; y < ground; y += 8)
      for (let x = 0; x < this.W; x += 8) {
        const off = (y / 8) % 2 ? 4 : 0;
        const v = hash(day, x, y);
        if (v < 0.12) px(ctx, x + off, y, 8, 8, PAL.plaza[0]);
        px(ctx, x + off, y, 8, 1, PAL.plaza[2]);
        px(ctx, x + off, y, 1, 8, PAL.plaza[2]);
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
    px(ctx, bx - 1, by - 1, bw + 2, bw + 4, PAL.grass[3]);
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) px(ctx, bx + x * C, by + y * C, C, C, (x + y) % 2 ? PAL.grass[1] : PAL.grass[2]);
    px(ctx, bx, by + bw, bw, 2, PAL.dirt[1]);
    for (let y = 0; y < bw; y++)
      for (let x = 0; x < bw; x++) {
        const v = hash(day, x + 300, y + 300);
        if (v < 0.04) px(ctx, bx + x, by + y, 1, 1, PAL.grass[0]);
        else if (v < 0.07) px(ctx, bx + x, by + y, 1, 1, PAL.grass[3]);
        else if (v < 0.074) px(ctx, bx + x, by + y, 1, 1, hash(x, y) < 0.5 ? PAL.gold : PAL.heart);
      }
    // A few lamp posts on the plaza corners.
    for (const [lx, ly] of [
      [6, 10],
      [this.W - 8, 10],
      [6, ground - 6],
      [this.W - 8, ground - 6],
    ]) {
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
        case 'move': {
          const r = e.result;
          if (r.kind === 'lay' && r.laid) {
            this.tileAnim = { start: this.now, slides: r.slides };
            for (const m of r.merges) this.flashes.set(idx(this.board, m.x, m.y), this.now + SLIDE_MS + 160);
            if (r.spawned) this.flashes.set(idx(this.board, r.spawned.x, r.spawned.y), this.now + SLIDE_MS + 120);
            const c = this.center(r.laid);
            this.dust(c.x, c.y, 6, PAL.plaza[2]);
            for (const m of r.merges) {
              const mc = this.center(m);
              this.dust(mc.x, mc.y - 4, 5, TIER_RAMPS[m.tier][0]);
            }
          }
          break;
        }
        case 'blocked':
          this.blocked = { at: step(this.headPos(), e.dir), t: this.now };
          break;
        case 'leave': {
          const p = this.riderPos.get(e.rider.id) ?? this.slot(0);
          this.riderPos.delete(e.rider.id);
          const side = this.sideDir();
          this.walkers.push({ look: e.rider.look, x: p.x, y: p.y, tx: p.x + side.x * this.W, ty: p.y + side.y * this.H, speed: 40, mood: 'angry', delay: 0 });
          this.word('UGH', p.x, p.y - 16, PAL.red);
          break;
        }
        case 'arrive': {
          const s = this.slot(this.game.queue.indexOf(e.rider));
          const side = this.sideDir();
          this.riderPos.set(e.rider.id, { x: s.x + side.x * 60, y: s.y + side.y * 60, moving: true });
          break;
        }
        case 'undo':
          this.tileAnim = null;
          break;
        case 'close':
          this.startRide();
          break;
        case 'stuck': {
          const h = this.center(this.headPos());
          this.word('STUCK!', h.x, h.y - 14, PAL.red);
          const side = this.sideDir();
          this.game.queue.forEach((r, i) => {
            const p = this.riderPos.get(r.id);
            if (!p) return;
            this.word('BOO', p.x, p.y - 18, PAL.white);
            this.walkers.push({ look: r.look, x: p.x, y: p.y, tx: p.x + side.x * this.W, ty: p.y + side.y * this.H, speed: 35, mood: 'angry', delay: 500 + i * 80 });
          });
          this.riderPos.clear();
          this.stuckUntil = this.now + 1600;
          break;
        }
      }
    }
  }

  private headPos(): Pt {
    const b = this.board;
    return b.path.length ? b.path[b.path.length - 1] : b.station;
  }

  private startRide(): void {
    const result = this.game.result!;
    const sc = this.center(this.board.station);
    // Riders walk onto the platform, then the train leaves.
    this.game.queue.forEach((r, i) => {
      const p = this.riderPos.get(r.id);
      if (!p) return;
      this.walkers.push({ look: r.look, x: p.x, y: p.y, tx: sc.x, ty: sc.y, speed: 45, delay: i * 70 });
    });
    this.riderPos.clear();
    this.ride = new RideAnim(this, this.board, result, this.game.mods.toleranceBonus, this.now + 900);
  }

  // ---- Effects ---------------------------------------------------------------

  dust(x: number, y: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ x, y, vx: Math.cos(a) * 20, vy: Math.sin(a) * 12 - 10, g: 30, life: 0, max: 0.4, color, size: 1 });
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
    this.words.push({ text, x: x - textWidth(text) / 2, y, life: 0, max: 1.1, color });
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
    if (this.stuckUntil && now >= this.stuckUntil) {
      this.stuckUntil = 0;
      this.onRideDone();
    }
    this.drawParticles(dt);
  }

  private drawTrackShadows(): void {
    const b = this.board;
    for (const c of b.path) {
      const p = this.center(c);
      px(this.ctx, p.x - 5, p.y + 1, 11, 3, PAL.shadow);
    }
  }

  private drawRows(): void {
    const b = this.board;
    const ctx = this.ctx;
    const anim = this.tileAnim && this.now - this.tileAnim.start < SLIDE_MS;
    if (this.tileAnim && !anim) this.tileAnim = null;
    const dayKey = this.game.dayNum * 131 + this.game.seed.charCodeAt(1);
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        const cx = this.cellX(x);
        const cy = this.cellY(y);
        if (b.station.x === x && b.station.y === y) {
          drawStation(ctx, cx, cy);
          this.drawStationTrack();
          continue;
        }
        const ob = b.obstacles[idx(b, x, y)];
        if (ob === 'tree') drawTree(ctx, cx, cy, dayKey + x * 7 + y * 13);
        else if (ob === 'rock') drawRock(ctx, cx, cy, dayKey + x + y * 5);
        else if (ob === 'pond') drawPond(ctx, cx, cy, this.now);
        else if (ob === 'stand') drawStand(ctx, cx, cy);
        const ti = b.path.findIndex((c) => c.x === x && c.y === y);
        if (ti >= 0) this.drawTrackCell(ti);
        const tier = b.tiles[idx(b, x, y)];
        if (tier && !anim) {
          const until = this.flashes.get(idx(b, x, y)) ?? 0;
          drawCrate(ctx, tier, cx, cy, until > this.now ? Math.min(1, (until - this.now) / 160) : 0);
        }
      }
  }

  private drawSlidingTiles(): void {
    if (!this.tileAnim) return;
    const t = Math.min(1, (this.now - this.tileAnim.start) / SLIDE_MS);
    const e = 1 - (1 - t) * (1 - t);
    for (const s of this.tileAnim.slides) {
      const x = this.cellX(s.from.x) + (this.cellX(s.to.x) - this.cellX(s.from.x)) * e;
      const y = this.cellY(s.from.y) + (this.cellY(s.to.y) - this.cellY(s.from.y)) * e;
      drawCrate(this.ctx, s.tier, x, y);
    }
  }

  // ---- Track -----------------------------------------------------------------

  private deckAt(p: Pt | null): number {
    if (!p) return 0;
    const b = this.board;
    if (p.x === b.station.x && p.y === b.station.y) return STATION_DECK;
    const c = b.path.find((q) => q.x === p.x && q.y === p.y);
    return c ? DECK[c.tier] : 0;
  }

  private dirBetween(a: Pt, b: Pt): Pt {
    return { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
  }

  private drawStationTrack(): void {
    const b = this.board;
    const sc = this.center(b.station);
    if (b.path.length) this.halfSegment(sc, STATION_DECK, this.dirBetween(b.station, b.path[0]), (STATION_DECK + DECK[b.path[0].tier]) / 2, 0);
    if (b.closed && b.path.length) {
      const last = b.path[b.path.length - 1];
      this.halfSegment(sc, STATION_DECK, this.dirBetween(b.station, last), (STATION_DECK + DECK[last.tier]) / 2, 0);
    }
  }

  private drawTrackCell(i: number): void {
    const b = this.board;
    const ctx = this.ctx;
    const cell = b.path[i];
    const prev = i === 0 ? b.station : b.path[i - 1];
    const next = i < b.path.length - 1 ? b.path[i + 1] : b.closed ? b.station : null;
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
    this.halfSegment(c, h, this.dirBetween(cell, prev), (h + this.deckAt(prev)) / 2, cell.tier);
    if (next) this.halfSegment(c, h, this.dirBetween(cell, next), (h + this.deckAt(next)) / 2, cell.tier);
    else px(ctx, c.x - 2, c.y - h - 2, 5, 5, PAL.gold);
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

  // ---- Targets (where the next swipe lays track) -----------------------------

  private drawTargets(): void {
    if (this.game.phase !== 'build') return;
    const b = this.board;
    const ctx = this.ctx;
    const blink = Math.floor(this.now / 300) % 2 === 0;
    const h = this.headPos();
    for (const dir of Object.keys(DELTA) as Dir[]) {
      const kind = layKind(b, dir);
      if (!kind) continue;
      const t = step(h, dir);
      const x = this.cellX(t.x);
      const y = this.cellY(t.y);
      if (kind === 'close') {
        const c = this.center(t);
        drawText(ctx, 'GO!', c.x - 5, c.y - 22 + (blink ? 0 : -1), PAL.gold, PAL.ink);
        continue;
      }
      const col = blink ? PAL.gold : PAL.white;
      for (const [cx, cy, w, hh] of [
        [x, y, 4, 1], [x, y, 1, 4], [x + 12, y, 4, 1], [x + 15, y, 1, 4],
        [x, y + 15, 4, 1], [x, y + 12, 1, 4], [x + 12, y + 15, 4, 1], [x + 15, y + 12, 1, 4],
      ])
        px(ctx, cx, cy, w, hh, col);
    }
    if (this.blocked && this.now - this.blocked.t < 350) {
      const c = this.center(this.blocked.at);
      drawText(ctx, 'X', c.x - 1, c.y - 8, PAL.red, PAL.ink);
    }
  }

  // ---- People ----------------------------------------------------------------

  private drawQueue(dt: number, include: (y: number) => boolean): void {
    if (this.game.phase !== 'build') return;
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
        const mood = r.patience <= 3 ? 'angry' : this.game.predict(r);
        const top = p.y - (r.look.small ? 9 : 11) - 2;
        if (mood !== 'angry' || Math.floor(this.now / 250) % 2) drawBubble(this.ctx, mood, p.x, top);
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
      if (w.mood) drawBubble(ctx, w.mood, w.x, w.y - (w.look.small ? 9 : 11) - 2);
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

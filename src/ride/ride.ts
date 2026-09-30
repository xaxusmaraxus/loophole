import type { DayResult } from '../game';
import type { RideStop } from '../puzzle/board';
import { PIECES } from '../puzzle/pieces';
import { PAL, SHIRTS } from '../render/palette';
import { sfx } from '../core/sfx';
import { DECK } from '../render/metrics';
import type { Renderer } from '../render/renderer';
import { type Ctx, drawCar, drawSeated, px } from '../render/sprites';
import type { ScoreEvent } from '../run/timeline';
import type { ScoreShow } from '../ui/scoreshow';

interface RidePoint {
  x: number;
  y: number;
  /** Ground position, for the shadow. */
  gy: number;
  cell: number;
  inverted: boolean;
}

const SPEED = 46;
/** Speed multiplier per tier: slow up the Hill, fast down the Drop. */
const TIER_SPEED = [1, 1, 0.75, 1.9, 1.3, 1.5, 1.6, 1.8];
const CAR_GAP = 8;
const THRILL_WORDS = ['AAH', 'WHEE', 'EEK', 'WOW', 'YEE'];
/** How long the final score stays up after the slam before the results. */
const OUTRO_MS = 2000;
/** Minimum gap between scoring events, by kind (ms). */
const GAP: Record<ScoreEvent['kind'], number> = { chips: 75, mult: 150, puke: 130, attraction: 520, slam: 450 };
const SLOWMO_MS = 900;

export class RideAnim {
  private pts: RidePoint[] = [];
  private dist: number[] = [];
  private total = 0;
  private s = 0;
  /** The stop each car is on (-1 before it leaves). */
  private carCell: number[];
  private sick: boolean[];
  private scream: number[];
  private doneAt = 0;
  /** Next timeline event to play, and when the last one played. */
  private next = 0;
  private lastFire = 0;
  private slamAt = 0;
  private slowUntil = 0;
  private skipped = false;

  constructor(
    private r: Renderer,
    private stops: RideStop[],
    private result: DayResult,
    private show: ScoreShow,
    private startAt: number,
  ) {
    this.buildPath();
    const n = Math.max(1, result.tickets.length);
    this.carCell = new Array(n).fill(-1);
    this.sick = new Array(n).fill(false);
    this.scream = new Array(n).fill(0);
    show.begin(result);
  }

  private get cars(): number {
    return this.carCell.length;
  }

  private get timeline(): ScoreEvent[] {
    return this.result.timeline;
  }

  private buildPath(): void {
    const stops = this.stops;
    const deck = (i: number) => (stops[i].station ? 2 : DECK[stops[i].tier]);
    const push = (x: number, y: number, gy: number, cell: number, inverted = false) =>
      this.pts.push({ x, y, gy, cell, inverted });

    const sc = this.r.center(stops[0]);
    push(sc.x, sc.y - 2, sc.y, 0);
    for (let i = 1; i < stops.length; i++) {
      const a = this.r.center(stops[i - 1]);
      const p = this.r.center(stops[i]);
      const edgeH = (deck(i - 1) + deck(i)) / 2;
      push((a.x + p.x) / 2, (a.y + p.y) / 2 - edgeH, (a.y + p.y) / 2, i);
      const h = deck(i);
      push(p.x, p.y - h, p.y, i);
      if (stops[i].station) continue;
      const tier = stops[i].tier;
      const dir = Math.sign(p.x - a.x) || 1;
      const ring = (cx: number, cy: number, rx: number, ry: number, flips: boolean) => {
        for (let t = 1; t <= 24; t++) {
          const ang = (t / 24) * Math.PI * 2;
          const y = cy + Math.cos(ang) * ry;
          push(cx + dir * Math.sin(ang) * rx, y, p.y, i, flips && Math.cos(ang) < -0.3);
        }
      };
      if (tier === 4) ring(p.x, p.y - h - 3, 6, 3, false);
      else if (tier === 5) ring(p.x, p.y - h - 6, 5, 6, true);
      else if (tier === 6) {
        ring(p.x - 3, p.y - h - 4, 3, 4, true);
        ring(p.x + 3, p.y - h - 5, 3, 5, true);
      } else if (tier === 7) ring(p.x, p.y - h - 8, 7, 8, true);
    }
    this.dist = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b2 = this.pts[i];
      this.dist.push(this.dist[i - 1] + Math.hypot(b2.x - a.x, b2.y - a.y));
    }
    this.total = this.dist[this.dist.length - 1];
  }

  private pointAt(d: number): RidePoint {
    d = Math.max(0, Math.min(this.total, d));
    let i = 1;
    while (i < this.dist.length - 1 && this.dist[i] < d) i++;
    const a = this.pts[i - 1];
    const b = this.pts[i];
    const seg = this.dist[i] - this.dist[i - 1] || 1;
    const t = (d - this.dist[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, gy: a.gy + (b.gy - a.gy) * t, cell: b.cell, inverted: b.inverted };
  }

  update(now: number, dt: number): void {
    if (now < this.startAt) return;
    if (!this.doneAt) {
      // A boss puke slows the world down for a beat.
      const k = now < this.slowUntil ? 0.25 : 1;
      const lead = this.pointAt(this.s);
      const tier = this.stops[lead.cell].tier;
      this.s += SPEED * TIER_SPEED[tier] * dt * k;
      for (let i = 0; i < this.cars; i++) {
        const p = this.pointAt(this.s - i * CAR_GAP);
        if (this.s - i * CAR_GAP < 0 || p.cell === this.carCell[i]) continue;
        this.carCell[i] = p.cell;
        if (!this.stops[p.cell].station) this.enterCell(i, p);
      }
      if (this.s - (this.cars - 1) * CAR_GAP >= this.total) {
        this.doneAt = now;
        this.disembark();
      }
    }
    this.dispatch(now);
  }

  /** Has the ride got far enough for this event to play? */
  private ready(e: ScoreEvent, now: number): boolean {
    if (e.kind === 'attraction' || e.kind === 'slam') return this.doneAt > 0 && now - this.doneAt > 350;
    if (this.doneAt) return true;
    return this.carCell[e.kind === 'puke' ? e.car : 0] >= e.stop;
  }

  /** Play the timeline in order, one event at a time, as the train reaches each one. */
  private dispatch(now: number): void {
    const tl = this.timeline;
    if (this.next >= tl.length) return;
    const e = tl[this.next];
    if (!this.ready(e, now)) return;
    // When events pile up (a long train all puking at once), play them faster.
    let backlog = 0;
    for (let j = this.next; j < tl.length && backlog < 8 && this.ready(tl[j], now); j++) backlog++;
    const gap = GAP[e.kind] * (now < this.slowUntil ? 2.5 : 1) * (backlog > 4 ? 0.45 : backlog > 2 ? 0.7 : 1);
    if (now - this.lastFire < gap) return;
    this.lastFire = now;
    this.next++;
    this.fire(e, now);
  }

  /** Where an event happens, in page coordinates. */
  private screenAt(e: ScoreEvent): { x: number; y: number } {
    let x: number;
    let y: number;
    if (e.kind === 'puke' && !this.doneAt) {
      const p = this.pointAt(Math.max(0, this.s - e.car * CAR_GAP));
      x = p.x;
      y = p.y - (this.result.tickets[e.car]?.rider.look.big ? 16 : 10);
    } else {
      const c = this.r.center(this.stops[e.stop]);
      x = c.x;
      y = c.y - (this.stops[e.stop].station ? 2 : DECK[this.stops[e.stop].tier]) - 6;
    }
    return this.r.toPage(x, y);
  }

  private fire(e: ScoreEvent, now: number): void {
    if (e.kind === 'slam') {
      this.slamAt = now;
      this.show.slam(e);
      setTimeout(() => this.r.cheer(1.5), this.skipped ? 0 : 420);
      return;
    }
    const at = this.screenAt(e);
    this.show.apply(e, at);
    const w = this.r.fromPage(at.x, at.y);
    if (e.kind === 'chips') this.r.sparkle(w.x, w.y + 4, 3 + Math.min(10, e.amount / 2), '#45a8e0');
    else if (e.kind === 'mult') this.r.sparkle(w.x, w.y + 4, 10, '#f0584e');
    else if (e.kind === 'puke') {
      this.sick[e.car] = true;
      const hit = Math.min(1, e.pay / Math.max(1, this.result.target * 0.15));
      this.r.puke(w.x, w.y + 6, e.boss ? 60 : 10 + Math.round(hit * 20));
      if (e.boss) this.slowUntil = now + SLOWMO_MS;
    }
  }

  /** Click or space: the rest of the ride resolves at once (same totals). */
  skip(now: number): void {
    if (this.slamAt || now < this.startAt) return;
    this.skipped = true;
    if (!this.doneAt) {
      this.doneAt = now;
      this.disembark();
    }
    const tl = this.timeline;
    while (this.next < tl.length - 1) {
      const e = tl[this.next++];
      this.show.apply(e, null, true);
      if (e.kind === 'puke') this.sick[e.car] = true;
    }
    this.next = tl.length;
    this.slamAt = now;
    this.show.slam(tl[tl.length - 1], true);
    this.r.cheer(1.5);
  }

  private enterCell(i: number, p: RidePoint): void {
    const v = this.result.tickets[i];
    const tier = this.stops[p.cell].tier;
    const piece = PIECES[tier];
    if (!v) return;
    if (tier >= 3) {
      this.scream[i] = 0.6;
      if (Math.random() < 0.3) {
        sfx.scream();
        if (Math.random() < 0.5) this.r.word(THRILL_WORDS[Math.floor(Math.random() * THRILL_WORDS.length)], p.x, p.y - 16, PAL.white);
      }
    }
    if (piece.inversion && Math.random() < 0.3) this.r.hat(p.x, p.y - 8, SHIRTS[(v.rider.look.shirt + 3) % SHIRTS.length]);
  }

  private disembark(): void {
    const sc = this.r.center(this.stops[0]);
    const o = { x: sc.x < this.r.W / 2 ? -1 : 1, y: sc.y < this.r.H / 2 ? -1 : 1 };
    this.result.tickets.forEach(({ rider, pukes }, i) => {
      const angle = (i / Math.max(1, this.result.tickets.length)) * 1.2 - 0.6;
      const tx = sc.x + o.x * 30 + Math.sin(angle) * 40;
      const ty = sc.y + o.y * 28 + Math.cos(angle) * 10;
      this.r.addWalker({ look: rider.look, x: sc.x, y: sc.y, tx, ty, speed: 30, sick: pukes > 0, mood: pukes > 0 ? 'sick' : 'meh', delay: i * 120 });
    });
  }

  finished(now: number): boolean {
    return this.slamAt > 0 && now - this.slamAt > (this.skipped ? OUTRO_MS * 0.7 : OUTRO_MS);
  }

  draw(ctx: Ctx, now: number): void {
    if (this.doneAt) return;
    const dt = 1 / 60;
    for (let i = this.cars - 1; i >= 0; i--) {
      const d = this.s - i * CAR_GAP;
      const p = this.pointAt(Math.max(0, d));
      if (d < 0 && i > 0 && now >= this.startAt) continue;
      this.scream[i] = Math.max(0, this.scream[i] - dt);
      const v = this.result.tickets[i];
      px(ctx, p.x - 3, p.gy + 1, 7, 2, PAL.shadow);
      const x = Math.round(p.x - 3);
      const y = Math.round(p.y - 3);
      if (p.inverted) {
        drawCar(ctx, x, y - 3);
        if (v) drawSeated(ctx, v.rider.look, x, y + 1, { sick: this.sick[i], scream: true });
      } else {
        if (v) drawSeated(ctx, v.rider.look, x, y - 6, { sick: this.sick[i], scream: this.scream[i] > 0 });
        drawCar(ctx, x, y);
      }
    }
  }
}

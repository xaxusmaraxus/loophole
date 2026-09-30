import type { DayResult } from '../game';
import { MAX_PUKES, type Rider } from '../riders/riders';
import type { RideStop } from '../puzzle/board';
import { PIECES } from '../puzzle/pieces';
import { PAL, SHIRTS } from '../render/palette';
import { sfx } from '../core/sfx';
import { DECK } from '../render/metrics';
import type { Renderer } from '../render/renderer';
import { type Ctx, drawCar, drawSeated, px } from '../render/sprites';

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
const OUTRO_MS = 1900;

export class RideAnim {
  private pts: RidePoint[] = [];
  private dist: number[] = [];
  private total = 0;
  private s = 0;
  private carCell: number[];
  private nausea: number[];
  private sick: boolean[];
  /** Pukes so far this ride, per car. */
  private puked: number[];
  private scream: number[];
  private doneAt = 0;

  constructor(
    private r: Renderer,
    private stops: RideStop[],
    private result: DayResult,
    private sickness: { nausea(r: Rider, tier: number): number; stomach(r: Rider): number },
    private startAt: number,
  ) {
    this.buildPath();
    const n = Math.max(1, result.tickets.length);
    this.carCell = new Array(n).fill(-1);
    this.nausea = new Array(n).fill(0);
    this.sick = new Array(n).fill(false);
    this.scream = new Array(n).fill(0);
    this.puked = new Array(n).fill(0);
  }

  private get cars(): number {
    return this.carCell.length;
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
    if (now < this.startAt || this.doneAt) return;
    const lead = this.pointAt(this.s);
    const tier = this.stops[lead.cell].tier;
    this.s += SPEED * TIER_SPEED[tier] * dt;
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

  private enterCell(i: number, p: RidePoint): void {
    const v = this.result.tickets[i];
    const tier = this.stops[p.cell].tier;
    const piece = PIECES[tier];
    if (!v) return;
    // Every pass counts: a shuttle hits each piece twice.
    this.nausea[i] += this.sickness.nausea(v.rider, tier);
    const due = Math.min(MAX_PUKES, Math.floor(this.nausea[i] / Math.max(2, this.sickness.stomach(v.rider))));
    if (due > this.puked[i]) {
      this.puked[i] = due;
      this.sick[i] = true;
      this.r.puke(p.x, p.y - 4);
      this.r.word(due > 1 ? `BLEH X${due}` : 'BLEH', p.x, p.y - 16, PAL.sick);
      sfx.sick();
      return;
    }
    if (tier >= 3) {
      this.scream[i] = 0.6;
      if (Math.random() < 0.45) {
        sfx.scream();
        this.r.word(THRILL_WORDS[Math.floor(Math.random() * THRILL_WORDS.length)], p.x, p.y - 16, PAL.white);
      }
    }
    if (piece.inversion && Math.random() < 0.3) this.r.hat(p.x, p.y - 8, SHIRTS[(v.rider.look.shirt + 3) % SHIRTS.length]);
  }

  private disembark(): void {
    const sc = this.r.center(this.stops[0]);
    const o = { x: sc.x < this.r.W / 2 ? -1 : 1, y: sc.y < this.r.H / 2 ? -1 : 1 };
    this.result.tickets.forEach(({ rider, pukes, paid }, i) => {
      const angle = (i / Math.max(1, this.result.tickets.length)) * 1.2 - 0.6;
      const tx = sc.x + o.x * 30 + Math.sin(angle) * 40;
      const ty = sc.y + o.y * 28 + Math.cos(angle) * 10;
      this.r.addWalker({ look: rider.look, x: sc.x, y: sc.y, tx, ty, speed: 30, sick: pukes > 0, mood: pukes > 0 ? 'sick' : 'meh', delay: i * 120 });
      setTimeout(() => {
        if (pukes > 0) {
          sfx.happy(i);
          this.r.puke(tx + 3, ty - 6);
          this.r.word(`+${paid}`, tx, ty - 22, PAL.gold);
        } else {
          sfx.meh();
          this.r.word('MEH', tx, ty - 22, PAL.white);
        }
      }, 700 + i * 120);
    });
  }

  finished(now: number): boolean {
    return this.doneAt > 0 && now - this.doneAt > OUTRO_MS;
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

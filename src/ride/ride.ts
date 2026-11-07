import { Vector3 } from 'three';
import { music } from '../core/music';
import { sfx } from '../core/sfx';
import type { DayResult } from '../game';
import type { Board, RideStop } from '../puzzle/board';
import { LIFT, PIECES } from '../puzzle/pieces';
import { PAL, SHIRTS } from '../render/palette';
import { CAR_GAP, type Renderer } from '../render/renderer';
import { rideArms, rideFace } from '../render/moods';
import type { Face } from '../render3d/models';
import type { CellLevel, TrackPath } from '../render3d/track';
import type { ScoreEvent } from '../run/timeline';
import type { ScoreShow } from '../ui/scoreshow';

// The ride: the train runs the real 3D track (loops, rolls and all) while the
// day's scoring timeline plays out event by event as the train reaches each
// piece. Speed follows the height of the train, so it crawls over the tops of
// loops and screams through the dips; a boss puke slows the world for a beat.

const THRILL_WORDS = ['AAH', 'WHEE', 'EEK', 'WOW', 'YEE', 'OMG'];
/** How long the final score stays up after the slam before the results. */
const OUTRO_MS = 2200;
/** Minimum gap between scoring events, by kind (ms). */
const GAP: Record<ScoreEvent['kind'], number> = { chips: 75, mult: 150, puke: 130, attraction: 420, slam: 450 };
/** The 3-2-1 before the train leaves (game ms): the lift chain clacks under it. */
export const COUNT_MS = 1350;
/** About how long the run itself should take (s): long tracks run faster to fit. */
const RIDE_SECS = 10;
/** About how long the riders' cash-in takes after the ride (ms). */
const FINALE_MS = 2800;

/** Where the ride is, for the camera and the HUD. */
export type RideStage = 'board' | 'count' | 'ride' | 'station' | 'done';

/** What the camera needs from the ride this frame. */
export interface RideCam {
  stage: RideStage;
  /** The lead car, the middle of the train, and the way the train is heading (level, smoothed). */
  lead: Vector3;
  mid: Vector3;
  heading: Vector3;
  /** 0..1: how much to swing out to the side to show a loop or top hat whole. */
  swoop: number;
  /** The big piece being shown (its middle), and how tall it is. */
  swoopAt: Vector3;
  swoopSize: number;
  /** 0..1 how fast the train is going. */
  rush: number;
}
const SHOUTS = ['WHOOOAAA', 'AAAAAHHH', 'MOMMYYY', 'NOPE NOPE', 'WHEEEEE', 'OH NOOO'];

/** Most slow-motion moments per ride (not counting special riders' pukes). */
const MAX_MOMENTS = 3;
const STEP = 0.02;

/** How climactic a piece is: the Top Hat, then the inversions (wilder first); a lift payoff or finale drop jumps the queue. */
function momentScore(tier: number, power: number): number {
  const base = tier === 7 ? 100 : PIECES[tier]?.inversion ? 50 + tier : 0;
  return power > 0 ? Math.max(base, 40) + 30 * power : base;
}

/**
 * Slow motion goes to the climaxes of the ride, up to MAX_MOMENTS (earliest
 * first among equals): Top Hats first, then inversions (Cobra Roll, Corkscrew,
 * Vertical Loop), and anything a lift chain powers up (`power`: the chain's
 * extra multiplier, or the finale drop's lifts) ranks above its kind. With
 * nothing like that, the wildest other piece gets one.
 */
export function pickMoments(tiers: number[], power: number[] = []): Set<number> {
  const all = tiers.map((t, i) => ({ t, i, sc: momentScore(t, power[i] ?? 0) }));
  const big = all.filter((c) => c.sc > 0);
  const ranked = big.length
    ? big.sort((a, b) => b.sc - a.sc || a.i - b.i)
    : all.filter((c) => c.t > 0 && c.t !== LIFT).sort((a, b) => b.t - a.t || a.i - b.i).slice(0, 1);
  return new Set(ranked.slice(0, MAX_MOMENTS).map((c) => c.i));
}

/** Where the lead car waits in the station: at the top of the red end's leg of the U. */
export function parkS(path: TrackPath, _b?: Board): number {
  return path.parkAt;
}

/** The train's route over the track's arc length: once round a circuit, out and back on a shuttle. */
class Route {
  legs: { a: number; b: number; len: number }[] = [];
  total = 0;
  /** Stop index for each STEP of route distance. */
  private table: number[] = [];

  constructor(
    private path: TrackPath,
    stops: RideStop[],
    park: number,
    cars: number,
  ) {
    if (path.closed) this.leg(park, park + path.length);
    else {
      const sMin = 0;
      const sMax = path.pts[path.pts.length - 1].s;
      const out = Math.max(park, sMax - 0.12);
      const back = Math.min(out, sMin + (cars - 1) * CAR_GAP + 0.12);
      this.leg(park, out);
      this.leg(out, back);
      this.leg(back, park);
    }
    // Match the cells the route passes to the ride's stops, in order.
    let ptr = 0;
    for (let d = 0; d <= this.total + 1e-6; d += STEP) {
      const c = path.cells[path.sample(this.sAt(d)).cell];
      const is = (k: number) => k < stops.length && stops[k].x === c.x && stops[k].y === c.y;
      if (!is(ptr) && is(ptr + 1)) ptr++;
      this.table.push(ptr);
    }
  }

  private leg(a: number, b: number): void {
    const len = Math.abs(b - a);
    this.legs.push({ a, b, len });
    this.total += len;
  }

  /** Arc length on the track at route distance d. */
  sAt(d: number): number {
    let rest = Math.max(0, Math.min(this.total, d));
    for (const l of this.legs) {
      if (rest <= l.len || l === this.legs[this.legs.length - 1]) return l.a + Math.sign(l.b - l.a) * Math.min(rest, l.len);
      rest -= l.len;
    }
    return this.legs[0].a;
  }

  /** Distance to the next change of direction (or the end). */
  toTurn(d: number): number {
    let acc = 0;
    for (const l of this.legs) {
      acc += l.len;
      if (d < acc) return acc - d;
    }
    return 0;
  }

  stopAt(d: number): number {
    if (d < 0) return -1;
    return this.table[Math.min(this.table.length - 1, Math.floor(d / STEP))];
  }

  /** Direction of travel along the track at route distance d (+1 or -1). */
  dirAt(d: number): number {
    let acc = 0;
    for (const l of this.legs) {
      acc += l.len;
      if (d < acc) return Math.sign(l.b - l.a) || 1;
    }
    return 1;
  }
}

export class RideAnim {
  private route: Route;
  private path: TrackPath;
  private d = 0;
  private v = 0;
  /** The stop each car is on (-1 before it leaves). */
  private carCell: number[];
  private sick: boolean[];
  private scream: number[];
  private heads: Vector3[];
  private fwd = new Vector3(0, 0, 1);
  private doneAt = 0;
  /** Next timeline event to play, and when the last one played. */
  private next = 0;
  private lastFire = 0;
  private slamAt = 0;
  private skipped = false;
  /** Slow-motion moments this ride, and the chain cells that already had one. */
  private lastMoment = -1e9;
  /** The chain cells picked for slow motion (the wildest pieces), and those already shown. */
  private momentPicks = new Set<number>();
  private momentCells = new Set<number>();
  private photoTaken = false;
  private leadY = 0;
  private rising = false;
  /** The puke finale: per-rider payouts played one by one after the attractions. */
  private finale: { at: number; fn: () => void }[] = [];
  private hRef: number;
  private park: number;
  private lastT = 0;
  private seated: boolean[] = [];
  /** Per car: where the rider's mouth is, which way the car faces, and its up. */
  private mouths: Vector3[] = [];
  private fwds: Vector3[] = [];
  /** Per car: the track's direction under it (what the puke is carried along). */
  private tans: Vector3[] = [];
  /** Per car: how far round it has whirled (spinning pieces), and the spin's direction. */
  private spinAng: number[] = [];
  private spinDir: number[] = [];
  /** When the last flume splash sounded. */
  private splashAt = -1e9;
  private ups: Vector3[] = [];
  private pukeUntil: number[] = [];
  /** The timeline event the on-ride photo waits for. */
  private photoPuke = -1;
  private boostUntil = 0;
  private brakeUntil = 0;
  private rolling = false;
  private clack = 0;
  /** Long tracks run faster, and busy timelines play their events closer together, so a ride fits in a few seconds. */
  private speedK = 1;
  private gapK = 1;
  /** The countdown number last shown (3, 2, 1). */
  private counted = 4;
  /** The camera's view of the train: a level heading (smoothed) and the swoop out for big pieces. */
  private heading = new Vector3(0, 0, -1);
  private headingSet = false;
  private swoop = 0;
  private swoopCell = -1;
  private swoopAt = new Vector3();
  private swoopSize = 1;
  private boxes = new Map<number, { c: Vector3; size: number }>();
  /** The boss's car (if a boss rides), and until when they look worried. */
  private bossCar = -1;
  private worried = 0;
  /** Puke splats on the lens so far (only the first and the boss's). */
  private lensSplats = 0;
  /** When the last rider puked (game time; a test hook). */
  lastPukeAt = -1;
  /** The rider cashing in right now at the curtain call (the camera follows along the line). */
  focusCar = -1;

  get swoopK(): number {
    return this.swoop;
  }

  constructor(
    private r: Renderer,
    private stops: RideStop[],
    private result: DayResult,
    private show: ScoreShow,
    private startAt: number,
    /** Game time each rider is seated (they walk up and hop in one by one). */
    private boardAt: number[] = [],
  ) {
    this.path = r.path;
    const n = Math.max(1, result.tickets.length);
    this.park = parkS(this.path, r.game.board);
    this.route = new Route(this.path, stops, this.park, n);
    this.carCell = new Array(n).fill(-1);
    this.sick = new Array(n).fill(false);
    this.scream = new Array(n).fill(0);
    this.heads = new Array(n).fill(null).map(() => new Vector3());
    this.mouths = new Array(n).fill(null).map(() => new Vector3());
    this.fwds = new Array(n).fill(null).map(() => new Vector3(0, 0, 1));
    this.ups = new Array(n).fill(null).map(() => new Vector3(0, 1, 0));
    this.tans = new Array(n).fill(null).map(() => new Vector3(0, 0, 1));
    this.spinAng = new Array(n).fill(0);
    this.spinDir = new Array(n).fill(0).map((_, i) => (i % 2 ? -1 : 1));
    this.pukeUntil = new Array(n).fill(0);
    // The photo: the boss's first puke if the boss goes, else the first puke of the ride.
    const pukes = result.timeline.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === 'puke');
    this.photoPuke = (pukes.find(({ e }) => e.kind === 'puke' && e.boss) ?? pukes[0])?.i ?? -1;
    this.hRef = this.path.maxHeight() + 0.25;
    this.momentPicks = pickMoments(
      this.path.cells.map((c) => (c.station ? 0 : c.tier)),
      this.path.levels.map((l) => l.mult - 1 + l.finale),
    );
    // About 1.7 track units a second on an average ride: a long track runs faster so the run takes ~RIDE_SECS.
    this.speedK = Math.max(1, Math.min(2.4, this.route.total / (1.7 * RIDE_SECS)));
    // The events that play while the train runs share its time (they never trail far behind it).
    const busy = result.timeline.reduce((a, e) => a + (e.kind === 'chips' || e.kind === 'mult' || e.kind === 'puke' ? GAP[e.kind] : 0), 0);
    this.gapK = Math.max(0.25, Math.min(1, (this.route.total / (1.7 * this.speedK)) * 1000 * 0.8 / Math.max(1, busy)));
    this.bossCar = result.tickets.findIndex((t) => !!t.rider.boss);
    show.begin(result);
    show.onSkip = () => r.skipRide();
  }

  /** Where the ride is now. */
  stage(now: number): RideStage {
    if (this.slamAt) return 'done';
    if (this.doneAt) return 'station';
    if (now < this.startAt - COUNT_MS) return 'board';
    if (now < this.startAt) return 'count';
    return 'ride';
  }

  /** The camera's brief for this frame (see RideCam). */
  cam(now: number, dt: number): RideCam {
    const lead = this.path.sample(this.carS(0)).p.clone();
    const mid = this.path.sample(this.carS(Math.min(this.cars - 1, 2))).p.clone();
    // Heading: the track's level direction averaged over the stretch the front of the train covers,
    // so loops and rolls (where the tangent turns right round) don't whip the camera about.
    const s0 = this.carS(0);
    const dir = this.route.dirAt(this.d);
    const h = new Vector3();
    for (let k = 0; k <= 8; k++) {
      const f = this.path.sample(s0 - 1.4 + k * 0.2);
      h.x += f.t.x;
      h.z += f.t.z;
    }
    h.multiplyScalar(dir).setY(0);
    if (h.lengthSq() > 1e-4) {
      h.normalize();
      if (!this.headingSet) this.heading.copy(h);
      else this.heading.lerp(h, Math.min(1, dt * 2.4)).normalize();
      this.headingSet = true;
    }
    // Swing out for the big pieces (loops, rolls, top hats, anything powered up), from just before until just after.
    let want = 0;
    const st = this.stage(now);
    if (st === 'ride') {
      for (const ahead of [0, 0.5]) {
        const c = this.path.sample(s0 + ahead * dir).cell;
        const cell = this.path.cells[c];
        if (!cell || cell.station) continue;
        const lv = this.path.levels[c];
        const big = PIECES[cell.tier]?.inversion || cell.tier === 7 || (lv && lv.mult - 1 + lv.finale > 0 && cell.tier !== LIFT);
        if (big) {
          if (c !== this.swoopCell) {
            this.swoopCell = c;
            const b = this.box(c);
            if (this.swoop < 0.05) this.swoopAt.copy(b.c);
            this.swoopSize = b.size;
          }
          want = 1;
          break;
        }
      }
    }
    if (this.swoopCell >= 0) this.swoopAt.lerp(this.box(this.swoopCell).c, Math.min(1, dt * 3));
    this.swoop += (want - this.swoop) * Math.min(1, dt * (want ? 2.6 : 1.4));
    return { stage: st, lead, mid, heading: this.heading.clone(), swoop: this.swoop, swoopAt: this.swoopAt.clone(), swoopSize: this.swoopSize, rush: this.rush() };
  }

  /** A piece's middle and size (for the swoop shot). */
  private box(cell: number): { c: Vector3; size: number } {
    let b = this.boxes.get(cell);
    if (b) return b;
    const [a, z] = this.path.range(cell);
    const lo = new Vector3(Infinity, Infinity, Infinity);
    const hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let s = a; s <= z + 1e-6; s += 0.05) {
      const p = this.path.sample(s).p;
      lo.min(p);
      hi.max(p);
    }
    b = { c: lo.clone().add(hi).multiplyScalar(0.5), size: Math.max(0.6, hi.clone().sub(lo).length()) };
    this.boxes.set(cell, b);
    return b;
  }

  private get cars(): number {
    return this.carCell.length;
  }

  private get timeline(): ScoreEvent[] {
    return this.result.timeline;
  }

  /** Track arc length of car i (the train is rigid, even when it backs up). */
  private carS(i: number): number {
    const lead = this.route.sAt(this.d);
    return lead - i * CAR_GAP;
  }

  update(now: number, dt: number): void {
    if (now < this.startAt) {
      // The countdown: 3, 2, 1 while the chain clacks the train taut.
      const left = this.startAt - now;
      if (left <= COUNT_MS) {
        const k = Math.max(1, Math.ceil((left / COUNT_MS) * 3));
        if (k < this.counted) {
          this.counted = k;
          this.show.countdown(k);
          sfx.count(k);
          this.r.kick(0.6 + (3 - k) * 0.4, 90);
        }
        this.clack += dt;
        if (this.clack > 0.075 + k * 0.02) {
          this.clack = 0;
          sfx.clack();
        }
      }
      return;
    }
    if (!this.rolling) {
      this.rolling = true;
      this.clack = 0;
      this.show.countdown(0);
      sfx.bell();
      sfx.go();
      this.r.kick(2.5, 220);
      music.setMode('ride');
    }
    if (!this.doneAt) {
      // Speed from the train's height: slow over the tops, fast in the dips.
      let h = 0;
      for (let i = 0; i < this.cars; i++) h += this.path.sample(this.carS(i)).p.y;
      h /= this.cars;
      const lead = this.path.sample(this.carS(0));
      let v = (0.6 + 1.4 * Math.sqrt(Math.max(0, this.hRef - h))) * this.speedK;
      // A Launch fires the train; a Brake Run nearly stops it, then lets go.
      if (now < this.boostUntil) v = Math.max(v, 3.4 * this.speedK);
      if (now < this.brakeUntil) v = Math.min(v, 0.12);
      if (lead.lift) {
        v = Math.min(v, 0.52 * Math.min(1.7, this.speedK));
        // The chain clacks under the train on the way up.
        this.clack += this.v * dt;
        if (this.clack > 0.09) {
          this.clack = 0;
          sfx.clack();
        }
      }
      v *= Math.min(1, 0.2 + ((now - this.startAt) / 1000) * 1.4);
      v = Math.min(v, 0.3 + this.route.toTurn(this.d) * 2.4 * this.speedK);
      this.v += (v - this.v) * Math.min(1, dt * (now < this.boostUntil ? 9 : now < this.brakeUntil ? 16 : 6));
      this.d += this.v * dt;
      // The on-ride camera fires as the train rolls into the wildest piece.
      // Snap on the level run just before it, while everyone's still facing the camera.
      const level = lead.up.y > 0.95 && Math.abs(lead.t.y) < 0.2;
      // (Only when nobody pukes: otherwise the camera waits for the first puke.)
      if (!this.photoTaken && this.photoPuke < 0 && level && this.nearTopPick(this.carS(0))) this.snap();
      this.checkMoment(now, lead.p.y, lead.up.y, lead.cell);
      // No wild piece (or it was missed)? The camera fires partway round instead.
      // (On a level stretch if there is one; right before the station at the latest.)
      if (!this.photoTaken && this.photoPuke < 0 && this.d > this.route.total * (this.momentPicks.size ? 0.6 : 0.45) && (level || this.d > this.route.total * 0.95)) this.snap();
      for (let i = 0; i < this.cars; i++) {
        const stop = this.route.stopAt(this.d - i * CAR_GAP);
        if (stop < 0 || stop === this.carCell[i]) continue;
        this.carCell[i] = stop;
        if (!this.stops[stop].station) this.enterCell(i, stop);
      }
      if (this.d >= this.route.total - 1e-3) {
        this.doneAt = now;
        this.r.disembark(this.result.tickets);
      }
    }
    this.dispatch(now);
    while (this.finale.length && this.finale[0].at <= now) this.finale.shift()!.fn();
  }

  /** Within a short run before the top pick's first sample. */
  private nearTopPick(s: number): boolean {
    const best = this.topPick();
    if (best < 0) return false;
    const start = this.path.ranges[best][0];
    return s > start - 0.45 && s < start + 0.05;
  }

  /** The top pick: the wildest piece (the first of the highest tier). */
  private topPick(): number {
    let best = -1;
    for (const c of this.momentPicks) if (best < 0 || this.path.cells[c].tier > this.path.cells[best].tier || (this.path.cells[c].tier === this.path.cells[best].tier && c < best)) best = c;
    return best;
  }

  /** The track-mounted camera: just ahead of the lead car, looking back into the faces. */
  private snap(): void {
    this.photoTaken = true;
    this.r.requestPhoto(() => {
      // In the lead car's own frame: riders face along the track tangent, so the camera sits
      // out in front of the first face, a touch above it, and looks back down the train.
      const lead = this.path.sample(this.carS(0));
      const k = Math.min(this.cars - 1, 2);
      const h0 = this.heads[0];
      const back = this.heads[k].clone().add(this.heads[Math.min(this.cars - 1, 1)]).multiplyScalar(0.5);
      const eye = h0.clone().addScaledVector(lead.t, 0.72).addScaledVector(lead.up, 0.2);
      const look = h0.clone().lerp(back, 0.5).addScaledVector(lead.up, -0.05);
      return { eye, look, up: lead.up.clone().lerp(new Vector3(0, 1, 0), 0.6).normalize() };
    });
  }

  /** The puke cam: three-quarters from the front of the puking rider, stream and all. */
  private snapPuke(car: number): void {
    this.photoTaken = true;
    this.r.requestPhoto(
      () => {
        const up = this.ups[car].clone().lerp(new Vector3(0, 1, 0), 0.6).normalize();
        const fwd = this.fwds[car].clone();
        const right = up.clone().cross(fwd).normalize();
        const side = Math.random() < 0.5 ? 1 : -1;
        const m = this.mouths[car];
        const eye = m.clone().addScaledVector(fwd, 0.85).addScaledVector(right, side * 0.62).addScaledVector(up, 0.16);
        const look = m.clone().addScaledVector(fwd, 0.3).addScaledVector(up, -0.08);
        return { eye, look, up, splat: Math.random() < 0.5 };
      },
      260,
    );
  }

  /** Slow motion at the crown of a loop or a top hat, mid-roll, or the lip of a big drop, a few times a ride. */
  private checkMoment(now: number, y: number, upY: number, cell: number): void {
    const tier = this.path.cells[cell]?.tier ?? 0;
    const lv = this.path.levels[cell];
    const power = lv ? lv.mult - 1 + lv.finale : 0;
    const crest = this.rising && y < this.leadY - 1e-4;
    this.rising = y > this.leadY + 1e-4 ? true : y < this.leadY - 1e-4 ? false : this.rising;
    this.leadY = y;
    if (!this.momentPicks.has(cell) || this.momentCells.has(cell) || now - this.lastMoment < 1200 || this.r.inShot) return;
    // Upside down at the top of a loop or a cobra's hood, or rolled over in a corkscrew.
    const crown = (tier === 4 || tier === 6) && upY < -0.9;
    const twist = tier === 5 && upY < -0.95;
    // Over the top of a Top Hat, or the crest before a finale dive or any powered-up piece.
    const lip = crest && ((tier === 7 && y > 0.9) || (power > 0 && !PIECES[tier].inversion && y > 0.4));
    if (!crown && !lip && !twist) return;
    this.lastMoment = now;
    this.momentCells.add(cell);
    // The bigger the piece, the longer and closer the shot.
    const big = Math.min(1, (tier === 7 ? 1 : tier === 6 ? 0.75 : tier === 5 ? 0.6 : tier === 4 ? 0.5 : 0.3) + power * 0.15);
    this.r.dramatic(() => this.heads[0], 1100 + big * 800, 0.46 - big * 0.14, 0.12, SHOUTS[Math.floor(Math.random() * SHOUTS.length)]);
    sfx.slowScream();
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
    for (let burst = 0; burst < 3 && this.next < tl.length; burst++) {
      const e = tl[this.next];
      if (!this.ready(e, now)) return;
      // When events pile up (a long train all puking at once), play them faster.
      let backlog = 0;
      for (let j = this.next; j < tl.length && backlog < 12 && this.ready(tl[j], now); j++) backlog++;
      const inRide = e.kind !== 'attraction' && e.kind !== 'slam';
      const gap = GAP[e.kind] * (inRide ? this.gapK : 1) * (backlog > 8 ? 0.35 : backlog > 4 ? 0.5 : backlog > 2 ? 0.75 : 1);
      if (burst === 0 && now - this.lastFire < gap) return;
      this.lastFire = now;
      this.next++;
      this.fire(e, now);
      // Several a frame only when they are badly behind.
      if (backlog <= 8) return;
    }
  }

  /** The piece a stop sits on, in the world. */
  private stopPoint(i: number): Vector3 {
    const st = this.stops[i];
    if (st.station) return this.r.stationCenter().setY(0.45);
    const ci = this.path.indexOf(st.x, st.y);
    const [a, b] = this.path.range(ci);
    let top = this.path.sample(a).p.clone();
    // The highest point of the piece, so popups rise off the loop's crown.
    for (let s = a; s <= b; s += 0.05) {
      const p = this.path.sample(s).p;
      if (p.y > top.y) top = p.clone();
    }
    return top.setY(top.y + 0.18);
  }

  /** Where an event happens, in world space. */
  private worldAt(e: ScoreEvent): Vector3 {
    if (e.kind === 'puke' && !this.doneAt) return this.heads[e.car].clone();
    return this.stopPoint(e.stop);
  }

  private fire(e: ScoreEvent, now: number): void {
    if (e.kind === 'slam') {
      this.startFinale(e, now);
      return;
    }
    const w = this.worldAt(e);
    this.show.apply(e, this.r.project(w));
    if (e.kind === 'chips') this.r.sparkle(w, 4 + Math.min(14, e.amount / 2), '#45a8e0');
    else if (e.kind === 'mult') this.r.sparkle(w, 14, '#f0584e');
    else if (e.kind === 'puke') {
      this.sick[e.car] = true;
      this.lastPukeAt = now;
      const hit = Math.min(1, e.pay / Math.max(1, this.result.target * 0.15));
      const car = e.car;
      // A gush straight out of the rider's mouth, carried along with the train.
      const ms = e.boss ? 1500 : 550 + hit * 500;
      this.pukeUntil[car] = now + ms;
      this.r.pukeStream(
        () =>
          this.doneAt
            ? null
            : {
                p: this.mouths[car].clone(),
                dir: this.fwds[car].clone().multiplyScalar(0.9).addScaledVector(this.ups[car], 0.25),
                carry: this.tans[car].clone().multiplyScalar(this.v * this.route.dirAt(this.d)),
              },
        ms,
        e.boss,
      );
      // A splat of green clay bursts off the rider (it lands in puddles), and the first
      // one (or the boss's) hits the lens when the camera is close.
      this.r.pukeBurst(this.mouths[car].clone(), this.fwds[car].clone(), e.boss ? 2.2 : 1 + hit);
      if (e.boss || this.lensSplats === 0) {
        if (this.r.lensSplat(this.mouths[car], e.boss)) this.lensSplats++;
      }
      // The boss watches the others go and gets nervous.
      if (this.bossCar >= 0 && car !== this.bossCar) this.worried = now + 900;
      // The on-ride camera catches the first puke (the boss's, if the boss goes).
      if (!this.photoTaken && this.timeline.indexOf(e) === this.photoPuke) this.snapPuke(car);
      if (e.boss) this.r.flashScreen(0.9);
      // Bosses and special riders get the slow-motion close-up.
      if ((e.boss || e.worth > 1) && e.nth === 1) {
        const car = e.car;
        this.r.dramatic(() => this.heads[car], e.boss ? 1900 : 1500, e.boss ? 0.26 : 0.32, 0.1, e.boss ? 'BLEEEEEGH' : 'HURRRK');
      }
    }
  }

  /** What each rider is owed at the final rating, beyond what their pukes already paid. */
  private payouts(e: ScoreEvent) {
    const paid = new Map<number, number>();
    const weight = new Map<number, number>();
    for (const ev of this.timeline)
      if (ev.kind === 'puke') {
        paid.set(ev.car, (paid.get(ev.car) ?? 0) + ev.pay);
        weight.set(ev.car, (weight.get(ev.car) ?? 0) + ev.worth);
      }
    return [...weight.entries()]
      .map(([car, w]) => {
        const t = this.result.tickets[car];
        return { car, pukes: w, amount: e.rating * w - (paid.get(car) ?? 0), worth: t ? w / Math.max(1, t.pukes) : 1, t };
      })
      .filter((p) => p.amount > 0 && p.t)
      .sort((a, b) => a.amount - b.amount);
  }

  /**
   * The finale: the rating slams together, then every rider who puked steps up
   * in turn and pukes once more for the crowd, cashing in all their pukes at
   * the final rating. Smallest first, biggest last. The pieces add up to the
   * slam's payout exactly; the total is set from the timeline at the end.
   */
  private startFinale(e: ScoreEvent, now: number): void {
    const list = this.payouts(e);
    if (!list.length) {
      this.slamAt = now;
      this.show.slam(e);
      setTimeout(() => this.r.slamFx(this.result.passed), 420);
      this.r.dismiss();
      return;
    }
    this.show.finaleStart(e);
    let t = now + 950;
    // The cash-in speeds up as it goes (smallest first, biggest last), all in about FINALE_MS.
    const specials = list.filter((p) => p.t!.rider.boss || p.worth > 1).length;
    const plain = Math.max(1, list.length - specials);
    let gap = Math.max(110, Math.min(560, (FINALE_MS - specials * 1200) / plain) * 1.5);
    const minGap = Math.max(60, gap * 0.3);
    list.forEach((p, rank) => {
      const boss = !!p.t!.rider.boss;
      const special = boss || p.worth > 1;
      if (special) t += 350;
      const at = t;
      this.finale.push({
        at,
        fn: () => {
          this.focusCar = p.car;
          if (special) this.r.dramatic(() => this.r.lineupHead(p.car), boss ? 1900 : 1500, 0.3, 0.14, boss ? 'ENCORE!' : 'ONE MORE!');
          this.r.lineupPuke(p.car, boss ? 80 : 18 + Math.min(40, rank * 4));
          this.show.finaleRider({
            amount: p.amount,
            name: p.t!.rider.name,
            pukes: p.pukes,
            worth: p.worth,
            rating: e.rating,
            at: this.r.project(this.r.lineupHead(p.car).setY(this.r.lineupHead(p.car).y + 0.12)),
            special,
            boss,
            rank,
          });
        },
      });
      t += special ? 1150 : gap;
      gap = Math.max(minGap, gap * 0.84);
    });
    this.finale.push({
      at: t + 380,
      fn: () => {
        this.slamAt = this.r.gameNow;
        this.show.finaleEnd(e);
        this.r.slamFx(this.result.passed);
        setTimeout(() => this.r.dismiss(), 900);
      },
    });
  }

  /** Click or space: the rest of the ride resolves at once (same totals). */
  skip(now: number): void {
    if (this.slamAt) {
      // Skipping again on the final score goes straight to the results.
      this.skipped = true;
      this.slamAt = Math.min(this.slamAt, now - OUTRO_MS);
      return;
    }
    this.skipped = true;
    this.show.countdown(-1);
    if (this.finale.length) {
      // Mid-finale: land the total now.
      this.finale = [];
      this.next = this.timeline.length;
      this.slamAt = now;
      this.show.finaleEnd(this.timeline[this.timeline.length - 1], true);
      this.r.slamFx(this.result.passed, true);
      this.r.dismiss();
      return;
    }
    if (!this.doneAt) {
      this.doneAt = now;
      this.d = this.route.total;
      this.r.disembark(this.result.tickets);
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
    this.r.slamFx(this.result.passed, true);
    this.r.dismiss();
  }

  /** The lift height and payoff on a ride stop's piece of track. */
  private levelOf(st: RideStop): CellLevel | undefined {
    const k = this.path.cells.findIndex((c) => !c.station && c.x === st.x && c.y === st.y && !!c.cross === !!st.cross);
    return k >= 0 ? this.path.levels[k] : undefined;
  }

  private enterCell(i: number, stop: number): void {
    const v = this.result.tickets[i];
    const st = this.stops[stop];
    const tier = st.tier;
    const lv = this.levelOf(st);
    const power = lv ? lv.mult - 1 + lv.finale : 0;
    // Special pieces: a whoosh, a splash, a screech of sparks.
    // The music whooshes into the big stuff with the lead car: the drop sting for a
    // Top Hat, a lift chain's payoff and the finale dive; the swell for inversions.
    if (i === 0 && (tier === 7 || power > 0)) music.rideEvent('drop');
    else if (i === 0 && PIECES[tier].inversion) music.rideEvent('loop');
    if (st.special === 'launch' && i === 0) {
      this.boostUntil = this.r.gameNow + 1100;
      sfx.launch();
      this.r.kick(3, 300);
      this.r.word('LAUNCH!', this.heads[0].clone().setY(this.heads[0].y + 0.4), '#7ff2ff', 1.2);
    }
    if (st.special === 'brakes' && i === 0) {
      this.brakeUntil = this.r.gameNow + 650;
      sfx.brakes();
      this.r.kick(4, 350);
    }
    if (st.special === 'brakes') this.r.sparkBurst(this.heads[i].clone().setY(this.heads[i].y - 0.2), 8);
    if (st.special === 'splash') {
      this.r.splash(this.heads[i].clone().setY(this.heads[i].y - 0.15));
      if (i === 0) sfx.splash();
    }
    if (st.flavor === 'water') {
      this.r.splash(this.heads[i].clone().setY(this.heads[i].y - 0.2));
      const now = this.r.gameNow;
      if (now - this.splashAt > 700) {
        this.splashAt = now;
        sfx.splash();
        if (i === 0) this.r.word('SPLOOSH!', this.heads[0].clone().setY(this.heads[0].y + 0.4), '#8fdcf6', 1.05);
      }
    }
    if (st.flavor === 'spin' && i === 0) {
      this.r.word('WHIRL!', this.heads[0].clone().setY(this.heads[0].y + 0.4), '#ff7eb6', 1.05);
      sfx.whistle();
    }
    if (st.flavor === 'hang' && i === 0) {
      this.r.word('HANG ON!', this.heads[0].clone().setY(this.heads[0].y + 0.3), '#c49dff', 1.05);
      sfx.clack();
    }
    if (!v) return;
    if (st.flavor === 'spin' || st.flavor === 'hang') {
      this.scream[i] = 0.9;
      if (Math.random() < 0.35) sfx.scream();
    }
    if ((tier >= 3 && tier !== LIFT) || power > 0) {
      this.scream[i] = 0.9;
      if (Math.random() < 0.3) {
        sfx.scream();
        if (Math.random() < 0.5) this.r.word(THRILL_WORDS[Math.floor(Math.random() * THRILL_WORDS.length)], this.heads[i].clone().setY(this.heads[i].y + 0.35), PAL.white);
      }
    }
    if (PIECES[tier].inversion && Math.random() < 0.3) this.r.hat(this.heads[i], SHIRTS[(v.rider.look.shirt + 3) % SHIRTS.length]);
  }

  /**
   * Park pieces move the cars: on a spinning piece each car whirls round (two
   * turns, eased in and out over the piece); on a hanging piece it swings down
   * under the rail, sways there, and swings back up on the way out.
   */
  private pose(i: number, s: number, cell: number, now: number): { spin?: number; hang?: number; sway?: number } | undefined {
    const c = this.path.cells[cell];
    const prev = this.spinAng[i];
    let spin = 0;
    let hang = 0;
    let sway = 0;
    if (c && !c.station && c.flavor) {
      const [a, b] = this.path.range(cell);
      const u = Math.max(0, Math.min(1, (s - a) / Math.max(1e-6, b - a)));
      if (c.flavor === 'spin') {
        const e = u * u * (3 - 2 * u);
        spin = this.spinDir[i] * e * Math.PI * 4;
      } else if (c.flavor === 'hang') {
        const ease = (x: number) => x * x * (3 - 2 * x);
        hang = ease(Math.min(1, u / 0.3)) * (1 - ease(Math.max(0, (u - 0.7) / 0.3)));
        // The pendulum: swung out by the turn and the speed, then wobbling back.
        sway = Math.sin(now / 1000 * 4.2 + i * 0.9) * 0.28 * Math.min(1, this.v);
      }
    }
    // Ease out of a spin that ended mid-turn (a shuttle backing up): wind back to straight.
    if (!spin && Math.abs(prev) > 1e-3) {
      const wrapped = Math.atan2(Math.sin(prev), Math.cos(prev));
      spin = wrapped * 0.85;
      if (Math.abs(spin) < 0.01) spin = 0;
    }
    this.spinAng[i] = spin;
    if (!spin && !hang) return undefined;
    return { spin, hang, sway };
  }

  /** How fast the train is going, 0 (crawling) to 1 (flat out), for the camera to feel it. */
  rush(): number {
    if (this.doneAt) return 0;
    return Math.max(0, Math.min(1, (this.v / this.speedK - 0.9) / 1.4));
  }

  /** The middle of the train, for the camera to lean toward. */
  focus(): Vector3 | null {
    if (this.doneAt || this.r.gameNow < this.startAt) return null;
    return this.path.sample(this.carS(Math.floor(this.cars / 2))).p;
  }

  finished(now: number): boolean {
    return this.slamAt > 0 && now - this.slamAt > (this.skipped ? OUTRO_MS * 0.6 : OUTRO_MS);
  }

  draw(now: number): void {
    const dt = Math.min(0.05, (now - (this.lastT || now)) / 1000);
    this.lastT = now;
    for (let i = 0; i < this.cars; i++) {
      const aboard = !this.doneAt && now >= (this.boardAt[i] ?? this.startAt - 150);
      if (aboard && !this.seated[i]) {
        this.seated[i] = true;
        sfx.board();
      }
      this.scream[i] = Math.max(0, this.scream[i] - dt);
      const v = this.result.tickets[i];
      const s = this.carS(i);
      const f = this.path.sample(s);
      const fl = this.path.cells[f.cell]?.flavor;
      const inverted = f.up.y < -0.2 || fl === 'hang' || fl === 'spin';
      const shot = this.r.inShot;
      // Wild through drops, inversions and slow-motion shots; each guest in their own way.
      // Hands up for the countdown's GO, the drops and the inversions; a big rush gets everyone.
      const rushing = this.rolling && !this.doneAt && (this.rush() > 0.45 || now - this.startAt < 900);
      const wild = shot || inverted || this.scream[i] > 0 || rushing;
      const puking = now < this.pukeUntil[i];
      const worried = i === this.bossCar && now < this.worried;
      const face: Face = puking ? 'puke' : this.sick[i] ? 'sick' : worried ? 'nervous' : v ? rideFace(v.rider, wild) : 'smile';
      const arms = this.sick[i] ? (shot ? 0.6 : 0.15) : v ? rideArms(v.rider, wild) : 0.1;
      const kind = i === 0 ? 'lead' : i === this.cars - 1 ? 'tail' : 'mid';
      const c = this.r.car(kind, s, aboard && v ? { look: v.rider.look, face, arms } : undefined, this.pose(i, s, f.cell, now));
      this.heads[i].copy(c.head);
      this.mouths[i].copy(c.mouth);
      this.fwds[i].copy(c.fwd);
      this.ups[i].copy(c.up);
      this.tans[i].copy(c.t);
      if (this.doneAt) continue;
      // Flumes: the cars plough a wake of spray.
      if (this.path.cells[f.cell]?.flavor === 'water' && f.up.y > 0.35 && Math.random() < dt * 30 * Math.min(1.5, this.v)) this.r.flumeSpray(f.p, f.t, f.right, this.v * this.route.dirAt(this.d));
      if (i === 0) this.fwd.copy(c.fwd);
    }
  }
}

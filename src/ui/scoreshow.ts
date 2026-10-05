import { music } from '../core/music';
import { sfx } from '../core/sfx';
import type { DayResult } from '../game';
import type { ScoreEvent } from '../run/timeline';
import { PATTERNS } from '../puzzle/patterns';
import { PATTERN_COLOR } from './skill';

// The live scoring show: page elements over and beside the park that build the
// day's score up while the train runs (Balatro's chips × mult, then the total).
// It only presents; the numbers all come from the ride's timeline.

const fmtMult = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(r < 10 ? 2 : 1).replace(/0+$/, '').replace(/\.$/, '');
};
const fmtNum = (n: number) => Math.round(n).toLocaleString();
/** Target milestones worth a cheer: the target, then ever bigger multiples of it. */
const MILESTONES = [1, 2, 5, 10, 25, 50, 100, 250, 1000];

export interface PopupOpts {
  cls: string;
  text: string;
  sub?: string;
  /** Scale boost for big hits. */
  big?: number;
  /** A colour of its own (ride patterns). */
  color?: string;
}

export class ScoreShow {
  private panel: HTMLDivElement;
  private layer: HTMLDivElement;
  private flash: HTMLDivElement;
  private el: Record<'total' | 'chips' | 'mult' | 'rating' | 'pukes' | 'fill' | 'goal' | 'ticker' | 'chipsBox' | 'multBox' | 'totalBox' | 'x', HTMLElement>;
  private result: DayResult | null = null;
  private shown = 0;
  private total = 0;
  /** Tickets already banked today before this ride (the always-running ride's laps): the odometer starts there. */
  private base = 0;
  private milestone = 0;
  private lastRoll = 0;
  private streak = 0;
  private reduce = false;
  private riderPukes = new Map<number, number>();
  private cheers = 0;
  private pukedYet = false;
  private lastCheer = 0;
  /** Screen shake requests go to the renderer. */
  onShake: (mag: number, ms: number) => void = () => {};
  /** Celebration bursts in the park (canvas particles). */
  onCheer: () => void = () => {};
  /** An attraction scores: its landmark in the park bounces. */
  onAttraction: (slot: number) => void = () => {};

  /** A boss puked (on a boss day, that cracks their composure). */
  onBossPuke: (() => void) | null = null;

  constructor(private wrap: HTMLElement) {
    this.panel = document.createElement('div');
    this.panel.className = 'scoreshow';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-live', 'off');
    this.panel.innerHTML = `
      <div class="ss-totalbox">
        <span class="ss-label">Tickets</span>
        <strong class="ss-total">0</strong>
        <div class="ss-goal"><span class="ss-fill"></span><span class="ss-goal-text"></span></div>
      </div>
      <div class="ss-cm">
        <div class="ss-box ss-chips"><span class="ss-cap">Excitement</span><b>0</b></div>
        <span class="ss-x">×</span>
        <div class="ss-box ss-mult"><span class="ss-cap">Mult</span><b>1</b></div>
      </div>
      <div class="ss-rate"><span><b class="ss-rating">0</b> a puke</span><span class="ss-pukes-wrap"><i class="ss-drop" aria-hidden="true"></i><b class="ss-pukes">0</b> pukes</span></div>
      <div class="ss-ticker"></div>`;
    wrap.append(this.panel);
    this.layer = document.createElement('div');
    this.layer.className = 'ss-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    this.flash = document.createElement('div');
    this.flash.className = 'ss-flash';
    this.layer.append(this.flash);
    document.body.append(this.layer);
    const q = (s: string) => this.panel.querySelector<HTMLElement>(s)!;
    this.el = {
      total: q('.ss-total'),
      chips: q('.ss-chips b'),
      mult: q('.ss-mult b'),
      rating: q('.ss-rating'),
      pukes: q('.ss-pukes'),
      fill: q('.ss-fill'),
      goal: q('.ss-goal-text'),
      ticker: q('.ss-ticker'),
      chipsBox: q('.ss-chips'),
      multBox: q('.ss-mult'),
      totalBox: q('.ss-totalbox'),
      x: q('.ss-x'),
    };
  }

  get active(): boolean {
    return !this.panel.hidden;
  }

  begin(result: DayResult): void {
    this.result = result;
    this.shown = 0;
    this.total = 0;
    this.base = Math.max(0, result.dayTotal - result.total);
    // Milestones the bank already passed don't cheer again.
    this.milestone = 0;
    while (this.milestone < MILESTONES.length && this.base / Math.max(1, result.target) >= MILESTONES[this.milestone]) this.milestone++;
    this.streak = 0;
    this.riderPukes.clear();
    this.pukedYet = false;
    this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.panel.className = 'scoreshow';
    this.panel.style.setProperty('--heat', '0');
    this.el.chips.textContent = '0';
    this.el.mult.textContent = '1';
    this.el.rating.textContent = '0';
    this.el.pukes.textContent = '0';
    this.el.total.textContent = fmtNum(this.base);
    this.el.ticker.textContent = result.kind === 'shuttle' ? 'Shuttle: every puke pays half' : 'All aboard!';
    this.el.goal.textContent = this.base ? `${fmtNum(this.base)} banked · target ${fmtNum(result.target)}` : `Target ${fmtNum(result.target)}`;
    this.el.fill.style.width = `${Math.min(100, (this.base / Math.max(1, result.target)) * 100)}%`;
    this.panel.hidden = false;
    document.querySelector('.app')?.classList.add('riding');
    this.layout();
  }

  end(): void {
    this.panel.hidden = true;
    this.result = null;
    document.querySelector('.app')?.classList.remove('riding');
    for (const p of this.layer.querySelectorAll('.ss-pop')) p.remove();
  }

  /** Docked along the bottom of the screen, where the ride bar was. */
  layout(): void {
    this.panel.dataset.mode = 'dock';
  }

  /** How many events have played this ride (the pitch ladder). */
  get step(): number {
    return this.streak;
  }

  /** Play one timeline event. `at` is where it happens on screen (page coordinates). */
  apply(e: ScoreEvent, at: { x: number; y: number } | null, quiet = false): void {
    const r = this.result;
    if (!r) return;
    const n = this.streak++;
    this.el.chips.textContent = fmtNum(e.chips);
    this.el.mult.textContent = fmtMult(e.mult);
    this.el.rating.textContent = fmtNum(e.rating);
    this.el.pukes.textContent = String(e.pukes);
    this.total = e.total;
    this.setStats(e);
    const heat = Math.min(1, Math.log2(Math.max(1, e.mult)) / 5);
    this.panel.style.setProperty('--heat', heat.toFixed(2));
    this.el.multBox.classList.toggle('fire', e.mult >= 8);
    if (quiet) return;
    const hit = Math.min(1, e.pay / Math.max(1, r.target * 0.15));
    switch (e.kind) {
      case 'chips':
        this.bump(this.el.chipsBox, 'bump');
        if (at) this.popup(at, { cls: 'chips', text: `+${e.amount}`, big: e.amount >= 13 ? 1.3 : 1 });
        this.ticker(`+${e.amount} excitement`);
        sfx.chip(n);
        break;
      case 'mult':
        this.bump(this.el.multBox, 'bump');
        if (e.why === 'pattern' && e.pattern) {
          // A ride pattern completes on this piece: its name pops over it, in its colour.
          const name = PATTERNS[e.pattern].name;
          if (at) this.popup({ x: at.x, y: at.y - 18 }, { cls: 'mult pattern', text: `${name.toUpperCase()}!`, sub: `+${fmtMult(e.amount)} mult`, big: 1.15 + Math.min(0.6, e.amount * 0.06), color: PATTERN_COLOR[e.pattern] });
          this.ticker(`${name}: +${fmtMult(e.amount)} mult`);
          sfx.pattern(e.amount);
          this.onShake(1 + Math.min(3, e.amount * 0.3), 160);
          break;
        }
        {
          const why = e.why === 'water' ? 'water run' : e.why === 'splash' ? 'splashdown' : 'new piece type';
          if (at) this.popup(at, { cls: 'mult', text: `+${fmtMult(e.amount)} mult`, sub: why });
          this.ticker(`${why[0].toUpperCase()}${why.slice(1)}: +${fmtMult(e.amount)} mult`);
        }
        sfx.mult(n);
        break;
      case 'puke': {
        const k = (this.riderPukes.get(e.car) ?? 0) + 1;
        this.riderPukes.set(e.car, k);
        this.riderPip(e.car, k);
        this.bump(this.el.totalBox, e.boss ? 'bump-big' : 'bump');
        const who = r.tickets[e.car]?.rider.name ?? 'Rider';
        if (at)
          this.popup(at, {
            cls: e.boss ? 'puke boss' : 'puke',
            text: `+${fmtNum(e.pay)}`,
            sub: e.boss ? `${who.toUpperCase()} BLEW!` : `BLEH${k > 1 ? ` ×${k}` : ''}${e.worth > 1 ? ` · ${e.worth}× worth` : ''}`,
            big: e.boss ? 2 : 1 + hit * 0.6,
          });
        this.ticker(`${who} puked${k > 1 ? ` ×${k}` : ''}: +${fmtNum(e.pay)}`);
        if (e.boss) {
          this.onBossPuke?.();
          this.doFlash('boss');
          sfx.bossPuke();
          music.stinger('boss');
          this.onShake(6, 700);
        } else {
          sfx.puke(n);
          if (!this.pukedYet) {
            this.pukedYet = true;
            music.stinger('puke');
          }
          this.onShake(1 + hit * 3, 120 + hit * 200);
        }
        break;
      }
      case 'attraction': {
        this.onAttraction(e.slot);
        const card = document.querySelectorAll<HTMLElement>('#attractions .attraction')[e.slot];
        if (card) {
          card.classList.remove('wiggle');
          void card.offsetWidth;
          card.classList.add('wiggle');
        }
        const fx = e.effect;
        const text = fx.xmult ? `×${fmtMult(fx.xmult)} mult` : fx.mult ? `+${fmtMult(fx.mult)} mult` : `+${fmtNum(fx.chips ?? 0)}`;
        const cls = fx.xmult ? 'xmult' : fx.mult ? 'mult' : 'chips';
        if (card) {
          const b = card.getBoundingClientRect();
          this.popup({ x: b.left + b.width / 2, y: b.bottom + 6 }, { cls: `${cls} attr`, text, big: fx.xmult ? 1.5 : 1.1 });
        }
        this.bump(fx.chips ? this.el.chipsBox : this.el.multBox, fx.xmult ? 'bump-big' : 'bump');
        this.ticker(`${e.label}: ${text}`);
        if (fx.xmult) {
          sfx.xmult(n);
          this.onShake(4, 260);
          this.doFlash('xmult');
        } else sfx.card(n);
        break;
      }
      case 'slam':
        break;
    }
  }

  /** The finale: chips and mult slam together into the rating, and the rating into the total. */
  slam(e: ScoreEvent, quick = false): void {
    const r = this.result;
    if (!r) return;
    this.apply(e, null, true);
    this.panel.classList.remove('slamming');
    void this.panel.offsetWidth;
    this.panel.classList.add('slamming');
    this.ticker(`${fmtNum(e.rating)} a puke × ${e.pukes} pukes`);
    const impact = () => {
      sfx.slam();
      this.onShake(quick ? 4 : 7, 450);
      this.doFlash('slam');
      this.bump(this.el.totalBox, 'bump-huge');
      // The payout lands in the middle of the park, big.
      const park = this.wrap.querySelector('canvas')?.getBoundingClientRect() ?? this.el.totalBox.getBoundingClientRect();
      if (e.pay > 0)
        this.popup({ x: park.left + park.width / 2, y: park.top + park.height * 0.45 }, { cls: 'slam', text: `+${fmtNum(e.pay)}`, sub: `${e.pukes} pukes × ${fmtNum(e.rating)}`, big: 2.2 });
      this.panel.classList.add('final', r.passed ? 'won' : 'lost');
    };
    if (quick || this.reduce) impact();
    else setTimeout(impact, 420);
  }

  /**
   * The puke finale, step 1: chips and mult slam together into the final rating.
   * The total doesn't move yet; the riders cash it in one by one.
   */
  finaleStart(e: ScoreEvent): void {
    const r = this.result;
    if (!r) return;
    this.el.chips.textContent = fmtNum(e.chips);
    this.el.mult.textContent = fmtMult(e.mult);
    this.el.rating.textContent = fmtNum(e.rating);
    this.setStats(e);
    this.panel.classList.remove('slamming');
    void this.panel.offsetWidth;
    this.panel.classList.add('slamming');
    this.ticker(`${fmtNum(e.rating)} a puke. Now pay up!`);
    const n = this.streak++;
    setTimeout(() => {
      sfx.xmult(n);
      this.onShake(4, 300);
      this.doFlash('xmult');
      const park = this.wrap.querySelector('canvas')?.getBoundingClientRect();
      if (park) this.popup({ x: park.left + park.width / 2, y: park.top + park.height * 0.34 }, { cls: 'slam', text: `${fmtNum(e.rating)} a puke`, sub: `${fmtNum(e.chips)} excitement × ${fmtMult(e.mult)} mult`, big: 1.7 });
    }, this.reduce ? 0 : 380);
  }

  /** Step 2: one rider cashes in all their pukes at the final rating. */
  finaleRider(o: { amount: number; name: string; pukes: number; worth: number; rating: number; at: { x: number; y: number } | null; special: boolean; boss: boolean; rank: number }): void {
    if (!this.result) return;
    const n = this.streak++;
    this.total += o.amount;
    const count = o.pukes / Math.max(1, o.worth);
    const sub = `${o.name.toUpperCase()} ${count > 1 ? `×${count} ` : ''}× ${fmtNum(o.rating)}${o.worth > 1 ? ` × ${o.worth}` : ''}`;
    if (o.at) this.popup(o.at, { cls: o.boss || o.special ? 'puke boss' : 'puke', text: `+${fmtNum(o.amount)}`, sub, big: o.boss ? 2.3 : o.special ? 1.9 : 1.2 + Math.min(0.8, o.rank * 0.08) });
    this.ticker(`${o.name}: ${sub} = +${fmtNum(o.amount)}`);
    this.bump(this.el.totalBox, o.boss || o.special ? 'bump-huge' : 'bump-big');
    if (o.boss) {
      sfx.bossPuke();
      music.stinger('boss');
      this.doFlash('boss');
      this.onShake(6, 700);
    } else {
      sfx.puke(n);
      if (o.special) this.doFlash('boss');
      this.onShake(2 + Math.min(4, o.rank * 0.4), 200);
    }
  }

  /** Step 3: the total lands. */
  finaleEnd(e: ScoreEvent, quick = false): void {
    const r = this.result;
    if (!r) return;
    this.total = e.total;
    this.el.pukes.textContent = String(e.pukes);
    sfx.slam();
    this.onShake(quick ? 4 : 7, 450);
    this.doFlash('slam');
    this.bump(this.el.totalBox, 'bump-huge');
    this.ticker(`${e.pukes} pukes × ${fmtNum(e.rating)} = ${fmtNum(e.total)} tickets`);
    const park = this.wrap.querySelector('canvas')?.getBoundingClientRect();
    if (park) this.popup({ x: park.left + park.width / 2, y: park.top + park.height * 0.45 }, { cls: 'slam', text: fmtNum(e.total), sub: `${e.pukes} pukes × ${fmtNum(e.rating)}`, big: 2.4 });
    this.panel.classList.add('final', r.passed ? 'won' : 'lost');
  }

  /** Called every frame: rolls the total up odometer-style and celebrates the target. */
  tick(dt: number, now: number): void {
    const r = this.result;
    if (!r) return;
    const diff = this.total - this.shown;
    if (diff > 0) {
      // Fast when far behind, easing into the final digits.
      this.shown = this.reduce ? this.total : Math.min(this.total, this.shown + Math.max(diff * Math.min(1, dt * 7), 3 * dt * 60));
      this.el.total.textContent = fmtNum(this.base + this.shown);
      if (now - this.lastRoll > 55) {
        this.lastRoll = now;
        sfx.roll(this.streak);
        this.el.totalBox.classList.add('rolling');
      }
    } else this.el.totalBox.classList.remove('rolling');
    const frac = (this.base + this.shown) / Math.max(1, r.target);
    this.el.fill.style.width = `${Math.min(100, frac * 100)}%`;
    this.panel.classList.toggle('cleared', frac >= 1);
    this.panel.style.setProperty('--glow', Math.min(1, frac / 5).toFixed(2));
    // Cheer once for the biggest milestone crossed this frame.
    const first = this.milestone === 0;
    let crossed = 0;
    while (this.milestone < MILESTONES.length && frac >= MILESTONES[this.milestone]) crossed = MILESTONES[this.milestone++];
    if (crossed) this.cheer(crossed, first);
  }

  private cheer(m: number, first: boolean): void {
    const box = this.el.totalBox.getBoundingClientRect();
    // Cheers in quick succession (the roll passing 1×, 2×, 5×...) stack upward instead of overlapping.
    const now = performance.now();
    this.cheers = now - this.lastCheer < 1200 ? this.cheers + 1 : 0;
    this.lastCheer = now;
    this.popup({ x: box.left + box.width / 2, y: box.top - this.cheers * 46 }, { cls: 'target', text: m === 1 ? 'TARGET!' : `${m}× TARGET!`, big: m === 1 ? 1.6 : 1.3 });
    this.el.goal.textContent = m === 1 ? 'Target reached!' : `${m}× the target!`;
    this.bump(this.el.totalBox, 'bump-huge');
    this.doFlash('target');
    if (first) {
      sfx.target();
      music.stinger('target');
    }
    else sfx.mult(this.streak + 4);
    this.onShake(first ? 5 : 3, 400);
    this.onCheer();
  }

  private setStats(e: ScoreEvent): void {
    const set = (id: string, v: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set('statChips', fmtNum(e.chips));
    set('statMult', fmtMult(e.mult));
    set('statRating', fmtNum(e.rating));
  }

  private riderPip(car: number, k: number): void {
    const id = this.result?.tickets[car]?.rider.id;
    const card = id !== undefined ? document.querySelector(`#queue [data-rider="${id}"]`) : null;
    if (!card) return;
    const pip = card.querySelector('.pukes i.off');
    if (pip) {
      pip.classList.remove('off');
      pip.classList.add('pop');
    }
    const v = card.querySelector('.verdict');
    if (v) {
      v.textContent = `Puked ${k === 1 ? 'once' : `×${k}`}`;
      v.className = 'verdict sick';
    }
    card.classList.remove('hit');
    void (card as HTMLElement).offsetWidth;
    card.classList.add('hit');
  }

  private ticker(text: string): void {
    this.el.ticker.textContent = text;
    this.bump(this.el.ticker, 'tick');
  }

  private bump(el: HTMLElement, cls: string): void {
    if (this.reduce) return;
    el.classList.remove('bump', 'bump-big', 'bump-huge', 'tick');
    void el.offsetWidth;
    el.classList.add(cls);
  }

  private doFlash(kind: string): void {
    if (this.reduce) return;
    this.flash.className = 'ss-flash';
    void this.flash.offsetWidth;
    this.flash.className = `ss-flash on ${kind}`;
  }

  popup(at: { x: number; y: number }, o: PopupOpts): void {
    const p = document.createElement('div');
    p.className = `ss-pop ${o.cls}`;
    // A little jitter so a burst of popups on one spot fans out instead of stacking.
    const j = o.cls.startsWith('puke') || o.cls.startsWith('chips') ? 1 : 0;
    p.style.left = `${at.x + j * (Math.random() - 0.5) * 36}px`;
    p.style.top = `${at.y - j * Math.random() * 14}px`;
    p.style.setProperty('--s', String(o.big ?? 1));
    p.style.setProperty('--r', `${(Math.random() - 0.5) * 14}deg`);
    if (o.color) p.style.setProperty('--pc', o.color);
    p.innerHTML = `${o.sub ? `<small>${o.sub}</small>` : ''}<span>${o.text}</span>`;
    this.layer.append(p);
    // Wide popups (ride patterns) stay on screen on a phone.
    if (o.color) {
      const half = (p.offsetWidth * 1.25) / 2 + 6;
      const w = this.layer.clientWidth || window.innerWidth;
      if (half * 2 < w) p.style.left = `${Math.min(w - half, Math.max(half, at.x))}px`;
    }
    const kill = () => p.remove();
    p.addEventListener('animationend', kill);
    setTimeout(kill, 2500);
  }
}

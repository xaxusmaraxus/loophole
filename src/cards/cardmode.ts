import { Rng, randomSeed } from '../core/rng';
import type { Game } from '../game';
import { PATTERNS, type PatternId } from '../puzzle/patterns';
import { PIECES } from '../puzzle/pieces';
import { TIER_RAMPS } from '../render/palette';
import { patternCounts } from '../ui/skill';
import { stripHtml } from '../ui/strip';
import { type CardRun, DAYS, REWARDS, type RewardId, canMerge, dayOver, discardCard, endCardDay, mergeCards, newCardRun, playCard, rewardChoices, runOver, runWon, startCardDay, takeReward } from './cardgame';
import { cardPark, cardScore, layRide } from './cardpark';

// The Coaster Cards screen: your hand of coaster cards, today's ride as a row of
// slots, and the live score. Tap a card to pick it up; tap it again to play it onto
// the ride, or tap a matching card to merge them. When the ride is full, ride it:
// the real closing ride runs and scores. Between days, pick a reward.

const ICON = ['', '⌒', '⛓', '🌀', '◯', '➰', '🐍', '🎩'];
const BLURB = ['', 'A gentle hump.', 'Stores height: the next element hits harder.', 'A banked spiral.', 'Upside down!', 'A barrel roll. Upside down!', 'Two half loops. Upside down!', 'Straight up and over.'];

export class CardMode {
  run: CardRun | null = null;
  private rng = new Rng(1);
  private seed = '';
  private sel: number | null = null;
  private modal: 'none' | 'reward' | 'end' = 'none';
  private choices: RewardId[] = [];
  private lastPassed = false;
  private readonly panel: HTMLElement;
  private readonly modalEl: HTMLElement;

  constructor(
    private readonly game: Game,
    private readonly act: (fn: () => void) => void,
  ) {
    this.panel = document.getElementById('cardPanel')!;
    this.modalEl = document.getElementById('cardModal')!;
    this.panel.addEventListener('click', (e) => this.click(e));
    this.modalEl.addEventListener('click', (e) => this.click(e));
    window.addEventListener('keydown', (e) => this.key(e), true);
  }

  get active(): boolean {
    return !!this.run && this.game.cards;
  }

  start(seed = randomSeed()): void {
    this.seed = seed;
    this.rng = Rng.fromSeed(`CARDS-${seed}`);
    this.run = newCardRun();
    this.modal = 'none';
    document.body.classList.add('cards-mode');
    this.startDay();
  }

  /** Leaves card mode (a new season or Daily took over the park). */
  stop(): void {
    this.run = null;
    this.modal = 'none';
    document.body.classList.remove('cards-mode');
    this.panel.hidden = true;
    this.modalEl.hidden = true;
  }

  private startDay(): void {
    const run = this.run!;
    startCardDay(run, this.rng);
    this.lastPile = -1;
    cardPark(run, this.seed, this.game);
    layRide(this.game, run);
    this.sel = null;
    this.act(() => {});
    this.render();
  }

  /** After the ride's results: score the day, then a reward (or the end of the run). */
  afterResults(): void {
    const run = this.run!;
    const r = this.game.result;
    this.lastPassed = endCardDay(run, r ? r.dayTotal : 0);
    if (run.hearts <= 0 || run.day >= DAYS) {
      if (run.hearts > 0) run.day++;
      this.modal = 'end';
    } else {
      this.choices = rewardChoices(run, this.rng);
      this.modal = 'reward';
    }
    this.render();
  }

  // ---- Input ----

  private key(e: KeyboardEvent): void {
    if (!this.active || this.modal !== 'none' || this.game.phase !== 'build') return;
    const n = Number(e.key);
    if (n >= 1 && n <= this.run!.hand.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.tapCard(n - 1);
    } else if (e.key === 'Enter' && dayOver(this.run!)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.rideIt();
    }
  }

  private click(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
    if (!t || !this.run) return;
    const what = t.dataset.c!;
    const i = Number(t.dataset.i ?? -1);
    if (what === 'card') this.tapCard(i);
    else if (what === 'play' && this.sel !== null) this.play(this.sel);
    else if (what === 'discard' && this.sel !== null) this.discard(this.sel);
    else if (what === 'ride') this.rideIt();
    else if (what === 'reward') this.pick(this.choices[i] ?? null);
    else if (what === 'skip') this.pick(null);
    else if (what === 'again') this.start();
  }

  private tapCard(i: number): void {
    const run = this.run!;
    if (this.sel === null) this.sel = i;
    else if (this.sel === i) return this.play(i);
    else if (canMerge(run, this.sel, i)) return this.merge(this.sel, i);
    else this.sel = i;
    this.render();
  }

  private play(i: number): void {
    const run = this.run!;
    if (!playCard(run, i)) return;
    this.sel = null;
    layRide(this.game, run);
    const cell = this.game.board.ends[0][run.ride.length - 1];
    if (cell) this.game.events.push({ type: 'build', laid: cell, end: 0 });
    this.act(() => {});
    this.render();
  }

  private merge(i: number, j: number): void {
    const run = this.run!;
    const keep = Math.min(i, j);
    const other = Math.max(i, j);
    if (!mergeCards(run, keep, other)) return;
    this.sel = null;
    this.mergedAt = keep;
    this.render();
  }
  private mergedAt = -1;

  private discard(i: number): void {
    if (!discardCard(this.run!, i)) return;
    this.sel = null;
    this.render();
  }

  private rideIt(): void {
    const g = this.game;
    if (g.phase !== 'build') return;
    layRide(g, this.run!);
    g.banked = 0;
    g.cfg.target = this.run!.target;
    this.sel = null;
    this.panel.hidden = true;
    this.act(() => g.open('circuit'));
  }

  private pick(id: RewardId | null): void {
    takeReward(this.run!, id);
    this.modal = 'none';
    this.startDay();
  }

  // ---- What a play would do ----

  /** The ride's score if card i were played now, and the patterns it would add. */
  private preview(i: number): { score: number; gained: PatternId[] } {
    const g = this.game;
    const run = this.run!;
    const before = patternCounts(g.stats.patterns);
    const ride = [...run.ride, run.hand[i]];
    g.board.ends[0].forEach((c, k) => (c.tier = ride[k] ?? 0));
    const score = cardScore(g);
    const after = patternCounts(g.stats.patterns);
    layRide(g, run);
    const gained = (Object.keys(PATTERNS) as PatternId[]).filter((id) => (after.get(id) ?? 0) > (before.get(id) ?? 0));
    return { score, gained };
  }

  // ---- Drawing ----

  private cardHtml(t: number, i: number, cls = ''): string {
    const r = TIER_RAMPS[t];
    return `<button type="button" class="ccard t${t} ${cls}" data-c="card" data-i="${i}" style="--c1:${r[0]};--c2:${r[1]};--c3:${r[3]};--i:${i}" aria-label="${PIECES[t].name}">
      <span class="cc-key">${i + 1}</span>
      <span class="cc-ic" aria-hidden="true">${ICON[t]}</span>
      <span class="cc-name">${PIECES[t].name}</span>
      <span class="cc-pips">${'●'.repeat(t)}</span>
      <span class="cc-blurb">${BLURB[t]}</span>
    </button>`;
  }

  render(): void {
    const run = this.run;
    const g = this.game;
    if (!run) return;
    // The modal (rewards, end of run).
    this.modalEl.hidden = this.modal === 'none';
    let modal = '';
    if (this.modal === 'reward') {
      const s = run.scores[run.scores.length - 1];
      modal = `<div class="cm-card">
        <p class="eyebrow">Day ${run.day} of ${DAYS} · ${s.toLocaleString()} / ${run.target.toLocaleString()}</p>
        <h2>${this.lastPassed ? 'Ride approved! 🎢' : 'Short of the target 💔'}</h2>
        <p>${this.lastPassed ? 'Pick one for your deck:' : `You lost a heart (${run.hearts} left). Pick one for your deck:`}</p>
        <div class="cm-rewards">${this.choices
          .map((id, i) => `<button type="button" class="cm-reward" data-c="reward" data-i="${i}"><strong>${REWARDS[id].name}</strong><span>${REWARDS[id].desc}</span></button>`)
          .join('')}</div>
        <button type="button" class="ghost-dark" data-c="skip">Skip</button>
        <p class="muted">Deck: ${[...run.deck].sort((a, b) => a - b).map((t) => ICON[t]).join(' ')}</p>
      </div>`;
    } else if (this.modal === 'end') {
      const won = runWon(run);
      const total = run.scores.reduce((a, b) => a + b, 0);
      modal = `<div class="cm-card">
        <p class="eyebrow">Coaster Cards</p>
        <h2>${won ? 'Season complete! 🏆' : 'The park closed 😵'}</h2>
        <p>${won ? `All ${DAYS} days beaten` : `You made it to day ${Math.min(run.day, DAYS)} of ${DAYS}`} with <strong>${total.toLocaleString()}</strong> tickets in all.</p>
        <p class="muted">Days: ${run.scores.map((s) => s.toLocaleString()).join(' · ')}</p>
        <button type="button" class="primary" data-c="again">Play again</button>
      </div>`;
    }
    if (modal && modal !== this.lastModal) this.modalEl.innerHTML = modal;
    this.lastModal = modal;
    // The table: only while building.
    const building = g.phase === 'build' && this.modal === 'none' && !runOver(run);
    this.panel.hidden = !building;
    if (!building) return;
    const live = cardScore(g);
    const rating = g.score('circuit').rating;
    const pukes = g.queue.reduce((a, r) => a + g.pukes(r, 'circuit'), 0);
    const full = dayOver(run);
    const left = run.slots - run.ride.length;
    const pv = this.sel !== null ? this.preview(this.sel) : null;
    // The ride row: played cards (with pattern brackets), then empty slots.
    const path = g.board.ends[0].slice(0, run.ride.length).map((c) => ({ tier: c.tier, x: c.x, y: c.y }));
    const hits = g.stats.patterns.filter((h) => h.cells.every((k) => k < run.ride.length));
    const slots = Array.from({ length: left }, (_, k) => `<span class="sc slot${k === 0 && pv ? ' next' : ''}" style="grid-column:${run.ride.length + 2 + k}">${k === 0 && pv ? ICON[run.hand[this.sel!]] : ''}</span>`).join('');
    const ride = stripHtml(path, hits).replace(/<span class="sc station" style="grid-column:\d+" title="Back at the station">🏁<\/span>/, '') + slots + `<span class="sc station" style="grid-column:${run.slots + 2}">🏁</span>`;
    const pct = Math.min(1, live / run.target);
    const sel = this.sel;
    // Cards drawn since the last frame slide in; the rest stay put.
    const drawn = this.lastPile < 0 ? run.hand.length : Math.max(0, this.lastPile - run.pile.length);
    const fresh = run.hand.length - drawn;
    this.lastPile = run.pile.length;
    const hand = run.hand
      .map((t, i) => this.cardHtml(t, i, `${sel === i ? 'sel' : ''}${sel !== null && sel !== i && canMerge(run, sel, i) ? ' match' : ''}${this.mergedAt === i ? ' merged' : ''}${i >= fresh ? ' new' : ''}`))
      .join('');
    this.mergedAt = -1;
    const hint = full
      ? '<strong>Your ride is ready.</strong> Ride it and see who pukes!'
      : sel === null
        ? `Tap a card to pick it up. Tap it again to play it onto the ride${run.hand.some((t, i) => run.hand.some((u, j) => i !== j && u === t && t < 7)) ? ', or tap a matching card to merge them' : ''}.`
        : `<strong>${PIECES[run.hand[sel]].name}</strong>: tap again to play it${pv ? ` (ride ${live.toLocaleString()} → <b>${pv.score.toLocaleString()}</b>${pv.gained.length ? `, makes <b>${pv.gained.map((id) => PATTERNS[id].name).join(', ')}</b>` : ''})` : ''}${run.hand.some((u, j) => j !== sel && canMerge(run, sel, j)) ? '; tap a glowing match to merge' : ''}.`;
    const html = `
      <div class="cp-top">
        <span class="cp-day">Day ${run.day}/${DAYS}</span>
        <span class="cp-hearts">${'❤️'.repeat(run.hearts)}${'🖤'.repeat(Math.max(0, 3 - run.hearts))}</span>
        <span class="cp-score" title="Every puke pays the ride's rating (excitement × multiplier). Riders puke when the ride's nausea passes their stomach.">
          <span class="cp-part"><b>${rating.toLocaleString()}</b><small>a puke</small></span><span class="cp-x">×</span><span class="cp-part"><b>${pukes}</b><small>pukes 🤢</small></span><span class="cp-x">=</span><span class="cp-part total"><b>${live.toLocaleString()}</b><small>of ${run.target.toLocaleString()}</small></span>
        </span>
        <span class="cp-bar"><i style="width:${pct * 100}%"></i></span>
      </div>
      <div class="cp-ride"><div class="st-grid">${ride}</div></div>
      <p class="cp-hint">${hint}</p>
      <div class="cp-hand">${hand}</div>
      <div class="cp-actions">
        <span class="cp-pile" title="Cards left to draw today">🂠 ${run.pile.length}</span>
        <button type="button" class="ghost-dark" data-c="discard" ${sel === null || run.discards <= 0 ? 'disabled' : ''}>Discard (${run.discards})</button>
        <button type="button" class="ghost-dark" data-c="play" ${sel === null || full ? 'disabled' : ''}>Play ▶</button>
        <button type="button" class="primary${full ? ' ready' : ''}" data-c="ride" ${full ? '' : 'disabled'}>Ride it! 🎢 <small>${left ? `${left} slot${left === 1 ? '' : 's'} left` : ''}</small></button>
      </div>`;
    // Only rebuild when something changed (rebuilding restarts the cards' animations).
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.panel.innerHTML = html;
    }
  }
  private lastHtml = '';
  private lastPile = -1;
  private lastModal = '';
}

import type { Game } from '../game';
import { MIN_LOOP, canClose } from '../puzzle/board';
import { KINDS, type Rider, type Verdict } from '../riders/riders';
import { drawPortrait } from '../render/sprites';
import { PERKS } from '../run/run';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const VERDICT_LABEL: Record<Verdict, string> = { happy: 'Would love it', meh: 'Not impressed', sick: 'Would throw up' };
const REPORT_LABEL: Record<Verdict, string> = { happy: 'Loved it', meh: 'Not impressed', sick: 'Threw up' };
const ARROW: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };

export class Hud {
  private portraits = new Map<number, HTMLCanvasElement>();

  constructor(private game: Game) {}

  update(): void {
    const g = this.game;
    $('day').textContent = `Day ${g.dayNum}`;
    $('hearts').innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="heart${i < g.hearts ? '' : ' lost'}" aria-hidden="true"></span>`).join('');
    $('hearts').setAttribute('aria-label', `${g.hearts} of 3 park reputation left`);
    $('quota').textContent = `Need ${g.cfg.quota} happy riders`;
    $('seed').textContent = g.seed;

    const s = g.stats;
    $('statLength').textContent = String(s.length);
    $('statThrill').textContent = String(s.thrill);
    $('statNausea').textContent = String(s.nausea);
    $('statInversions').textContent = String(s.inversions);

    const close = canClose(g.board);
    const station = $('station');
    if (g.phase !== 'build') station.textContent = '';
    else if (close) station.innerHTML = `<strong>Station in reach.</strong> Swipe ${ARROW[close]} to open the ride, or keep building.`;
    else if (g.board.path.length < MIN_LOOP) station.textContent = `Lay ${MIN_LOOP - g.board.path.length} more piece${MIN_LOOP - g.board.path.length === 1 ? '' : 's'} before you can close the loop.`;
    else station.textContent = 'Bring the track back next to the station to open the ride.';
    station.classList.toggle('ready', !!close && g.phase === 'build');

    $<HTMLButtonElement>('undo').disabled = g.phase !== 'build' || g.undos === 0;
    $('undoCount').textContent = String(g.undos);
    $('bestCombo').textContent = g.bestCombo >= 2 ? `x${g.bestCombo}` : 'none yet';
    $('perks').textContent = g.perks.length ? g.perks.map((p) => PERKS[p].name).join(', ') : 'None yet';

    this.renderQueue();
    this.renderOverlay();
  }

  private renderQueue(): void {
    const g = this.game;
    const list = $('queue');
    $('queueCount').textContent = `${g.queue.length}`;
    if (!g.queue.length) {
      list.innerHTML = '<li class="empty">Nobody in line. More riders arrive as you build.</li>';
      return;
    }
    list.replaceChildren(...g.queue.map((r) => this.riderCard(r, g.phase === 'build' ? g.predict(r) : null)));
  }

  private riderCard(r: Rider, verdict: Verdict | null): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'rider';
    let portrait = this.portraits.get(r.id);
    if (!portrait) {
      portrait = document.createElement('canvas');
      portrait.width = 11;
      portrait.height = 14;
      portrait.className = 'portrait';
      drawPortrait(portrait, r.look);
      this.portraits.set(r.id, portrait);
    }
    const pct = Math.max(0, r.patience / r.maxPatience);
    const info = document.createElement('div');
    info.className = 'rider-info';
    info.innerHTML = `
      <div class="rider-top"><span class="rider-name">${r.name}</span><span class="rider-kind">${KINDS[r.kind].label}</span></div>
      <div class="rider-want">${KINDS[r.kind].want(r)}</div>
      <div class="rider-bottom">
        <span class="patience${r.patience <= 3 ? ' low' : ''}" title="Leaves in ${r.patience} swipes"><span style="width:${pct * 100}%"></span></span>
        ${verdict ? `<span class="verdict ${verdict}">${VERDICT_LABEL[verdict]}</span>` : ''}
      </div>`;
    li.append(portrait, info);
    return li;
  }

  private renderOverlay(): void {
    const g = this.game;
    const el = $('overlay');
    el.hidden = !['results', 'perk', 'over'].includes(g.phase);
    if (el.hidden) return;
    if (g.phase === 'results' && g.result) {
      const r = g.result;
      const rows = r.verdicts
        .map((v) => `<li><span>${v.rider.name}</span><span class="verdict ${v.verdict}">${r.stuck ? 'Went home' : REPORT_LABEL[v.verdict]}</span></li>`)
        .join('');
      el.innerHTML = `
        <div class="card">
          <h2>${r.stuck ? 'Dead end!' : 'Ride report'}</h2>
          <p>${r.stuck ? 'The track can’t reach the station anymore. The queue went home.' : `${r.happy} of ${r.verdicts.length} riders loved it. You needed ${r.quota}.`}</p>
          ${rows ? `<ul class="report">${rows}</ul>` : '<p class="muted">Nobody was left in line.</p>'}
          <p class="outcome ${r.passed ? 'good' : 'bad'}">${r.passed ? 'Day passed.' : 'Missed the target. The park loses a heart.'}</p>
          <button class="primary" data-action="continue" autofocus>Continue</button>
        </div>`;
    } else if (g.phase === 'perk') {
      el.innerHTML = `
        <div class="card">
          <h2>Pick a perk</h2>
          <p>It lasts for the rest of the run. Day ${g.dayNum + 1} is next.</p>
          <div class="perks">
            ${g.offer.map((id) => `<button class="perk" data-action="perk" data-perk="${id}"><strong>${PERKS[id].name}</strong><span>${PERKS[id].desc}</span></button>`).join('')}
          </div>
        </div>`;
    } else if (g.phase === 'over') {
      el.innerHTML = `
        <div class="card">
          <h2>The park closed</h2>
          <p>You made it to day ${g.dayNum} and made <strong>${g.happyTotal}</strong> riders happy.</p>
          <p class="muted">Best run: ${g.best} happy riders. Seed ${g.seed}.</p>
          <button class="primary" data-action="newrun" autofocus>Start a new run</button>
        </div>`;
    }
  }
}

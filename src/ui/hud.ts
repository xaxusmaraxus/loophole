import type { Game, RideKind } from '../game';
import { canConnect, trackLength } from '../puzzle/board';
import { KINDS, type Rider, type Verdict } from '../riders/riders';
import { drawPortrait } from '../render/sprites';
import { TOOLS, type ToolId, UPGRADES, type UpgradeId } from '../run/run';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const VERDICT_LABEL: Record<Verdict, string> = { happy: 'Will tip', meh: 'Will pay', sick: 'Will get sick' };
const REPORT_LABEL: Record<Verdict, string> = { happy: 'Tipped', meh: 'Paid', sick: 'Got sick' };

export class Hud {
  private portraits = new Map<number, HTMLCanvasElement>();

  constructor(private game: Game) {}

  update(): void {
    const g = this.game;
    $('day').textContent = `Day ${g.dayNum}`;
    $('hearts').innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="heart${i < g.hearts ? '' : ' lost'}" aria-hidden="true"></span>`).join('');
    $('hearts').setAttribute('aria-label', `${g.hearts} of 3 park reputation left`);
    $('quota').textContent = `Sell ${g.cfg.target} tickets`;
    $('seed').textContent = g.seed;

    // Daylight.
    const frac = Math.min(1, Math.max(0, g.daylight / g.cfg.daylight));
    $('daylightBar').style.width = `${frac * 100}%`;
    $('daylightBar').classList.toggle('dusk', frac < 0.3);
    $('daylightLeft').textContent = g.daylight > 0 ? `${g.daylight} swipe${g.daylight === 1 ? '' : 's'} of daylight left` : 'Sunset: no more swipes';

    // Ride stats.
    const s = g.stats;
    $('statExcitement').textContent = String(s.excitement);
    $('statLength').textContent = String(s.length);
    $('statThrill').textContent = String(s.thrill);
    $('statVariety').textContent = String(s.variety);
    $('statInversions').textContent = String(s.inversions);
    $('statNausea').textContent = String(s.nausea);
    $('bestCombo').textContent = g.bestCombo >= 2 ? `x${g.bestCombo}` : 'none yet';
    const counts = new Map<UpgradeId, number>();
    for (const u of g.upgrades) counts.set(u, (counts.get(u) ?? 0) + 1);
    $('perks').textContent = counts.size ? [...counts].map(([u, n]) => `${UPGRADES[u].name}${n > 1 ? ` ×${n}` : ''}`).join(', ') : 'None yet';
    this.renderTools();

    // What to do next, and the open button.
    const building = g.phase === 'build';
    const kind = g.openKind;
    const hint = $('station');
    const aim = g.aiming;
    if (!building) hint.textContent = '';
    else if (aim?.tool === 'paint') hint.textContent = 'Tap a tile to paint it up a tier. Tap the Paint Can again to cancel.';
    else if (aim?.tool === 'dynamite') hint.textContent = 'Tap a tree, rock, pond or stand to blow it up.';
    else if (aim?.tool === 'crane') hint.textContent = aim.first ? 'Now tap where the tile should go.' : 'Tap the tile the crane should lift.';
    else if (g.daylight <= 0 && !canConnect(g.board)) hint.textContent = 'The sun has set. No more swipes, but you can still build and open the ride.';
    else if (canConnect(g.board)) hint.innerHTML = '<strong>The ends meet!</strong> Open the full circuit, or keep building for a wilder ride.';
    else if (trackLength(g.board) === 0) hint.textContent = 'Tap a highlighted cell next to the station to start building.';
    else hint.textContent = 'Steer the two pennants toward each other to close the loop, or cash out now as a shuttle.';
    hint.classList.toggle('ready', building && canConnect(g.board));
    const open = $<HTMLButtonElement>('open');
    open.disabled = !kind;
    open.classList.toggle('circuit', kind === 'circuit');
    open.innerHTML = kind ? `${kind === 'circuit' ? 'Open the ride' : 'Open as shuttle'} <span class="count">${g.projected(kind)}</span>` : 'Open the ride';
    open.title = kind === 'shuttle' ? 'Out and back along the track, at half the excitement' : '';

    $<HTMLButtonElement>('undo').disabled = !building || g.undos === 0;
    $('undoCount').textContent = String(g.undos);
    $<HTMLButtonElement>('switchEnd').disabled = !building;
    $('switchEnd').dataset.end = String(g.selected);

    this.renderQueue();
    this.renderOverlay();
  }

  private renderTools(): void {
    const g = this.game;
    const bar = $('tools');
    const owned = (Object.keys(TOOLS) as ToolId[]).filter((t) => g.tools[t] > 0);
    if (!owned.length) {
      bar.innerHTML = '<span class="muted">No tools yet. Earn them between days.</span>';
      return;
    }
    bar.innerHTML = owned
      .map(
        (t, i) =>
          `<button type="button" class="tool${g.aiming?.tool === t ? ' active' : ''}" data-tool="${t}" title="${TOOLS[t].desc} (key ${i + 1})" ${g.phase === 'build' ? '' : 'disabled'}>${TOOLS[t].name} <span class="count">${g.tools[t]}</span></button>`,
      )
      .join('');
  }

  private renderQueue(): void {
    const g = this.game;
    const list = $('queue');
    $('queueCount').textContent = `${g.queue.length}`;
    if (!g.queue.length) {
      list.innerHTML = '<li class="empty">Nobody in line yet. A wilder ride draws a crowd.</li>';
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
    const info = document.createElement('div');
    info.className = 'rider-info';
    info.innerHTML = `
      <div class="rider-top"><span class="rider-name">${r.name}</span><span class="rider-kind">${KINDS[r.kind].label}</span></div>
      <div class="rider-bottom">
        <span class="rider-want">Tips if: ${KINDS[r.kind].want(r)}</span>
        ${verdict ? `<span class="verdict ${verdict}">${VERDICT_LABEL[verdict]}</span>` : ''}
      </div>`;
    li.append(portrait, info);
    return li;
  }

  private renderOverlay(): void {
    const g = this.game;
    const el = $('overlay');
    el.hidden = !['results', 'reward', 'over'].includes(g.phase);
    if (el.hidden) return;
    if (g.phase === 'results' && g.result) {
      const r = g.result;
      const title: Record<RideKind, string> = { circuit: 'Ride report', shuttle: 'Shuttle report' };
      const rows = r.tickets
        .map((t) => `<li><span>${t.rider.name}</span><span class="verdict ${t.verdict}">${REPORT_LABEL[t.verdict]}</span><span class="paid">${t.paid}</span></li>`)
        .join('');
      el.innerHTML = `
        <div class="card">
          <h2>${title[r.kind]}</h2>
          <p>Excitement ${r.stats.excitement}${r.kind === 'shuttle' ? ' (shuttle, half)' : ''}. Every rider paid that, more if you met their wish.</p>
          ${rows ? `<ul class="report">${rows}</ul>` : ''}
          <p class="total"><span>Tickets sold</span><strong>${r.score} / ${r.target}</strong></p>
          <p class="outcome ${r.passed ? 'good' : 'bad'}">${r.passed ? 'Target reached. Day passed.' : 'Short of the target. The park loses a heart.'}</p>
          <button class="primary" data-action="continue" autofocus>Continue</button>
        </div>`;
    } else if (g.phase === 'reward') {
      el.innerHTML = `
        <div class="card">
          <h2>Pick a reward</h2>
          <p>Upgrades last all run. Tools go in your toolbar to use whenever you want. Day ${g.dayNum + 1} is next.</p>
          <div class="perks">
            ${g.offer
              .map((r, i) => {
                const def = r.kind === 'upgrade' ? UPGRADES[r.id] : TOOLS[r.id];
                const tag = r.kind === 'upgrade' ? 'Upgrade' : `Tool ×${TOOLS[r.id].charges}`;
                return `<button class="perk kind-${r.kind}" data-action="reward" data-index="${i}"><span class="tag">${tag}</span><strong>${def.name}</strong><span>${def.desc}</span></button>`;
              })
              .join('')}
          </div>
        </div>`;
    } else if (g.phase === 'over') {
      el.innerHTML = `
        <div class="card">
          <h2>The park closed for good</h2>
          <p>You made it to day ${g.dayNum} and sold <strong>${g.runScore}</strong> tickets.</p>
          <p class="muted">Best run: ${g.best} tickets. Seed ${g.seed}.</p>
          <button class="primary" data-action="newrun" autofocus>Start a new run</button>
        </div>`;
    }
  }
}

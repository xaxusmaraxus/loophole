import type { Game, RideKind } from '../game';
import { canConnect, trackLength } from '../puzzle/board';
import { BOSSES, MAX_PUKES, type Rider, riderLabel, riderTrait, riderWorth } from '../riders/riders';
import { drawPortrait } from '../render/sprites';
import { ATTRACTIONS, ATTRACTION_SLOTS, type Effect } from '../run/attractions';
import { FINALE_DAY, NODE_INFO, PARKS, PARK_BOSS, type Reward, SEASON_ORDER, type ShopItem, TOOLS, type ToolId, UPGRADES, type UpgradeId, sellValue } from '../run/run';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const pukeLabel = (n: number, future: boolean) =>
  n > 0 ? `${future ? 'Pukes' : 'Puked'} ${n === 1 ? 'once' : `×${n}`}` : future ? 'Keeps it down' : 'Kept it down';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(n < 10 ? 2 : 1).replace(/0+$/, '').replace(/\.$/, ''));

function effectText(e: Effect): string {
  const parts: string[] = [];
  if (e.chips) parts.push(`+${fmt(e.chips)} excitement`);
  if (e.mult) parts.push(`+${fmt(e.mult)} mult`);
  if (e.xmult && e.xmult !== 1) parts.push(`×${fmt(e.xmult)} mult`);
  return parts.join(', ');
}

function rewardLabel(r: Reward | ShopItem): { tag: string; name: string; desc: string } {
  if (r.kind === 'upgrade') return { tag: 'Upgrade', name: UPGRADES[r.id].name, desc: UPGRADES[r.id].desc };
  if (r.kind === 'tool') return { tag: `Tool ×${TOOLS[r.id].charges}`, name: TOOLS[r.id].name, desc: TOOLS[r.id].desc };
  if (r.kind === 'attraction') return { tag: ATTRACTIONS[r.id].rarity === 'rare' ? 'Rare attraction' : 'Attraction', name: ATTRACTIONS[r.id].name, desc: ATTRACTIONS[r.id].desc };
  return { tag: 'Repair', name: 'Repair a heart', desc: 'Win back one heart of park reputation.' };
}

export class Hud {
  private portraits = new Map<number, HTMLCanvasElement>();
  private lastOverlay = '';

  constructor(private game: Game) {}

  update(): void {
    const g = this.game;
    const park = g.cfg.park;
    $('day').textContent = park.id === 'finale' ? park.name : `${park.name} · Day ${g.dayNum} of ${FINALE_DAY}`;
    $('hearts').innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="heart${i < g.hearts ? '' : ' lost'}" aria-hidden="true"></span>`).join('');
    $('hearts').setAttribute('aria-label', `${g.hearts} of 3 park reputation left`);
    $('quota').textContent = `Sell ${g.cfg.target.toLocaleString()} tickets`;
    $('funds').textContent = `Funds ${g.funds.toLocaleString()}`;
    $('seed').textContent = g.seed;

    // Today's twist: boss, storm or VIP.
    const banner = $('dayBanner');
    const node = g.cfg.node;
    if (g.cfg.boss) banner.innerHTML = `<strong>${node === 'finale' ? 'Grand Opening' : 'Boss day'}: ${BOSSES[g.cfg.boss].name} is in line.</strong> Make them puke to clear the day. ${BOSSES[g.cfg.boss].trait}`;
    else if (node === 'storm' || node === 'vip' || node === 'finale') banner.innerHTML = `<strong>${NODE_INFO[node].name}.</strong> ${NODE_INFO[node].desc}`;
    banner.hidden = !(g.cfg.boss || node === 'storm' || node === 'vip' || node === 'finale');
    banner.className = `day-banner ${g.cfg.boss ? 'boss' : node}`;

    // Daylight.
    const frac = Math.min(1, Math.max(0, g.daylight / g.cfg.daylight));
    $('daylightBar').style.width = `${frac * 100}%`;
    $('daylightBar').classList.toggle('dusk', frac < 0.3);
    $('daylightLeft').textContent = g.daylight > 0 ? `${g.daylight} swipe${g.daylight === 1 ? '' : 's'} of daylight left` : 'Sunset: no more swipes';

    // Excitement × multiplier.
    const kind = g.openKind;
    const sc = g.score(kind ?? 'circuit');
    $('statChips').textContent = fmt(sc.chips);
    $('statMult').textContent = fmt(sc.mult);
    $('statRating').textContent = fmt(sc.rating);
    const s = g.stats;
    $('statLength').textContent = String(s.length);
    $('statThrill').textContent = String(s.thrill);
    $('statVariety').textContent = String(s.variety);
    $('statInversions').textContent = String(s.inversions);
    $('statNausea').textContent = String(s.nausea);
    $('bestCombo').textContent = g.bestCombo >= 2 ? `x${g.bestCombo}` : 'none yet';
    const counts = new Map<UpgradeId, number>();
    for (const u of g.upgrades) counts.set(u, (counts.get(u) ?? 0) + 1);
    $('perks').textContent = counts.size ? [...counts].map(([u, n]) => `${UPGRADES[u].name}${n > 1 ? ` ×${n}` : ''}`).join(', ') : 'None yet';
    this.renderAttractions(new Set(sc.steps.slice(1).map((st) => st.label)));
    this.renderTools();

    // What to do next, and the open button.
    const building = g.phase === 'build';
    const hint = $('station');
    const aim = g.aiming;
    if (!building) hint.textContent = '';
    else if (aim?.tool === 'paint') hint.textContent = 'Tap a tile to paint it up a tier. Tap the Paint Can again to cancel.';
    else if (aim?.tool === 'dynamite') hint.textContent = 'Tap a tree, rock, pond or stand to blow it up.';
    else if (aim?.tool === 'crane') hint.textContent = aim.first ? 'Now tap where the tile should go.' : 'Tap the tile the crane should lift.';
    else if (canConnect(g.board)) hint.innerHTML = '<strong>The ends meet!</strong> Open the full circuit, or keep building for a wilder ride.';
    else if (g.daylight <= 0) hint.textContent = 'The sun has set. No more swipes, but you can still build and open the ride.';
    else if (trackLength(g.board) === 0) hint.textContent = 'Tap a highlighted cell above the platform to start building.';
    else hint.textContent = 'Steer the two pennants toward each other to close the loop, or cash out now as a shuttle.';
    hint.classList.toggle('ready', building && canConnect(g.board));
    const open = $<HTMLButtonElement>('open');
    open.disabled = !kind;
    open.classList.toggle('circuit', kind === 'circuit');
    open.innerHTML = kind ? `${kind === 'circuit' ? 'Open the ride' : 'Open as shuttle'} <span class="count">${g.projected(kind).toLocaleString()}</span>` : 'Open the ride';
    open.title = kind === 'shuttle' ? 'Out and back along the track, at half the rating' : '';

    $<HTMLButtonElement>('undo').disabled = !building || g.undos === 0;
    $('undoCount').textContent = String(g.undos);
    $<HTMLButtonElement>('switchEnd').disabled = !building;
    $('switchEnd').dataset.end = String(g.selected);

    this.renderQueue();
    this.renderOverlay();
  }

  private renderAttractions(firing: Set<string>): void {
    const g = this.game;
    const strip = $('attractions');
    const cards = g.attractions.map((a, i) => {
      const def = ATTRACTIONS[a.id];
      const extra = a.id === 'seasonpass' ? ` <span class="count">+${1 + a.counter}</span>` : '';
      return `<li class="attraction ${def.rarity}${firing.has(def.name) ? ' firing' : ''}">
        <div class="attraction-name">${def.name}${extra}</div>
        <div class="attraction-desc">${def.desc}</div>
        <div class="attraction-actions">
          <button type="button" data-attr-move="${i}" data-by="-1" aria-label="Move ${def.name} left" ${i === 0 ? 'disabled' : ''}>◀</button>
          <button type="button" data-attr-sell="${i}" title="Sell for ${sellValue(g.dayNum)} funds">Sell ${sellValue(g.dayNum)}</button>
          <button type="button" data-attr-move="${i}" data-by="1" aria-label="Move ${def.name} right" ${i === g.attractions.length - 1 ? 'disabled' : ''}>▶</button>
        </div>
      </li>`;
    });
    for (let i = g.attractions.length; i < ATTRACTION_SLOTS; i++) cards.push('<li class="attraction empty">Empty slot</li>');
    strip.innerHTML = cards.join('');
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
    list.replaceChildren(...g.queue.map((r) => this.riderCard(r, g.phase === 'build' ? g.pukes(r) : null)));
  }

  private riderCard(r: Rider, pukes: number | null): HTMLLIElement {
    const g = this.game;
    const li = document.createElement('li');
    li.className = `rider${r.kind === 'vip' ? ' vip' : ''}${r.boss ? ' boss' : ''}`;
    let portrait = this.portraits.get(r.id);
    if (!portrait) {
      portrait = document.createElement('canvas');
      portrait.width = 11;
      portrait.height = 14;
      portrait.className = 'portrait';
      drawPortrait(portrait, r.look);
      this.portraits.set(r.id, portrait);
    }
    const worth = riderWorth(r);
    const info = document.createElement('div');
    info.className = 'rider-info';
    info.innerHTML = `
      <div class="rider-top"><span class="rider-name">${r.name}</span><span class="rider-kind">${riderLabel(r)}${worth > 1 ? ` · ${worth}× per puke` : ''}</span></div>
      <div class="rider-want">Stomach ${g.stomach(r)}. ${riderTrait(r)}</div>
      ${pukes !== null ? `<div class="rider-bottom"><span class="pukes" aria-label="${pukeLabel(pukes, true)}">${'<i></i>'.repeat(pukes)}${'<i class="off"></i>'.repeat(MAX_PUKES - pukes)}</span><span class="verdict ${pukes > 0 ? 'sick' : 'meh'}">${pukeLabel(pukes, true)}</span></div>` : ''}`;
    li.append(portrait, info);
    return li;
  }

  private renderOverlay(): void {
    const g = this.game;
    const el = $('overlay');
    el.hidden = !['intro', 'map', 'results', 'reward', 'shop', 'over', 'won'].includes(g.phase);
    if (el.hidden) {
      this.lastOverlay = '';
      return;
    }
    const html = this.overlayHtml();
    // Don't restart animations (the tally) when nothing changed.
    if (html === this.lastOverlay) return;
    this.lastOverlay = html;
    el.innerHTML = html;
    el.classList.toggle('wide', g.phase === 'map');
    if (g.phase === 'map') requestAnimationFrame(() => this.drawMapLines());
    if (g.phase === 'results') this.countUp();
  }

  private overlayHtml(): string {
    const g = this.game;
    if (g.phase === 'intro') {
      const park = g.cfg.park;
      const n = SEASON_ORDER.indexOf(park.id) + 1;
      return `
        <div class="card intro">
          <p class="eyebrow">${park.id === 'finale' ? `Season finale · Day ${FINALE_DAY}` : `Park ${n} of 3`}</p>
          <h2>${park.name}</h2>
          <p>${park.intro}</p>
          <ul class="rules">${park.rules.map((r) => `<li>${r}</li>`).join('')}</ul>
          <button class="primary" data-action="begin" autofocus>${park.id === 'finale' ? 'Open the gates' : 'See the map'}</button>
        </div>`;
    }
    if (g.phase === 'map') return this.mapHtml();
    if (g.phase === 'shop') {
      return `
        <div class="card">
          <p class="eyebrow">${g.cfg.park.name}</p>
          <h2>Park shop</h2>
          <p>You have <strong>${g.funds.toLocaleString()}</strong> in park funds. Attraction slots: ${g.attractions.length} of ${ATTRACTION_SLOTS}.</p>
          <div class="perks">
            ${g.shop
              .map((item, i) => {
                const { tag, name, desc } = rewardLabel(item);
                const blocked = item.sold || g.funds < item.price || (item.kind === 'heart' && g.hearts >= 3) || (item.kind === 'attraction' && !g.slotsFree);
                return `<button class="perk shop-item kind-${item.kind}" data-action="buy" data-index="${i}" ${blocked ? 'disabled' : ''}><span class="price">${item.sold ? 'Sold' : item.price.toLocaleString()}</span><span class="tag">${tag}</span><strong>${name}</strong><span>${desc}</span></button>`;
              })
              .join('')}
          </div>
          <button class="primary" data-action="leave">Back to the map</button>
        </div>`;
    }
    if (g.phase === 'won') {
      return `
        <div class="card">
          <p class="eyebrow">Season complete</p>
          <h2>The Grand Opening was a hit!</h2>
          <p>You sold <strong>${g.runScore.toLocaleString()}</strong> tickets over the season.</p>
          <p class="muted">Best run: ${g.best.toLocaleString()} tickets. Seed ${g.seed}.</p>
          <button class="primary" data-action="newrun" autofocus>Start a new season</button>
        </div>`;
    }
    if (g.phase === 'results' && g.result) return this.resultsHtml();
    if (g.phase === 'reward') {
      const full = !g.slotsFree && g.offer.every((r) => r.kind === 'attraction');
      return `
        <div class="card">
          <h2>Pick a reward</h2>
          <p>Upgrades last all run. Tools go in your toolbar. Attractions change how every ride scores (${g.attractions.length} of ${ATTRACTION_SLOTS} slots used).</p>
          <div class="perks">
            ${g.offer
              .map((r, i) => {
                const { tag, name, desc } = rewardLabel(r);
                const blocked = r.kind === 'attraction' && !g.slotsFree;
                return `<button class="perk kind-${r.kind}" data-action="reward" data-index="${i}" ${blocked ? 'disabled' : ''}><span class="tag">${tag}</span><strong>${name}</strong><span>${desc}</span></button>`;
              })
              .join('')}
          </div>
          ${full ? '<p class="muted">Your attraction slots are full. Sell one from the strip above the park to make room, or skip.</p>' : ''}
          <button class="ghost-dark" data-action="skip">Skip</button>
        </div>`;
    }
    if (g.phase === 'over') {
      return `
        <div class="card">
          <h2>The park closed for good</h2>
          <p>You made it to ${g.cfg.park.name}, day ${g.dayNum} of the season, and sold <strong>${g.runScore.toLocaleString()}</strong> tickets.</p>
          <p class="muted">Best run: ${g.best.toLocaleString()} tickets. Seed ${g.seed}.</p>
          <button class="primary" data-action="newrun" autofocus>Start a new season</button>
        </div>`;
    }
    return '';
  }

  /** Balatro-style tally: each line pops in after the last, then the total counts up. */
  private resultsHtml(): string {
    const g = this.game;
    const r = g.result!;
    const title: Record<RideKind, string> = { circuit: 'Ride report', shuttle: 'Shuttle report' };
    let i = 0;
    const steps = r.score.steps
      .map((st, k) => {
        const delta = k === 0 ? '' : `<span class="delta">${effectText(st.effect)}</span>`;
        return `<li class="tally-row" style="--i:${i++}"><span class="tally-label">${st.label}${delta}</span><span class="chipmult"><span class="chips">${fmt(st.chips)}</span><span class="times">×</span><span class="mult">${fmt(st.mult)}</span></span></li>`;
      })
      .join('');
    const rating = `<li class="tally-row rating" style="--i:${i++}"><span>Every puke pays</span><strong>${r.score.rating.toLocaleString()}</strong></li>`;
    const riders = r.tickets
      .map((t) => {
        const worth = riderWorth(t.rider);
        return `<li class="tally-row${t.rider.boss ? ' boss' : ''}" style="--i:${i++}"><span>${t.rider.name}${worth > 1 && t.pukes ? ` <small>×${worth}</small>` : ''}</span><span class="verdict ${t.pukes ? 'sick' : 'meh'}">${pukeLabel(t.pukes, false)}</span><span class="paid">${t.paid.toLocaleString()}</span></li>`;
      })
      .join('');
    const delay = i * 180;
    return `
      <div class="card results">
        <h2>${title[r.kind]}</h2>
        <ul class="tally">${steps}${rating}</ul>
        ${riders ? `<ul class="report">${riders}</ul>` : ''}
        <p class="total big" style="--delay:${delay}ms"><span>Tickets sold</span><strong><span id="countUp" data-to="${r.total}" data-delay="${delay}">0</span> / ${r.target.toLocaleString()}</strong></p>
        ${r.passed ? `<p class="total"><span>Into park funds</span><strong>+${(r.total - r.target).toLocaleString()}</strong></p>` : ''}
        <p class="outcome ${r.passed ? 'good' : 'bad'}">${
          r.passed
            ? g.cfg.boss
              ? `${BOSSES[g.cfg.boss].name} lost their lunch. Park cleared!`
              : 'Target reached.'
            : !r.bossPuked
              ? `${BOSSES[g.cfg.boss!].name} kept it down. The park loses a heart${g.cfg.node === 'finale' ? ', and the Grand Opening runs again tomorrow' : ''}.`
              : `Short of the target. The park loses a heart${g.cfg.node === 'finale' ? ', and the Grand Opening runs again tomorrow' : ''}.`
        }</p>
        <button class="primary" data-action="continue" autofocus>Continue</button>
      </div>`;
  }

  private countUp(): void {
    const el = document.getElementById('countUp');
    if (!el) return;
    const to = Number(el.dataset.to);
    const delay = Number(el.dataset.delay);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      el.textContent = to.toLocaleString();
      return;
    }
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / 700));
      el.textContent = Math.round(to * (1 - (1 - t) ** 3)).toLocaleString();
      if (t < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private mapHtml(): string {
    const g = this.game;
    const park = g.cfg.park;
    const next = SEASON_ORDER[g.parkIndex + 1];
    const cols = g.parkMap
      .map((col, ci) => {
        const nodes = col
          .map((n, ni) => {
            const visited = g.visited.some((v) => v.col === ci && v.node === ni);
            const current = g.mapPos?.col === ci && g.mapPos.node === ni;
            const reachable = g.isReachable(ci);
            const info = NODE_INFO[n.kind];
            const boss = n.kind === 'boss' ? PARK_BOSS[park.id] : undefined;
            const name = boss ? `Boss: ${BOSSES[boss].name}` : info.name;
            const desc = boss ? `Stomach ${BOSSES[boss].stomach}. ${BOSSES[boss].trait}` : info.desc;
            const state = current ? 'current' : visited ? 'visited' : reachable ? 'reachable' : 'locked';
            return `<button type="button" class="map-node ${n.kind} ${state}" data-action="node" data-col="${ci}" data-node="${ni}" ${reachable ? '' : 'disabled'} title="${desc}">
              <span class="node-dot" aria-hidden="true"></span>
              <span class="node-name">${name}</span>
              <span class="node-desc">${desc}</span>
            </button>`;
          })
          .join('');
        return `<div class="map-col" data-col="${ci}">${nodes}</div>`;
      })
      .join('');
    return `
      <div class="card map-card">
        <p class="eyebrow">${park.name} · Season day ${g.dayNum} of ${FINALE_DAY}</p>
        <h2>Pick your route</h2>
        ${g.notice ? `<p class="notice">${g.notice}</p>` : '<p>Days are in the columns. The last one is the park’s boss.</p>'}
        <div class="map" id="map"><svg class="map-lines" id="mapLines" aria-hidden="true"></svg>${cols}</div>
        <p class="muted">Next: ${next ? PARKS[next].name : 'the end of the season'}.</p>
      </div>`;
  }

  /** Connect every node to every node in the next column. */
  private drawMapLines(): void {
    const map = document.getElementById('map');
    const svg = document.getElementById('mapLines');
    if (!map || !svg) return;
    const box = map.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const cols = [...map.querySelectorAll<HTMLElement>('.map-col')];
    const lines: string[] = [];
    for (let c = 0; c + 1 < cols.length; c++)
      for (const a of cols[c].querySelectorAll<HTMLElement>('.node-dot'))
        for (const b of cols[c + 1].querySelectorAll<HTMLElement>('.node-dot')) {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const on = a.closest('.visited, .current') && b.closest('.visited, .current, .reachable');
          lines.push(
            `<line x1="${ra.left + ra.width / 2 - box.left}" y1="${ra.top + ra.height / 2 - box.top}" x2="${rb.left + rb.width / 2 - box.left}" y2="${rb.top + rb.height / 2 - box.top}" class="${on ? 'on' : ''}"/>`,
          );
        }
    svg.innerHTML = lines.join('');
  }
}

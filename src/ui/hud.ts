import type { Game, RideKind } from '../game';
import { canConnect, trackLength } from '../puzzle/board';
import { SPECIALS, type SpecialId } from '../puzzle/pieces';
import { BOSSES, BOSS_ROUNDS, type BossId, KINDS, type Look, MAX_PUKES, type Rider, riderLabel, riderTrait, riderWorth } from '../riders/riders';
import { FLAVORS, PIECES } from '../puzzle/pieces';
import { SECONDS_EVERY, SPIN_EVERY, WAVE_EVERY, spun } from '../run/bossday';
import { PLOT_W } from '../run/plot';
import { drawPortrait3D } from '../render3d/portrait';
import { mapHtml } from './map';
import { photoStore } from './photo';
import { lastRecord, playerName, recordLocal } from './scores';
import { setShareText, shareLinks } from './share';
import { ATTRACTIONS, type Effect, THEMES } from '../run/attractions';
import { EGGS, type EggItem, FINALE_DAY, NODE_INFO, type Reward, SEASON_ORDER, type ShopItem, TOOLS, type ToolId, UPGRADES, type UpgradeId, sellValue } from '../run/run';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ARROW = { up: '↑', right: '→', down: '↓', left: '←' } as const;

/** A boss's portrait as an image URL (rendered once per boss). */
const bossArt = new Map<BossId, string>();
export function bossPortrait(id: BossId): string {
  let url = bossArt.get(id);
  if (url !== undefined) return url;
  const c = document.createElement('canvas');
  const look: Look = { skin: 1, hair: 0, hairStyle: 'short', shirt: 0, pants: 1, accessory: 'none', small: false, ...BOSSES[id].look };
  url = drawPortrait3D(c, look) ? c.toDataURL() : '';
  bossArt.set(id, url);
  return url;
}

/** Every boss, the ones you've broken in gold. */
export function trophyShelf(broken: readonly BossId[]): string {
  const all = Object.keys(BOSSES) as BossId[];
  return `<div class="trophies" aria-label="Trophy shelf: ${broken.length} of ${all.length} bosses broken">${all
    .map((id) => {
      const won = broken.includes(id);
      const art = bossPortrait(id);
      return `<figure class="trophy${won ? ' won' : ''}" title="${won ? `${BOSSES[id].name}: broken` : 'Not broken yet'}">${art ? `<img src="${art}" alt="">` : ''}<figcaption>${won ? BOSSES[id].name : '?'}</figcaption></figure>`;
    })
    .join('')}</div>`;
}

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

function rewardLabel(r: Reward | ShopItem | EggItem, day = 1): { tag: string; name: string; desc: string } {
  if (r.kind === 'egg') return { tag: 'Capsule egg', name: EGGS[r.id].name, desc: EGGS[r.id].desc };
  if (r.kind === 'rider') {
    const k = KINDS[r.id];
    return { tag: 'Bus tour', name: `+1 ${k.label} every morning`, desc: `Stomach ${k.stomach(day)}. ${k.trait}` };
  }
  if (r.kind === 'upgrade') return { tag: 'Upgrade', name: UPGRADES[r.id].name, desc: UPGRADES[r.id].desc };
  if (r.kind === 'tool') return { tag: `Tool ×${TOOLS[r.id].charges}`, name: TOOLS[r.id].name, desc: TOOLS[r.id].desc };
  if (r.kind === 'special') return { tag: 'Special piece', name: SPECIALS[r.id].name, desc: SPECIALS[r.id].desc };
  if (r.kind === 'attraction') return { tag: { common: 'Attraction · 1×1', rare: 'Rare attraction · 2×1', legendary: 'Legendary · 2×2' }[ATTRACTIONS[r.id].rarity], name: ATTRACTIONS[r.id].name, desc: ATTRACTIONS[r.id].desc };
  return { tag: 'Repair', name: 'Repair a heart', desc: 'Win back one heart of park reputation.' };
}

export class Hud {
  private portraits = new Map<number, HTMLCanvasElement>();
  private lastOverlay = '';
  private lastStrip = '';

  constructor(private game: Game) {}

  update(): void {
    const g = this.game;
    const park = g.cfg.park;
    $('day').innerHTML = park.id === 'finale' ? park.name : `<span class="pn">${park.name} · </span>Day ${g.dayNum}<span class="of"> of ${FINALE_DAY}</span>`;
    $('hearts').innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="heart${i < g.hearts ? '' : ' lost'}" aria-hidden="true"></span>`).join('');
    $('hearts').setAttribute('aria-label', `${g.hearts} of 3 park reputation left`);
    $('quota').textContent = `Sell ${g.cfg.target.toLocaleString()} tickets`;
    $('funds').textContent = `Funds ${g.funds.toLocaleString()}`;
    $('seed').textContent = g.seed;

    // Today's twist: boss, storm or VIP.
    const banner = $('dayBanner');
    const node = g.cfg.node;
    if (g.cfg.boss) this.renderBossBar(banner);
    else if (node === 'storm' || node === 'vip' || node === 'finale') banner.innerHTML = `<strong>${NODE_INFO[node].name}.</strong> ${NODE_INFO[node].desc}`;
    banner.hidden = !(g.cfg.boss || node === 'storm' || node === 'vip' || node === 'finale');
    banner.className = `day-banner ${g.cfg.boss ? 'boss' : node}`;

    // Room: free cells left on the board. When nothing can move, it's gridlock.
    const cells = g.board.size * g.board.size;
    const frac = Math.min(1, Math.max(0, g.room / cells));
    $('daylightBar').style.width = `${frac * 100}%`;
    $('daylightBar').classList.toggle('dusk', g.room <= 4);
    $('daylightLeft').textContent = g.room > 0 ? `${g.room} free cell${g.room === 1 ? '' : 's'} left` : 'Board full: one more move, or gridlock';

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
    // Park pieces on the track, by kind (only the park's own kinds).
    const kinds = g.cfg.park.flavors;
    $('statFlavors').textContent = kinds.map((f) => `${FLAVORS[f].icon}${s.flavors[f]}`).join(' ');
    $('statFlavorBox').title = kinds.map((f) => `${FLAVORS[f].name}: ${FLAVORS[f].desc}`).join(' ');
    $('statNausea').textContent = String(s.nausea);
    $('bestCombo').textContent = g.bestCombo >= 2 ? `×${g.bestCombo}` : '–';
    const counts = new Map<UpgradeId, number>();
    for (const u of g.upgrades) counts.set(u, (counts.get(u) ?? 0) + 1);
    $('perks').textContent = counts.size ? [...counts].map(([u, n]) => `${UPGRADES[u].name}${n > 1 ? ` ×${n}` : ''}`).join(', ') : 'None yet';
    const crowd = new Map<string, number>();
    for (const k of g.crowd) crowd.set(KINDS[k].label, (crowd.get(KINDS[k].label) ?? 0) + 1);
    $('crowd').textContent = crowd.size ? [...crowd].map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`).join(', ') : 'None yet';
    this.renderAttractions(new Set(sc.steps.slice(1).map((st) => st.label)));
    this.renderTools();

    // What to do next, and the open button.
    const building = g.phase === 'build';
    const hint = $('station');
    const aim = g.aiming;
    if (!building) hint.textContent = '';
    else if (aim?.tool === 'paint') hint.textContent = 'Tap a tile to paint it up a tier. Tap the Paint Can again to cancel.';
    else if (aim?.tool === 'dynamite') hint.textContent = 'Tap a tree, rock, pond or stand to blow it up.';
    else if (aim && aim.tool in SPECIALS) hint.textContent = `Tap a piece of your track to fit the ${SPECIALS[aim.tool as SpecialId].name} there. Tap it again to cancel.`;
    else if (aim?.tool === 'crane') hint.textContent = aim.first ? 'Now tap where the tile should go.' : 'Tap the tile the crane should lift.';
    else if (aim?.tool === 'crew') hint.textContent = 'Tap a cell right next to an end of the track: the crew lays it by hand.';
    else if (canConnect(g.board)) hint.innerHTML = '<strong>The ends meet!</strong> Open the full circuit now, or keep feeding it for a wilder ride.';
    else if (trackLength(g.board) === 0) hint.innerHTML = 'Swipe tiles <strong>into the red and blue ends</strong> on the platform: the track eats them. Merge first, the bigger the piece the wilder the ride.';
    else hint.textContent = 'Feed both ends and bring them back together to close the loop. Get boxed in and it opens by itself.';
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
    this.renderBossCard();
    if (g.phase !== 'ride') this.cracks = 0;
  }

  private lastBoss = '';
  /** Boss pukes seen so far this ride. */
  private cracks = 0;

  /** The score show saw the boss puke: crack a pip now. */
  bossCrack(): void {
    this.cracks++;
    this.update();
  }

  /** The boss bar: who, their composure, the ride count, and their rule as it stands right now. */
  private renderBossBar(el: HTMLElement): void {
    const g = this.game;
    const f = g.fight;
    const id = g.cfg.boss!;
    const def = BOSSES[id];
    const boss = g.queue.find((r) => r.boss);
    if (!f) return;
    const building = g.phase === 'build';
    const hits = building && boss ? Math.min(f.hp, g.pukes(boss)) : 0;
    // During the ride the pips crack as the boss actually pukes.
    const r = g.result;
    const hp = g.phase === 'ride' && r ? Math.max(r.bossHp, r.bossHpBefore - this.cracks) : f.hp;
    const pips = Array.from({ length: f.max }, (_, i) => {
      const broken = i >= hp;
      const due = !broken && i >= f.hp - hits;
        return `<i class="${broken ? 'broken' : due ? 'due' : ''}${broken && i === hp && g.phase === 'ride' ? ' fresh' : ''}"></i>`;
    }).join('');
    const left = (every: number) => every - (g.actions % every);
    let live = '';
    if (def.rule === 'seconds' && boss) live = `Stomach <b>${g.stomach(boss)}</b> · next snack in ${left(SECONDS_EVERY)}`;
    else if (def.rule === 'waves') live = `Next wave <b class="arrow">${ARROW[f.wave]}</b> in ${left(WAVE_EVERY)} swipe${left(WAVE_EVERY) === 1 ? '' : 's'}`;
    else if (def.rule === 'whistle') live = 'A swipe with no merge drops in <b>2</b> extra tiles';
    else if (def.rule === 'spin')
      live = `<span class="compass" aria-label="Swiping up goes ${spun('up', f.spin)}">${(['up', 'right', 'down', 'left'] as const).map((d) => `<span class="c-${d}">${ARROW[spun(d, f.spin)]}</span>`).join('')}</span> turns in ${left(SPIN_EVERY)}`;
    else if (def.rule === 'seenitall') {
      const tiers = [...new Set(g.board.ends.flat().map((c) => c.tier).filter((t) => t > 0))].sort();
      live = tiers.length ? `Counts once each: ${tiers.map((t) => PIECES[t].name).join(', ')}` : 'Every piece type counts once';
    } else if (def.rule === 'blackout') live = 'You can only see tiles next to your track';
    else if (def.rule === 'demands') live = `<span class="demands">${g.demands().map((d) => `<span class="${d.met ? 'met' : ''}">${d.met ? '✓' : '✗'} ${d.text}</span>`).join('')}</span>`;
    const preview = building && boss ? (g.refuses(boss, g.openKind ?? 'circuit') ? 'Won’t get on yet' : hits ? `This ride cracks ${hits}` : 'This ride: no crack yet') : '';
    const html = `
      <div class="bb-who">${bossPortrait(id) ? `<img class="bb-face" src="${bossPortrait(id)}" alt="">` : ''}
        <div class="bb-name"><strong>${def.name}</strong><span>Ride ${f.round} of ${BOSS_ROUNDS}${f.banked ? ` · ${f.banked.toLocaleString()} banked` : ''}</span></div></div>
      <div class="bb-hp" aria-label="Composure: ${f.hp} of ${f.max} left"><span class="bb-label">Composure</span><span class="pips">${pips}</span><span class="bb-preview">${preview}</span></div>
      <div class="bb-rule"><span class="bb-rule-name" title="${def.ruleDesc}">${def.ruleName}</span><span class="bb-live">${live}</span></div>`;
    if (html === this.lastBoss) return;
    this.lastBoss = html;
    el.innerHTML = html;
  }

  /** Which boss title card has been seen (day:round). */
  private bossSeen = '';
  private bossTimer = 0;

  /** The boss's title card at the start of the day, and a "Ride 2" slam for rematches. */
  private renderBossCard(): void {
    const g = this.game;
    const el = $('bossCard');
    const f = g.fight;
    const key = f ? `${g.seed}:${g.dayNum}:${f.round}` : '';
    if (!f || g.phase !== 'build' || this.bossSeen === key) {
      if (g.phase !== 'build') el.hidden = true;
      return;
    }
    this.bossSeen = key;
    const id = g.cfg.boss!;
    const def = BOSSES[id];
    clearTimeout(this.bossTimer);
    el.hidden = false;
    if (f.round === 1) {
      el.className = 'boss-card intro';
      el.innerHTML = `
        <div class="bc-inner" role="dialog" aria-label="Boss: ${def.name}">
          <p class="bc-eyebrow">${g.cfg.node === 'finale' ? 'The Grand Opening' : 'Boss day'}</p>
          ${bossPortrait(id) ? `<img class="bc-face" src="${bossPortrait(id)}" alt="">` : ''}
          <h2 class="bc-name">${def.name}</h2>
          <p class="bc-quip">“${def.quip}”</p>
          <div class="bc-rule"><strong>${def.ruleName}</strong><span>${def.ruleDesc}</span></div>
          <p class="bc-goal">Make them puke <b>${def.composure}×</b> to break them. You get up to <b>${BOSS_ROUNDS} rides</b>. Stomach ${def.stomach}. ${def.trait}</p>
          <button type="button" class="primary bc-go" data-boss-go>Bring it on!</button>
        </div>`;
      this.onBossCard?.('intro');
    } else {
      el.className = 'boss-card round';
      el.innerHTML = `<div class="bc-round"><span>Ride ${f.round}</span><small>${def.name} · ${f.hp} more puke${f.hp === 1 ? '' : 's'} to break</small></div>`;
      this.onBossCard?.('round');
      this.bossTimer = window.setTimeout(() => (el.hidden = true), 1900);
    }
  }

  /** Tells the page a boss card went up (for music). */
  onBossCard: ((kind: 'intro' | 'round') => void) | null = null;

  private renderAttractions(firing: Set<string>): void {
    const g = this.game;
    const strip = $('attractions');
    // Attractions in scoring order (top row of the plot first). Rearrange them on the plot between days.
    const cards = g.attractions.map((a) => {
      const def = ATTRACTIONS[a.id];
      const extra = a.id === 'seasonpass' ? ` <span class="count">+${1 + a.counter}</span>` : '';
      const dist = a.district ? ` <span class="district" title="District bonus: +${a.district} multiplier from touching ${THEMES[def.theme].name}">+${a.district}</span>` : '';
      return `<li class="attraction ${def.rarity} theme-${def.theme}${[...firing].some((l) => l.startsWith(def.name)) ? ' firing' : ''}" style="--theme:${THEMES[def.theme].color}">
        <div class="attraction-name">${def.name}${extra}${dist}</div>
        <div class="attraction-desc">${def.desc}</div>
      </li>`;
    });
    const html = cards.join('');
    if (html === this.lastStrip) return;
    this.lastStrip = html;
    strip.innerHTML = html;
  }

  private renderTools(): void {
    const g = this.game;
    const bar = $('tools');
    const owned = (Object.keys(TOOLS) as ToolId[]).filter((t) => g.tools[t] > 0);
    const specials = (Object.keys(SPECIALS) as SpecialId[]).filter((t) => g.specials[t] > 0);
    const specialHtml = specials
      .map(
        (t) =>
          `<button type="button" class="tool special ${t}${g.aiming?.tool === t ? ' active' : ''}" data-special="${t}" title="${SPECIALS[t].desc}" ${g.phase === 'build' ? '' : 'disabled'}>${SPECIALS[t].name} <span class="count">${g.specials[t]}</span></button>`,
      )
      .join('');
    if (!owned.length && !specials.length) {
      bar.innerHTML = '<span class="muted">No tools yet. Earn them between days.</span>';
      return;
    }
    bar.innerHTML = owned
      .map(
        (t, i) =>
          `<button type="button" class="tool${g.aiming?.tool === t ? ' active' : ''}" data-tool="${t}" title="${TOOLS[t].desc} (key ${i + 1})" ${g.phase === 'build' ? '' : 'disabled'}>${TOOLS[t].name} <span class="count">${g.tools[t]}</span></button>`,
      )
      .join('') + specialHtml;
  }

  private renderQueue(): void {
    const g = this.game;
    const list = $('queue');
    $('queueCount').textContent = `${g.queue.length}`;
    if (!g.queue.length) {
      list.innerHTML = '<li class="empty">Nobody in line yet. A wilder ride draws a crowd.</li>';
      return;
    }
    // During the ride the pips start empty and the score show fills them in as riders puke.
    const riding = g.phase === 'ride';
    const puked = (r: Rider) => g.result?.tickets.find((t) => t.rider.id === r.id)?.pukes ?? 0;
    list.replaceChildren(
      ...g.queue.map((r) => this.riderCard(r, g.phase === 'build' ? g.pukes(r) : riding ? 0 : g.phase === 'results' ? puked(r) : null, riding, g.phase === 'results')),
    );
  }

  /** The card for a guest hovered (or tapped) in the park. */
  guestCard(r: Rider): HTMLElement {
    const g = this.game;
    return this.riderCard(r, g.phase === 'build' ? g.pukes(r) : null);
  }

  private riderCard(r: Rider, pukes: number | null, riding = false, past = false): HTMLLIElement {
    const g = this.game;
    const li = document.createElement('li');
    li.className = `rider${r.kind === 'vip' ? ' vip' : ''}${r.boss ? ' boss' : ''}`;
    li.dataset.rider = String(r.id);
    let portrait = this.portraits.get(r.id);
    if (!portrait) {
      portrait = document.createElement('canvas');
      portrait.width = 11;
      portrait.height = 14;
      portrait.className = 'portrait';
      drawPortrait3D(portrait, r.look);
      this.portraits.set(r.id, portrait);
    }
    const worth = riderWorth(r);
    const info = document.createElement('div');
    info.className = 'rider-info';
    info.innerHTML = `
      <div class="rider-top"><span class="rider-name">${r.name}</span><span class="rider-kind">${riderLabel(r)}${worth > 1 ? ` · ${worth}× per puke` : ''}</span></div>
      <div class="rider-want">Stomach ${g.stomach(r)}. ${riderTrait(r)}</div>
      ${pukes !== null ? `<div class="rider-bottom"><span class="pukes" aria-label="${pukeLabel(pukes, true)}">${'<i></i>'.repeat(pukes)}${'<i class="off"></i>'.repeat(MAX_PUKES - pukes)}</span><span class="verdict ${pukes > 0 ? 'sick' : 'meh'}">${riding ? 'On the ride' : pukeLabel(pukes, !past)}</span></div>` : ''}`;
    li.append(portrait, info);
    return li;
  }

  private renderOverlay(): void {
    const g = this.game;
    const el = $('overlay');
    el.hidden = !['intro', 'map', 'results', 'reward', 'conquered', 'shop', 'egg', 'over', 'won'].includes(g.phase);
    if (el.hidden) {
      this.lastOverlay = '';
      return;
    }
    const html = this.overlayHtml();
    // Don't restart animations (the tally) when nothing changed.
    if (html === this.lastOverlay) return;
    this.lastOverlay = html;
    el.innerHTML = html;
    el.classList.toggle('mapmode', g.phase === 'map');
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
          ${g.record.bosses.length ? `<p class="eyebrow shelf-label">Trophy shelf</p>${trophyShelf(g.record.bosses)}` : ''}
          <button class="primary" data-action="begin" autofocus>${park.id === 'finale' ? 'Open the gates' : 'See the map'}</button>
        </div>`;
    }
    if (g.phase === 'map') return this.mapHtml();
    if (g.phase === 'egg' && g.egg) {
      const e = g.egg;
      const def = EGGS[e.kind];
      if (!e.cracked)
        return `
        <div class="card egg-card">
          <p class="eyebrow">Capsule machine</p>
          <h2>${def.name}</h2>
          <p>${def.desc}</p>
          <button type="button" class="capsule ${e.kind}" data-action="crack" aria-label="Crack the egg open" autofocus><span class="top"></span><span class="bottom"></span></button>
          <p class="muted center">Tap the egg to crack it open.</p>
        </div>`;
      return `
        <div class="card egg-card">
          <p class="eyebrow">Capsule machine</p>
          <h2>${def.name}</h2>
          <div class="capsule ${e.kind} open" aria-hidden="true"><span class="top"></span><span class="bottom"></span></div>
          <p>Pick ${e.picksLeft} ${e.picksLeft === 1 ? 'thing' : 'more'}.</p>
          <div class="perks">
            ${e.items
              .map((item, i) => {
                const { tag, name, desc } = rewardLabel(item, g.dayNum);
                return `<button class="perk kind-${item.kind}" data-action="egg-take" data-index="${i}" style="--i:${i}" ${g.canTakeFromEgg(i) ? '' : 'disabled'}><span class="tag">${tag}</span><strong>${name}</strong><span>${desc}</span></button>`;
              })
              .join('')}
          </div>
          ${!g.slotsFree && e.kind === 'golden' ? '<p class="muted">Your park plot and stash are full. Sell something from the plot to make room.</p>' : ''}
          <button class="ghost-dark" data-action="egg-leave">Leave the rest</button>
        </div>`;
    }
    if (g.phase === 'shop') {
      return `
        <div class="card">
          <p class="eyebrow">${g.cfg.park.name}</p>
          <h2>Park shop</h2>
          <p>You have <strong>${g.funds.toLocaleString()}</strong> in park funds. Everything you buy goes on your park plot.</p>
          <div class="perks">
            ${g.shop
              .map((item, i) => {
                const { tag, name, desc } = rewardLabel(item);
                const blocked = item.sold || g.funds < item.price || (item.kind === 'heart' && g.hearts >= 3) || ((item.kind === 'attraction' || item.kind === 'upgrade') && !g.canGain(item));
                return `<button class="perk shop-item kind-${item.kind}" data-action="buy" data-index="${i}" ${blocked ? 'disabled' : ''}><span class="price">${item.sold ? 'Sold' : item.price.toLocaleString()}</span><span class="tag">${tag}</span><strong>${name}</strong><span>${desc}</span></button>`;
              })
              .join('')}
          </div>
          <button class="primary" data-action="leave">Back to the map</button>
        </div>`;
    }
    if (g.phase === 'won') {
      return `
        <div class="card conquered">
          <div class="conq-rays" aria-hidden="true"></div>
          <p class="eyebrow">Season complete</p>
          <h2 class="conq-title">The Mayor is broken!</h2>
          <div class="conq-trophy">${bossPortrait('mayor') ? `<img src="${bossPortrait('mayor')}" alt="">` : ''}<span class="plaque">Grand Opening champion</span></div>
          <p><strong>The Grand Opening was a hit.</strong></p>
          <p>You sold <strong>${g.runScore.toLocaleString()}</strong> tickets over the season.</p>
          <p class="muted">Best run: ${g.best.toLocaleString()} tickets. Seed ${g.seed}.</p>
          ${trophyShelf(g.record.bosses)}
          <button class="primary" data-action="newrun" autofocus>Start a new season</button>
        </div>`;
    }
    if (g.phase === 'results' && g.result) return this.resultsHtml();
    if (g.phase === 'conquered') {
      const id = g.cfg.boss!;
      const art = bossPortrait(id);
      return `
        <div class="card conquered">
          <div class="conq-rays" aria-hidden="true"></div>
          <p class="eyebrow">${g.cfg.park.name} · Park conquered</p>
          <h2 class="conq-title">${BOSSES[id].name} is broken!</h2>
          <div class="conq-trophy">${art ? `<img src="${art}" alt="">` : ''}<span class="plaque">${BOSSES[id].name}</span></div>
          <p class="conq-grow"><strong>Your park grew!</strong> The plot is now ${PLOT_W} × ${g.plot.h}: one more row to build on.</p>
          <p>Pick a <strong>legendary attraction</strong> (2×2). Only bosses drop these.</p>
          <div class="perks">
            ${g.offer
              .map((r, i) => {
                const { tag, name, desc } = rewardLabel(r);
                return `<button class="perk legendary kind-${r.kind}" data-action="reward" data-index="${i}" style="--i:${i}" ${g.canTake(r) ? '' : 'disabled'}><span class="tag">${tag}</span><strong>${name}</strong><span>${desc}</span></button>`;
              })
              .join('')}
          </div>
          ${g.offer.some((r) => !g.canTake(r)) ? '<p class="muted">No room for a 2×2 on your plot or in the stash. Sell something from the plot to make room.</p>' : ''}
          <button class="ghost-dark" data-action="skip">Take nothing</button>
        </div>`;
    }
    if (g.phase === 'reward') {
      const full = g.offer.some((r) => !g.canTake(r));
      return `
        <div class="card">
          <h2>Pick a reward</h2>
          <p>Upgrades last all run. Tools go in your toolbar. Attractions and upgrades go on your park plot.</p>
          <div class="perks">
            ${g.offer
              .map((r, i) => {
                const { tag, name, desc } = rewardLabel(r);
                const blocked = !g.canTake(r);
                return `<button class="perk kind-${r.kind}" data-action="reward" data-index="${i}" ${blocked ? 'disabled' : ''}><span class="tag">${tag}</span><strong>${name}</strong><span>${desc}</span></button>`;
              })
              .join('')}
          </div>
          ${full ? '<p class="muted">No room on your park plot or in the stash. Sell something from the plot to make room, or skip.</p>' : ''}
          <button class="ghost-dark" data-action="skip">Skip</button>
        </div>`;
    }
    if (g.phase === 'over') {
      return `
        <div class="card">
          <h2>The park closed for good</h2>
          <p>You made it to ${g.cfg.park.name}, day ${g.dayNum} of the season, and sold <strong>${g.runScore.toLocaleString()}</strong> tickets.</p>
          <p class="muted">Best run: ${g.best.toLocaleString()} tickets. Seed ${g.seed}.</p>
          ${trophyShelf(g.record.bosses)}
          <button class="primary" data-action="newrun" autofocus>Start a new season</button>
        </div>`;
    }
    return '';
  }

  /**
   * The score was already built up live during the ride, so the report is brief:
   * the verdict, the total, and the breakdown tucked away for the curious.
   */
  private resultsHtml(): string {
    const g = this.game;
    const r = g.result!;
    const title: Record<RideKind, string> = { circuit: 'Ride report', shuttle: 'Shuttle report' };
    const steps = r.score.steps
      .map((st, k) => {
        const delta = k === 0 ? '' : `<span class="delta">${effectText(st.effect)}</span>`;
        return `<li class="tally-row"><span class="tally-label">${st.label}${delta}</span><span class="chipmult"><span class="chips">${fmt(st.chips)}</span><span class="times">×</span><span class="mult">${fmt(st.mult)}</span></span></li>`;
      })
      .join('');
    const riders = r.tickets
      .map((t) => {
        const worth = riderWorth(t.rider);
        return `<li class="tally-row${t.rider.boss ? ' boss' : ''}"><span>${t.rider.name}${worth > 1 && t.pukes ? ` <small>×${worth}</small>` : ''}</span><span class="verdict ${t.pukes ? 'sick' : 'meh'}">${pukeLabel(t.pukes, false)}</span><span class="paid">${t.paid.toLocaleString()}</span></li>`;
      })
      .join('');
    const pukes = r.tickets.reduce((a, t) => a + t.pukes * riderWorth(t.rider), 0);
    const photo = photoStore.card ?? photoStore.url;
    if (!recorded.has(r)) {
      recorded.add(r);
      recordLocal({ name: playerName(), score: r.total, park: g.cfg.park.name, day: g.dayNum, pukes, at: Date.now() });
    }
    const green = r.tickets.filter((t) => t.pukes > 0).length;
    setShareText(
      `My coaster made ${green} of ${r.tickets.length} riders puke${pukes > green ? ` (${pukes} times)` : ''} and sold ${r.total.toLocaleString()} tickets in Loophole 🎢🤢 Can you build a nastier ride?`,
    );
    const rec = lastRecord?.entry.score === r.total ? lastRecord : null;
    const best = rec?.personalBest
      ? '<p class="pb">New personal best!</p>'
      : rec && rec.rank > 0
        ? `<p class="pb soft">#${rec.rank} on this device</p>`
        : '';
    const share = `
        <div class="share" aria-label="Share this ride">
          <button type="button" class="primary-soft" data-action="share">Share</button>
          ${shareLinks()
            .map((l) => `<a class="share-btn ${l.id}" href="${l.href}" target="_blank" rel="noopener noreferrer">${l.label}</a>`)
            .join('')}
          <button type="button" class="share-btn copy" data-action="copy-share">Copy</button>
          ${photo ? '<button type="button" class="share-btn save" data-action="save-photo">Save photo</button>' : ''}
        </div>
        <form class="post-score" data-form="post-score">
          ${best}
          <label><span>Your name</span><input name="name" maxlength="18" autocomplete="nickname" placeholder="Coaster tycoon" value="${escapeAttr(playerName())}"></label>
          <button type="submit" class="ghost-dark">Post to highscores</button>
          <span class="post-note" aria-live="polite"></span>
        </form>`;
    const times = r.passed ? Math.floor(r.dayTotal / Math.max(1, r.target)) : 0;
    const bossName = g.cfg.boss ? BOSSES[g.cfg.boss].name : '';
    const headline = r.passed
      ? g.cfg.boss
        ? `${bossName} is broken!`
        : times >= 2
          ? `${times}× the target!`
          : 'Target reached!'
      : r.refused
        ? `${bossName} refused to ride`
        : r.again
          ? r.bossHits
            ? `${bossName} is wobbling!`
            : r.bossPuked
              ? 'Broken, but short of the target'
              : `${bossName} held it in`
          : !r.bossPuked
            ? `${bossName} kept it down`
            : 'Short of the target';
    const f = g.fight;
    const bossLine = f
      ? `<div class="boss-result"><span class="pips">${Array.from({ length: f.max }, (_, i) => `<i class="${i >= r.bossHp ? 'broken' : ''}${i >= r.bossHp && i < r.bossHpBefore ? ' fresh' : ''}"></i>`).join('')}</span><span>${
          r.bossHits ? `${bossName} puked ${r.bossHits === 1 ? 'once' : `×${r.bossHits}`}` : r.refused ? 'The demands weren’t met' : `${bossName} didn’t puke`
        } · ${r.bossHp ? `${r.bossHp} more to break` : 'composure gone'} · ride ${r.round} of ${BOSS_ROUNDS}</span></div>`
      : '';
    return `
      <div class="card results brief ${r.passed ? 'good' : r.again ? 'again' : 'bad'}">
        <p class="eyebrow">${title[r.kind]}</p>
        <h2>${headline}</h2>
        ${bossLine}
        <p class="total big"><span>Tickets ${f && f.round > 1 ? 'today' : 'sold'}</span><strong>${r.dayTotal.toLocaleString()} / ${r.target.toLocaleString()}</strong></p>
        ${r.dayTotal !== r.total ? `<p class="total"><span>This ride</span><strong>${r.total.toLocaleString()}</strong></p>` : ''}
        <p class="total"><span>${r.score.rating.toLocaleString()} a puke × ${pukes} puke${pukes === 1 ? '' : 's'}</span></p>
        ${r.passed ? `<p class="total"><span>Into park funds</span><strong>+${(r.dayTotal - r.target).toLocaleString()}</strong></p>` : ''}
        <p class="outcome ${r.passed ? 'good' : r.again ? 'again' : 'bad'}">${
          r.passed
            ? g.cfg.boss
              ? 'Park cleared!'
              : 'The crowd loved it.'
            : r.again
              ? `Not done yet: the track comes down and ${bossName} gets back in line. Ride ${r.round + 1} of ${BOSS_ROUNDS}, on a restocked board.`
              : `The park loses a heart${g.cfg.node === 'finale' ? ', and the Grand Opening runs again tomorrow' : ''}.`
        }</p>
        ${photo ? `<figure class="photo-card"><img src="${photo}" alt="On-ride photo of the riders"></figure>` : ''}
        ${share}
        <details class="breakdown"><summary>Breakdown</summary>
          <ul class="tally">${steps}<li class="tally-row rating"><span>Every puke pays</span><strong>${r.score.rating.toLocaleString()}</strong></li></ul>
          ${riders ? `<ul class="report">${riders}</ul>` : ''}
        </details>
        <button class="primary" data-action="continue" autofocus>${r.again ? `Ride ${r.round + 1} →` : 'Continue'}</button>
      </div>`;
  }

  private mapHtml(): string {
    return mapHtml(this.game);
  }
}

/** Results already put on this device's highscores. */
const recorded = new WeakSet<object>();

function escapeAttr(v: string): string {
  return v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

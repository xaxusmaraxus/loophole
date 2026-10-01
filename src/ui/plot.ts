import type { Game, Phase } from '../game';
import { ATTRACTIONS, THEMES, type AttractionId, type Theme } from '../run/attractions';
import { PLOT_MAX_H, STASH_SIZE, cellsOf, firstFit, fits, neighbors, readingOrder, sizeOf, themeOf, type PlotItem, type PlotRef } from '../run/plot';
import { UPGRADES, sellValue, type UpgradeId } from '../run/run';
import { BOSSES } from '../riders/riders';
import { bossPortrait } from './hud';
import './plot.css';

// The park plot panel: a backpack-style board beside the map and the shop where
// you arrange everything you've built. Drag tiles to move them (mouse or touch),
// drop them on the loading dock to set them aside, tap one for its card.
// The panel only reads game state and calls the plot API; it re-renders only
// when what it shows changes, so a drag in progress is never interrupted.

const SHOWN: readonly Phase[] = ['map', 'shop', 'reward', 'conquered', 'egg'];

const ICON: Partial<Record<AttractionId | UpgradeId, string>> = {
  loopdeloop: '➰',
  longhaul: '🛤️',
  flatearth: '🌍',
  chaingang: '⛓️',
  collector: '🗂️',
  photobooth: '📸',
  seasonpass: '🎟️',
  earlybird: '🐦',
  splashzone: '💦',
  corndogcart: '🌭',
  tilttable: '🌀',
  crowdpleaser: '📣',
  quicktrip: '⚡',
  adrenaline: '😱',
  openair: '🧺',
  funnelcake: '🥞',
  ferris: '🎡',
  mirrors: '🪞',
  gravitywell: '🕳️',
  buffet: '🍽️',
  fountain: '⛲',
  thunder: '🌩️',
  sweeper: '🧹',
  lumber: '🪵',
  hype: '🕺',
  fries: '🍟',
  billboard: '🪧',
  landscaper: '🌷',
  scenic: '🏞️',
  wrench: '🧰',
  teacups: '☕',
  floodgates: '🚰',
  gantry: '🏗️',
  blueprints: '📐',
};

const SHORT: Partial<Record<AttractionId | UpgradeId, string>> = {
  flatearth: 'Flat Earth',
  earlybird: 'Early Bird',
  adrenaline: 'Adrenaline',
  funnelcake: 'Funnel Cake',
  ferris: 'Ferris Wheel',
  buffet: 'Buffet',
  corndogcart: 'Corn Dogs',
  thunder: 'Thunder Mtn',
  crowdpleaser: 'Crowd Pleaser',
  teacups: 'Teacups',
  floodgates: 'Flood Gates',
  gantry: 'Gantry',
  blueprints: 'Blueprints',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

type Kind = 'common' | 'rare' | 'legendary' | 'upgrade';

function info(r: PlotRef): { name: string; short: string; desc: string; rarity: Kind; icon: string; theme: Theme } {
  const theme = themeOf(r);
  if (r.kind === 'attraction') {
    const d = ATTRACTIONS[r.id];
    return { name: d.name, short: SHORT[r.id] ?? d.name, desc: d.desc, rarity: d.rarity, icon: ICON[r.id] ?? THEMES[theme].icon, theme };
  }
  const u = UPGRADES[r.id];
  return { name: u.name, short: SHORT[r.id] ?? u.name, desc: u.desc, rarity: 'upgrade', icon: ICON[r.id] ?? THEMES[theme].icon, theme };
}

const isRare = (it: PlotItem | undefined) => it?.kind === 'attraction' && ATTRACTIONS[it.id].rarity === 'rare';

interface Drag {
  uid: number;
  from: 'plot' | 'dock';
  turned: boolean;
  startX: number;
  startY: number;
  /** Pointer offset inside the tile, in px. */
  offX: number;
  offY: number;
  active: boolean;
  ghost: HTMLElement | null;
  target: { x: number; y: number; ok: boolean } | 'dock' | null;
  pointerId: number;
  lastX: number;
  lastY: number;
}

export class PlotPanel {
  private key = '';
  private selected: number | null = null;
  private sellArmed: number | null = null;
  private note: string | null = null;
  private drag: Drag | null = null;
  /** The phone drawer is expanded. */
  private open = false;

  constructor(
    private game: Game,
    private el: HTMLElement,
    private onChange: () => void = () => {},
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('click', (e) => this.click(e));
    el.addEventListener('pointerover', (e) => this.hover(e));
    el.addEventListener('pointerout', (e) => {
      if (!(e.relatedTarget instanceof Node) || !el.contains(e.relatedTarget)) this.clearHover();
    });
    el.addEventListener('focusin', (e) => this.hover(e));
    // Keep presses on the panel from reaching the park (swipes, taps, guest cards).
    for (const t of ['pointerup', 'pointermove'] as const) el.addEventListener(t, (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keydown', (e) => {
      if (el.hidden || (e.target instanceof Node && el.contains(e.target))) return;
      if ((e.key === 'r' || e.key === 'R') && !(e.target instanceof HTMLElement && e.target.closest('input, textarea'))) this.rotate();
      if (e.key === 'Escape' && this.drag) this.endDrag(false);
    });
  }

  /** Shows or hides the panel and re-renders it if what it shows changed. */
  update(): void {
    const g = this.game;
    const shown = SHOWN.includes(g.phase);
    this.el.hidden = !shown;
    this.el.parentElement?.classList.toggle('plot-open', shown);
    if (!shown) {
      if (this.drag) this.endDrag(false);
      this.selected = this.sellArmed = null;
      this.note = null;
      return;
    }
    const all = [...g.plot.items, ...g.plot.stash];
    if (this.selected !== null && !all.some((i) => i.uid === this.selected)) this.selected = null;
    if (this.drag) return;
    const key = JSON.stringify([g.phase, g.dayNum, g.parkBoss, g.canEditPlot, g.plot, this.selected, this.sellArmed, this.note]);
    if (key === this.key) return;
    this.key = key;
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-focus]')?.dataset.focus;
    this.el.innerHTML = this.html();
    this.el.classList.toggle('open', this.open);
    this.el.classList.toggle('readonly', !g.canEditPlot);
    if (focused) this.el.querySelector<HTMLElement>(`[data-focus="${focused}"]`)?.focus();
  }

  private changed(): void {
    this.onChange();
    this.update();
  }

  private find(uid: number): PlotItem | undefined {
    const p = this.game.plot;
    return p.items.find((i) => i.uid === uid) ?? p.stash.find((i) => i.uid === uid);
  }

  // ---- Rendering -------------------------------------------------------------

  private html(): string {
    const g = this.game;
    const p = g.plot;
    const used = p.items.reduce((a, i) => a + cellsOf(i).length, 0);
    const total = p.w * p.h;
    const order: PlotItem[] = readingOrder(p.items).filter((i) => i.kind === 'attraction');
    const districtTotal = g.attractions.reduce((a, x) => a + (x.district ?? 0), 0);
    const ro = !g.canEditPlot;

    const cells: string[] = [];
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++)
        cells.push(
          `<button type="button" class="pp-cell" style="--x:${x};--y:${y}" data-cell="${x},${y}" data-focus="c${x},${y}" tabindex="-1" aria-label="Empty space, row ${y + 1}, column ${x + 1}"${ro ? ' disabled' : ''}></button>`,
        );

    // District seams: a glowing joint on every edge shared by two same-theme spots.
    const seams: string[] = [];
    for (const [i, a] of p.items.entries())
      for (const b of p.items.slice(i + 1)) {
        const t = themeOf(a);
        if (t !== themeOf(b)) continue;
        for (const c of cellsOf(a))
          for (const d of cellsOf(b)) {
            if (Math.abs(c.x - d.x) + Math.abs(c.y - d.y) !== 1) continue;
            const vertical = c.y === d.y;
            const sx = vertical ? Math.max(c.x, d.x) : c.x;
            const sy = vertical ? c.y : Math.max(c.y, d.y);
            seams.push(`<span class="pp-seam ${vertical ? 'v' : 'h'}" style="--x:${sx};--y:${sy};--tc:${THEMES[t].color}" aria-hidden="true"></span>`);
          }
      }

    const tiles = p.items.map((it) => this.tileHtml(it, order.indexOf(it) + 1)).join('');
    const locked =
      p.h < PLOT_MAX_H
        ? `<div class="pp-locked"><span aria-hidden="true">🔒</span> Break the boss to expand your park <small>+1 row</small></div>`
        : '';

    const dock = Array.from({ length: STASH_SIZE }, (_, k) => {
      const it = p.stash[k];
      return it ? `<div class="pp-slot full">${this.tileHtml(it, 0, true)}</div>` : `<div class="pp-slot"><span>Empty</span></div>`;
    }).join('');

    const legend = (Object.keys(THEMES) as Theme[])
      .map((t) => `<li style="--tc:${THEMES[t].color}"><span aria-hidden="true">${THEMES[t].icon}</span>${THEMES[t].name}</li>`)
      .join('');

    return `
      <button type="button" class="pp-handle" data-act="toggle" aria-expanded="${this.open}" aria-controls="ppBody">
        <span class="pp-grip" aria-hidden="true"></span>
        <span class="pp-handle-text"><strong>Your park</strong> · ${used}/${total} spaces${p.stash.length ? ` · ${p.stash.length} docked` : ''}</span>
        <span class="pp-chev" aria-hidden="true">▴</span>
      </button>
      <div class="pp-body" id="ppBody">
        <header class="pp-head">
          <div>
            <p class="pp-eyebrow">Get ready for the boss</p>
            <h2>Your park</h2>
          </div>
          <div class="pp-count" aria-label="${used} of ${total} spaces used">
            <strong>${used}</strong><span>/${total}</span><small>spaces</small>
          </div>
        </header>
        ${this.bossHtml()}
        <ul class="pp-legend" aria-label="Themes">${legend}</ul>
        <div class="pp-frame">
          <div class="pp-board" role="grid" aria-label="Park plot, ${p.w} by ${p.h}. Attractions score top row first, left to right." style="--cols:${p.w};--rows:${p.h}">
            ${cells.join('')}
            ${seams.join('')}
            ${tiles}
            <span class="pp-foot" hidden aria-hidden="true"></span>
          </div>
        </div>
        ${locked}
        <ul class="pp-rules">
          <li><b class="pp-o">1</b> Attractions fire in reading order</li>
          <li><b class="pp-dist">+1</b> mult for each touching spot of its theme${districtTotal ? ` · <strong>+${districtTotal} now</strong>` : ''}</li>
        </ul>
        ${this.detailHtml()}
        ${this.note ? `<p class="pp-note" role="status">${esc(this.note)}</p>` : ''}
        <section class="pp-dock" aria-label="Loading dock, ${STASH_SIZE} spaces. Spots here don't count.">
          <p class="pp-dock-title"><span>Loading dock</span><small>waiting spots don't count</small></p>
          <div class="pp-slots">${dock}</div>
        </section>
      </div>`;
  }

  private tileHtml(it: PlotItem, order: number, docked = false): string {
    const g = this.game;
    const f = info(it);
    const { w, h } = sizeOf(it, it.turned);
    const dist = docked ? 0 : neighbors(g.plot, it).filter((o) => themeOf(o) === f.theme).length;
    const label = [
      f.name,
      f.rarity === 'upgrade' ? `${THEMES[f.theme].name} upgrade` : `${f.rarity} ${THEMES[f.theme].name} attraction`,
      docked ? 'on the loading dock' : `row ${it.y + 1}, column ${it.x + 1}`,
      order ? `scores ${ordinal(order)}` : '',
      dist ? `district +${dist}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const pos = docked ? '' : `--x:${it.x};--y:${it.y};`;
    const sel = this.selected === it.uid;
    return `<button type="button" class="pp-item ${f.rarity}${it.turned ? ' turned' : ''}${sel ? ' selected' : ''}${docked ? ' docked' : ''}" style="${pos}--w:${w};--h:${h};--tc:${THEMES[f.theme].color}" data-uid="${it.uid}" data-focus="i${it.uid}" aria-label="${esc(label)}" aria-pressed="${sel}">
      <span class="pp-icon" aria-hidden="true">${f.icon}</span>
      <span class="pp-name">${esc(f.short)}</span>
      ${order ? `<span class="pp-order" aria-hidden="true">${order}</span>` : ''}
      ${f.rarity === 'upgrade' ? '<span class="pp-up" aria-hidden="true">UP</span>' : ''}
      ${docked && w * h > 1 ? `<span class="pp-size" aria-hidden="true">${w}×${h}</span>` : ''}
      ${dist ? `<span class="pp-badge" aria-hidden="true">+${dist}</span>` : ''}
    </button>`;
  }

  /** Who you're building for: the boss waiting at the end of this park. */
  private bossHtml(): string {
    const id = this.game.parkBoss;
    const b = BOSSES[id];
    const face = bossPortrait(id);
    return `<div class="pp-boss" title="${esc(b.ruleDesc)}">
      ${face ? `<img src="${face}" alt="">` : ''}
      <div><p class="pp-boss-name"><strong>${esc(b.name)}</strong> waits at the top</p>
      <p class="pp-boss-rule"><b>${esc(b.ruleName)}:</b> ${esc(b.ruleDesc)}</p>
      <p class="pp-boss-stats">Break with ${b.composure} pukes · stomach ${b.stomach}</p></div>
    </div>`;
  }

  private detailHtml(): string {
    const g = this.game;
    const it = this.selected !== null ? this.find(this.selected) : undefined;
    if (!it) return `<p class="pp-hint">Drag to arrange · tap for details${'ontouchstart' in window ? '' : ' · <kbd>R</kbd> turns rares'}</p>`;
    const f = info(it);
    const docked = g.plot.stash.includes(it);
    const order: PlotItem[] = readingOrder(g.plot.items).filter((i) => i.kind === 'attraction');
    const near = docked ? [] : neighbors(g.plot, it);
    const same = near.filter((o) => themeOf(o) === f.theme).length;
    const touchingAttr = near.filter((o) => o.kind === 'attraction').length;
    const price = sellValue(g.dayNum, cellsOf({ ...it, x: 0, y: 0 }).length);
    const facts: string[] = [];
    if (docked) facts.push('Waiting on the loading dock: it does nothing until you place it.');
    else if (it.kind === 'attraction') facts.push(`Fires <b>${ordinal(order.indexOf(it) + 1)}</b> of ${order.length}.`);
    else facts.push('Always on while it sits on the plot.');
    if (!docked)
      facts.push(
        same
          ? it.kind === 'attraction'
            ? `District: <b class="pp-dist">+${same}</b> multiplier (${same} touching ${THEMES[f.theme].name}).`
            : `Gives touching ${THEMES[f.theme].name} attractions <b class="pp-dist">+1</b>.`
          : `Touch other ${THEMES[f.theme].name} for a district bonus.`,
      );
    if (!docked && it.kind === 'attraction') {
      if (it.id === 'ferris')
        facts.push(touchingAttr ? `Touching ${touchingAttr} attraction${touchingAttr > 1 ? 's' : ''}: <b>×${(1.3 ** touchingAttr).toFixed(2)}</b>.` : 'Nothing touches it yet: surround it with attractions.');
      if (it.id === 'mirrors') facts.push(touchingAttr ? `Re-fires <b>${touchingAttr}</b> touching attraction${touchingAttr > 1 ? 's' : ''}.` : 'No attractions touch it yet.');
      if (it.id === 'funnelcake') {
        const food = near.filter((o) => themeOf(o) === 'food').length;
        facts.push(food ? `Stomachs <b>−${food}</b> from touching Food.` : 'Put Food next to it to shrink stomachs.');
      }
    }
    const rarity = f.rarity === 'upgrade' ? 'Upgrade' : f.rarity[0].toUpperCase() + f.rarity.slice(1);
    const ro = !g.canEditPlot;
    const armed = this.sellArmed === it.uid;
    return `<div class="pp-detail ${f.rarity}" style="--tc:${THEMES[f.theme].color}">
      <div class="pp-detail-top">
        <span class="pp-detail-icon" aria-hidden="true">${f.icon}</span>
        <div class="pp-detail-name">
          <h3>${esc(f.name)}</h3>
          <p class="pp-tags"><span class="pp-tag ${f.rarity}">${rarity}</span><span class="pp-tag theme">${THEMES[f.theme].icon} ${THEMES[f.theme].name}</span></p>
        </div>
        <button type="button" class="pp-x" data-act="close" aria-label="Close details">×</button>
      </div>
      <p class="pp-desc">${esc(f.desc)}</p>
      <ul class="pp-facts">${facts.map((x) => `<li>${x}</li>`).join('')}</ul>
      <div class="pp-actions">
        ${f.rarity === 'rare' && !docked ? `<button type="button" data-act="turn" data-focus="a-turn"${ro ? ' disabled' : ''}>↻ Turn</button>` : ''}
        ${
          docked
            ? `<button type="button" data-act="place" data-focus="a-place"${ro ? ' disabled' : ''}>Place</button>`
            : `<button type="button" data-act="dock" data-focus="a-dock"${ro || g.plot.stash.length >= STASH_SIZE ? ' disabled' : ''}>To dock</button>`
        }
        <button type="button" class="sell${armed ? ' armed' : ''}" data-act="sell" data-focus="a-sell"${ro ? ' disabled' : ''}>${armed ? `Sure? +${price} 🎟` : `Sell for ${price}`}</button>
      </div>
    </div>`;
  }

  // ---- Interaction -----------------------------------------------------------

  private click(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const g = this.game;
    const actEl = t.closest<HTMLElement>('[data-act]');
    const act = actEl?.dataset.act;
    if (act === 'toggle') {
      this.open = !this.open;
      this.el.classList.toggle('open', this.open);
      actEl!.setAttribute('aria-expanded', String(this.open));
      return;
    }
    const it = this.selected !== null ? this.find(this.selected) : undefined;
    if (act === 'close') {
      this.selected = this.sellArmed = this.note = null;
      this.update();
      return;
    }
    if (act && it) {
      this.note = null;
      if (act === 'turn') {
        if (!g.placeItem(it.uid, it.x, it.y, !it.turned)) this.note = 'No room to turn it here. Clear a space or drag it somewhere roomier.';
      } else if (act === 'dock') {
        if (!g.stashItem(it.uid)) this.note = 'The loading dock is full.';
      } else if (act === 'place') {
        const at = firstFit(g.plot, it, it.uid);
        if (!at || !g.placeItem(it.uid, at.x, at.y, at.turned)) this.note = 'No room on the plot. Sell or dock something first.';
      } else if (act === 'sell') {
        if (this.sellArmed === it.uid) {
          g.sellItem(it.uid);
          this.selected = this.sellArmed = null;
        } else this.sellArmed = it.uid;
      }
      if (act !== 'sell') this.sellArmed = null;
      this.changed();
      return;
    }
    // Keyboard (Enter/Space on a tile) arrives as a click with no pointer press.
    const tile = t.closest<HTMLElement>('.pp-item');
    if (tile && e.detail === 0) {
      const uid = Number(tile.dataset.uid);
      this.selected = this.selected === uid ? null : uid;
      this.sellArmed = this.note = null;
      this.update();
      return;
    }
    // Tap an empty space with something selected: move it there.
    const cell = t.closest<HTMLElement>('[data-cell]');
    if (cell && it && g.canEditPlot) {
      const [x, y] = cell.dataset.cell!.split(',').map(Number);
      this.note = g.placeItem(it.uid, x, y) ? null : 'It doesn’t fit there.';
      this.sellArmed = null;
      this.changed();
    }
  }

  private onKey(e: KeyboardEvent): void {
    // Keys pressed in the panel stay out of the park; arrows nudge the selected spot.
    e.stopPropagation();
    const dirs: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = dirs[e.key];
    const it = this.selected !== null ? this.find(this.selected) : undefined;
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      this.rotate();
    } else if (e.key === 'Escape') {
      if (this.drag) this.endDrag(false);
      else if (this.selected !== null) {
        this.selected = this.sellArmed = null;
        this.update();
      }
    } else if (d && it && this.game.plot.items.includes(it) && (e.target as HTMLElement).closest('.pp-item')) {
      e.preventDefault();
      if (this.game.placeItem(it.uid, it.x + d[0], it.y + d[1])) {
        this.note = null;
        this.changed();
      }
    }
  }

  private rotate(): void {
    const g = this.game;
    if (this.drag) {
      if (!isRare(this.find(this.drag.uid))) return;
      this.drag.turned = !this.drag.turned;
      this.sizeGhost();
      this.track(this.drag.lastX, this.drag.lastY);
      return;
    }
    const it = this.selected !== null ? this.find(this.selected) : undefined;
    if (!it || !isRare(it) || !g.plot.items.includes(it)) return;
    this.note = g.placeItem(it.uid, it.x, it.y, !it.turned) ? null : 'No room to turn it here.';
    this.changed();
  }

  private hover(e: Event): void {
    if (this.drag) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('.pp-board .pp-item');
    this.clearHover();
    if (!t) return;
    const it = this.find(Number(t.dataset.uid));
    if (!it || !this.game.plot.items.includes(it)) return;
    t.classList.add('hot');
    this.el.querySelector('.pp-board')?.classList.add('hovering');
    for (const n of neighbors(this.game.plot, it))
      this.el.querySelector(`.pp-board [data-uid="${n.uid}"]`)?.classList.add(themeOf(n) === themeOf(it) ? 'touch' : 'touch-other');
  }

  private clearHover(): void {
    this.el.querySelectorAll('.hot, .touch, .touch-other').forEach((n) => n.classList.remove('hot', 'touch', 'touch-other'));
    this.el.querySelector('.pp-board')?.classList.remove('hovering');
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 || !this.game.canEditPlot || this.drag) return;
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.pp-item');
    if (!tile) return;
    const it = this.find(Number(tile.dataset.uid));
    if (!it) return;
    const r = tile.getBoundingClientRect();
    this.drag = {
      uid: it.uid,
      from: this.game.plot.stash.includes(it) ? 'dock' : 'plot',
      turned: it.turned,
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - r.left,
      offY: e.clientY - r.top,
      active: false,
      ghost: null,
      target: null,
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
    };
    // Capture phase: the panel stops pointer events from bubbling into the park.
    window.addEventListener('pointermove', this.move, { capture: true, passive: false });
    window.addEventListener('pointerup', this.up, true);
    window.addEventListener('pointercancel', this.cancel, true);
  }

  private metrics(): { x0: number; y0: number; step: number; cell: number; rect: DOMRect } | null {
    const board = this.el.querySelector<HTMLElement>('.pp-board');
    const c0 = this.el.querySelector<HTMLElement>('[data-cell="0,0"]');
    const c1 = this.el.querySelector<HTMLElement>('[data-cell="1,0"]');
    if (!board || !c0 || !c1) return null;
    const a = c0.getBoundingClientRect();
    const b = c1.getBoundingClientRect();
    return { x0: a.left, y0: a.top, step: b.left - a.left, cell: a.width, rect: board.getBoundingClientRect() };
  }

  /** Sizes the dragged ghost to the spot's real footprint (and keeps the grab point on it). */
  private sizeGhost(): void {
    const d = this.drag;
    const it = d && this.find(d.uid);
    if (!d?.ghost || !it) return;
    const { w, h } = sizeOf(it, d.turned);
    d.ghost.style.setProperty('--w', String(w));
    d.ghost.style.setProperty('--h', String(h));
    d.ghost.classList.toggle('turned', d.turned);
    const m = this.metrics();
    const step = m?.step ?? 60;
    const cell = m?.cell ?? 52;
    d.offX = Math.max(8, Math.min(d.offX, (w - 1) * step + cell - 8));
    d.offY = Math.max(8, Math.min(d.offY, (h - 1) * step + cell - 8));
  }

  private move = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 7) return;
      const src = this.el.querySelector<HTMLElement>(`[data-uid="${d.uid}"]`);
      if (!src) return this.endDrag(false);
      d.active = true;
      this.clearHover();
      const m = this.metrics();
      const ghost = src.cloneNode(true) as HTMLElement;
      ghost.classList.add('pp-ghost');
      ghost.classList.remove('selected', 'hot', 'docked');
      ghost.removeAttribute('data-uid');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.querySelector('.pp-size')?.remove();
      if (m) {
        ghost.style.setProperty('--cell', `${m.cell}px`);
        ghost.style.setProperty('--gap', `${m.step - m.cell}px`);
      }
      document.body.appendChild(ghost);
      d.ghost = ghost;
      this.sizeGhost();
      src.classList.add('lifting');
      this.el.classList.add('dragging');
    }
    e.preventDefault();
    this.track(e.clientX, e.clientY);
  };

  /** Moves the ghost to the pointer and shows where it would land. */
  private track(px: number, py: number): void {
    const d = this.drag;
    if (!d?.ghost) return;
    d.lastX = px;
    d.lastY = py;
    const left = px - d.offX;
    const top = py - d.offY;
    d.ghost.style.transform = `translate(${left}px, ${top}px) rotate(-3deg) scale(0.94)`;
    const it = this.find(d.uid);
    const foot = this.el.querySelector<HTMLElement>('.pp-foot');
    const dockEl = this.el.querySelector<HTMLElement>('.pp-dock');
    if (!it || !foot || !dockEl) return;
    const dr = dockEl.getBoundingClientRect();
    const overDock = px >= dr.left && px <= dr.right && py >= dr.top && py <= dr.bottom;
    dockEl.classList.toggle('drop', overDock && d.from === 'plot');
    const m = this.metrics();
    d.target = null;
    foot.hidden = true;
    if (overDock) d.target = 'dock';
    else if (m && px > m.rect.left - 24 && px < m.rect.right + 24 && py > m.rect.top - 24 && py < m.rect.bottom + 24) {
      const { w, h } = sizeOf(it, d.turned);
      const x = Math.max(0, Math.min(this.game.plot.w - w, Math.round((left - m.x0) / m.step)));
      const y = Math.max(0, Math.min(this.game.plot.h - h, Math.round((top - m.y0) / m.step)));
      const ok = this.game.canPlace(it.uid, x, y, d.turned);
      d.target = { x, y, ok };
      foot.hidden = false;
      foot.className = `pp-foot ${ok ? 'ok' : 'bad'}`;
      foot.style.cssText = `--x:${x};--y:${y};--w:${w};--h:${h}`;
    }
  }

  private up = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      // A tap: select (or unselect) the spot.
      this.endDrag(false);
      this.selected = this.selected === d.uid ? null : d.uid;
      this.sellArmed = this.note = null;
      this.update();
      return;
    }
    this.endDrag(true);
  };

  private cancel = (): void => this.endDrag(false);

  private endDrag(commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    window.removeEventListener('pointermove', this.move, true);
    window.removeEventListener('pointerup', this.up, true);
    window.removeEventListener('pointercancel', this.cancel, true);
    d.ghost?.remove();
    this.el.classList.remove('dragging');
    this.el.querySelector('.lifting')?.classList.remove('lifting');
    this.el.querySelector('.pp-dock')?.classList.remove('drop');
    const foot = this.el.querySelector<HTMLElement>('.pp-foot');
    if (foot) foot.hidden = true;
    if (!commit || !d.active) return;
    const g = this.game;
    this.sellArmed = null;
    if (d.target === 'dock') {
      if (d.from === 'plot') this.note = g.stashItem(d.uid) ? null : 'The loading dock is full.';
    } else if (d.target?.ok) {
      g.placeItem(d.uid, d.target.x, d.target.y, d.turned);
      this.note = null;
    } else if (d.target) this.note = 'It doesn’t fit there.';
    this.key = '';
    this.changed();
  }
}

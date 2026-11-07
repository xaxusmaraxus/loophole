import type { Game } from '../game';
import { type Pt, applyBulge, bulgeFor, cloneBoard } from '../puzzle/board';
import { PATTERNS, type PatternHit, type PatternId } from '../puzzle/patterns';
import { PIECES, liftPlan } from '../puzzle/pieces';
import { TIER_RAMPS } from '../render/palette';
import { PATTERN_COLOR, patternCounts } from './skill';

// The ride strip: today's coaster as a row of cards, in the order the train meets
// them (station → … → station). It's how you read and plan the ride: patterns are
// bracketed under the pieces that make them, Lift Hills show the charge they hand
// to the next element, and hovering a tile you could buy shows where its pieces
// would go and what they'd complete. Rules live in src/puzzle; this only reads.

const SHORT = ['', 'Air', 'Lift', 'Helix', 'Loop', 'Cork', 'Cobra', 'Hat'];
const ICON = ['', '⌒', '⛓', '🌀', '◯', '➰', '🐍', '🎩'];

interface Card {
  tier: number;
  x: number;
  y: number;
  /** Lift charge this element pays off (1 = none). */
  mult: number;
  /** Lift height left over into the station (on the last lift). */
  finale: number;
  fresh: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Cards and patterns for a path (ride order). */
function cardsFor(path: readonly { tier: number; x: number; y: number }[], fresh: Set<string>): Card[] {
  const plan = liftPlan(path);
  return path.map((c, i) => ({ tier: c.tier, x: c.x, y: c.y, mult: plan.mult[i], finale: plan.finale[i], fresh: fresh.has(`${c.x},${c.y}`) }));
}

/** Bracket rows: each pattern gets the first row where it doesn't overlap another. */
function levels(hits: readonly PatternHit[]): { hit: PatternHit; row: number; a: number; b: number }[] {
  const rows: [number, number][][] = [];
  return [...hits]
    .map((hit) => ({ hit, a: Math.min(...hit.cells), b: Math.max(...hit.cells) }))
    .sort((u, v) => u.b - u.a - (v.b - v.a) || u.a - v.a)
    .map((h) => {
      let row = rows.findIndex((r) => r.every(([a, b]) => h.b < a || h.a > b));
      if (row < 0) row = rows.push([]) - 1;
      rows[row].push([h.a, h.b]);
      return { ...h, row };
    });
}

function cardHtml(c: Card, i: number): string {
  if (c.tier === 0) return `<span class="sc flat${c.fresh ? ' fresh' : ''}" style="grid-column:${i + 2}" title="Flat track"><i></i></span>`;
  const r = TIER_RAMPS[c.tier];
  const p = PIECES[c.tier];
  const lift = c.tier === 2;
  const badge = c.mult > 1 ? `<b class="sc-mult" title="Lift power: hits ×${c.mult}">×${c.mult}</b>` : c.finale ? `<b class="sc-fin" title="Unspent lift height: a finale drop into the station">⤵${c.finale}</b>` : '';
  const tip = `${p.name}${lift ? ' (stores height for the next element)' : ` · thrill ${p.thrill}${c.mult > 1 ? ` ×${c.mult}` : ''}`}${p.inversion ? ' · upside down' : ''}`;
  return `<span class="sc t${c.tier}${lift ? ' lift' : ''}${c.fresh ? ' fresh' : ''}" style="grid-column:${i + 2};--c1:${r[0]};--c2:${r[1]};--c3:${r[3]}" title="${esc(tip)}"><span class="sc-ic" aria-hidden="true">${ICON[c.tier]}</span><span class="sc-n">${SHORT[c.tier]}</span>${badge}</span>`;
}

export function stripHtml(path: readonly { tier: number; x: number; y: number }[], hits: readonly PatternHit[], fresh = new Set<string>(), gained: readonly PatternId[] = []): string {
  const cards = cardsFor(path, fresh);
  const n = cards.length;
  const lv = levels(hits);
  const want = new Map<PatternId, number>();
  for (const id of gained) want.set(id, (want.get(id) ?? 0) + 1);
  // A bracket is "new" if it covers a fresh card and its kind is one the grow adds.
  const brackets = lv
    .map(({ hit, row, a, b }) => {
      const isNew = want.has(hit.id) && hit.cells.some((k) => cards[k]?.fresh);
      const p = PATTERNS[hit.id];
      return `<span class="sb${isNew ? ' new' : ''}" style="grid-column:${a + 2} / ${b + 3};grid-row:${row + 2};--pc:${PATTERN_COLOR[hit.id]}" title="${esc(`${p.name}: ${p.desc}`)}"><span>${p.name} +${p.mult}</span></span>`;
    })
    .join('');
  return `<span class="sc station" style="grid-column:1" title="The station: the train leaves here">🚉</span>${cards.map(cardHtml).join('')}<span class="sc station" style="grid-column:${n + 2}" title="Back at the station">🏁</span>${brackets}`;
}

export interface StripPreview {
  path: { tier: number; x: number; y: number }[];
  hits: PatternHit[];
  fresh: Set<string>;
  gained: PatternId[];
  lost: PatternId[];
  rate: number;
}

/** The ride as it would be after growing through (x, y): tried on a copy, the real board put back. */
export function stripPreview(game: Game, at: Pt): StripPreview | null {
  const saved = game.board;
  try {
    const before = patternCounts(game.stats.patterns);
    const b = cloneBoard(saved);
    const g = bulgeFor(b, at.x, at.y);
    if (!g) return null;
    applyBulge(b, g);
    game.board = b;
    const path = game.rideCells().map((c) => ({ tier: c.tier, x: c.x, y: c.y }));
    const hits = game.stats.patterns;
    const after = patternCounts(hits);
    const ids = Object.keys(PATTERNS) as PatternId[];
    const diff = (u: Map<PatternId, number>, v: Map<PatternId, number>) => ids.flatMap((id) => Array.from({ length: Math.max(0, (u.get(id) ?? 0) - (v.get(id) ?? 0)) }, () => id));
    return { path, hits, fresh: new Set([`${g.c.x},${g.c.y}`, `${g.d.x},${g.d.y}`]), gained: diff(after, before), lost: diff(before, after), rate: game.rate };
  } finally {
    game.board = saved;
  }
}

let lastKey = '';

/** Draws the strip: the ride now, or (hovering a tile you could buy) the ride after buying it. */
export function renderStrip(game: Game, hover: Pt | null): void {
  const el = document.getElementById('strip');
  if (!el) return;
  const live = game.board.loop && (game.phase === 'build' || game.phase === 'ride' || game.phase === 'results');
  el.hidden = !live;
  if (!live) return;
  const now = game.rideCells();
  const sig = now.map((c) => `${c.x},${c.y},${c.tier}`).join(';');
  const canGrow = hover && game.phase === 'build' && game.growCells.some((c) => c.x === hover.x && c.y === hover.y);
  const key = `${sig}|${canGrow ? `${hover!.x},${hover!.y}` : ''}|${game.phase}`;
  if (key === lastKey) return;
  lastKey = key;
  const pv = canGrow ? stripPreview(game, hover!) : null;
  const label = pv
    ? `<span class="st-label pv">If you buy it${pv.gained.length ? `: <b>${[...new Set(pv.gained)].map((id) => PATTERNS[id].name).join(', ')}</b>` : ''}${pv.lost.length ? ` <s>${[...new Set(pv.lost)].map((id) => PATTERNS[id].name).join(', ')}</s>` : ''}</span>`
    : `<span class="st-label">Your ride <small>${now.length} pieces</small></span>`;
  const body = pv ? stripHtml(pv.path, pv.hits, pv.fresh, pv.gained) : stripHtml(now, game.stats.patterns);
  el.classList.toggle('preview', !!pv);
  el.innerHTML = `${label}<div class="st-row"><div class="st-grid">${body}</div></div>`;
  // Keep the new pieces in view.
  const row = el.querySelector<HTMLElement>('.st-row');
  const target = el.querySelector<HTMLElement>(pv ? '.sc.fresh' : '.sc.station:last-of-type');
  if (row && target && pv) row.scrollLeft = target.offsetLeft - row.clientWidth / 2;
}

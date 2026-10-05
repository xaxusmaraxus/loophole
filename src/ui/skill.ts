import type { Game } from '../game';
import { applyBulge, bulgeFor, cloneBoard } from '../puzzle/board';
import { PATTERNS, type PatternHit, type PatternId } from '../puzzle/patterns';
import { type Letter, better } from '../run/grade';
import type { PlayRecord } from '../run/unlocks';

// The skill layer's UI: ride patterns (the hand, the pattern book, callouts and the
// planning preview on price tags), the roar meter, and the day's grade card.
// Rules live in src/puzzle/patterns.ts and src/run/grade.ts; this only reads them.

/** Each pattern's colour: its glow on the track, its chip in the hand. */
export const PATTERN_COLOR: Record<PatternId, string> = {
  pair: '#7fd6ff',
  triple: '#4f9dff',
  straight3: '#8dff6a',
  straight4: '#3fe0a0',
  straight5: '#ffd23f',
  invchain: '#c58cff',
  tower: '#ff9f43',
  kingdaka: '#ff5e8a',
  camelback: '#b6f06a',
  mirror: '#7ff2ff',
  grandtour: '#ffcf4a',
};

export const PATTERN_ORDER = Object.keys(PATTERNS) as PatternId[];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** How many of each pattern a hand holds. */
export function patternCounts(hits: readonly PatternHit[]): Map<PatternId, number> {
  const n = new Map<PatternId, number>();
  for (const h of hits) n.set(h.id, (n.get(h.id) ?? 0) + 1);
  return n;
}

export interface GrowPreview {
  /** The ride's rate after the grow. */
  rate: number;
  /** Patterns the grow would add to the hand, and ones it would break. */
  gained: PatternId[];
  lost: PatternId[];
}

/**
 * What growing the loop through (x, y) would do: tried on a copy of the board,
 * then the real one is put back. Read-only as far as the game is concerned.
 * Patterns compare by how many of each kind the hand holds, so one that only
 * stretches (a triple into four in a row, the Grand Tour taking in a new piece)
 * doesn't count as new.
 */
export function previewGrow(game: Game, x: number, y: number): GrowPreview | null {
  const saved = game.board;
  try {
    const before = patternCounts(game.stats.patterns);
    const b = cloneBoard(saved);
    const bg = bulgeFor(b, x, y);
    if (!bg) return null;
    applyBulge(b, bg);
    game.board = b;
    const after = patternCounts(game.stats.patterns);
    const rate = game.rate;
    const diff = (a: Map<PatternId, number>, c: Map<PatternId, number>) =>
      PATTERN_ORDER.flatMap((id) => Array.from({ length: Math.max(0, (a.get(id) ?? 0) - (c.get(id) ?? 0)) }, () => id));
    return { rate, gained: diff(after, before), lost: diff(before, after) };
  } finally {
    game.board = saved;
  }
}

// ---- The hand: patterns the ride makes right now ----

/** Patterns in the hand, grouped by kind ("Pair ×2"), in book order. */
export function handGroups(hits: readonly PatternHit[]): { id: PatternId; n: number }[] {
  const n = patternCounts(hits);
  return PATTERN_ORDER.filter((id) => n.has(id)).map((id) => ({ id, n: n.get(id)! }));
}

export function patternChip(id: PatternId, n = 1, extra = ''): string {
  const p = PATTERNS[id];
  return `<span class="pat-chip${extra}" style="--pc:${PATTERN_COLOR[id]}" title="${esc(p.desc)}"><span class="pat-name">${p.name}${n > 1 ? ` ×${n}` : ''}</span><b>+${p.mult * n}</b></span>`;
}

let lastHand = '';
/** The hand readout in the bottom bar. `fresh` = the kind that just formed (it pops). */
export function renderHand(game: Game, fresh?: PatternId): void {
  const el = document.getElementById('hand');
  if (!el) return;
  const live = !!game.board.loop && (game.phase === 'build' || game.phase === 'intro');
  el.hidden = !live;
  if (!live) return;
  const hits = game.stats.patterns;
  const groups = handGroups(hits);
  const total = hits.reduce((a, h) => a + PATTERNS[h.id].mult, 0);
  const html = groups.length
    ? `<span class="hand-label">Hand <b>+${total}</b></span><span class="hand-chips">${groups.map((g) => patternChip(g.id, g.n, g.id === fresh ? ' pop' : '')).join('')}</span>`
    : '<span class="hand-label">Hand</span><span class="hand-empty">None yet: line up a pair</span>';
  if (html === lastHand && !fresh) return;
  lastHand = html;
  el.innerHTML = html;
  el.title = 'Your ride patterns (they add to the multiplier). Click for the pattern book.';
}

// ---- The roar meter ----

export const ROAR_PIPS = 10;

let lastRoar = '';
export function renderRoar(game: Game): void {
  const el = document.getElementById('roar');
  if (!el) return;
  const r = Math.min(game.roar, ROAR_PIPS);
  const mult = game.roarMult;
  const html = `<span class="roar-flame" aria-hidden="true"></span><span class="roar-word">Roar</span><b class="roar-x">×${mult.toFixed(1)}</b><span class="roar-bar" aria-hidden="true">${Array.from({ length: ROAR_PIPS }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('')}</span>`;
  el.classList.toggle('cold', r === 0);
  el.classList.toggle('hot', r >= 5);
  el.classList.toggle('max', r >= ROAR_PIPS);
  el.style.setProperty('--roar', String(r / ROAR_PIPS));
  el.setAttribute('aria-label', `Crowd roar: ${game.roar} merges in a row, hype ×${mult.toFixed(1)}`);
  el.title = `The crowd's roar: ${game.roar} merge${game.roar === 1 ? '' : 's'} in a row (best today ${game.bestRoar}). Every merge in a row adds ×0.1 to the guests your hype draws, up to ×2. A swipe with no merge breaks it.`;
  if (html === lastRoar) return;
  lastRoar = html;
  el.innerHTML = html;
}

/** The roar grew or broke: the meter pulses or shakes. */
export function roarBump(grew: boolean): void {
  const el = document.getElementById('roar');
  if (!el) return;
  el.classList.remove('up', 'broke');
  void el.offsetWidth;
  el.classList.add(grew ? 'up' : 'broke');
}

// ---- Callouts when a pattern forms ----

/** A pattern formed: a juicy callout at `at` (page coordinates); a first-ever one gets the big banner. */
export function patternCallout(id: PatternId, at: { x: number; y: number }, fresh: boolean): void {
  const app = document.querySelector('.app');
  if (!app) return;
  const p = PATTERNS[id];
  const el = document.createElement('div');
  el.className = `pattern-call${fresh ? ' fresh' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--pc', PATTERN_COLOR[id]);
  if (fresh) {
    el.innerHTML = `<span class="pc-rays"></span><span class="pc-box"><span class="pc-eyebrow">New pattern!</span><strong class="pc-name">${p.name}</strong><span class="pc-mult">+${p.mult} mult</span><span class="pc-desc">${esc(p.desc)}</span></span>`;
  } else {
    const w = window.innerWidth;
    el.style.left = `${Math.min(w - 120, Math.max(120, at.x))}px`;
    el.style.top = `${Math.max(150, at.y)}px`;
    el.innerHTML = `<strong class="pc-name">${p.name}!</strong><span class="pc-mult">+${p.mult} mult</span>`;
  }
  app.append(el);
  const kill = () => el.remove();
  // Gone when its animation ends (a fallback timer in case animations don't run).
  el.addEventListener('animationend', (e) => e.target === el && kill());
  setTimeout(kill, fresh ? 8000 : 6000);
  if (fresh) el.addEventListener('click', kill);
}

// ---- The pattern book ----

let book: HTMLDialogElement | null = null;

export function openPatternBook(rec: PlayRecord, current: readonly PatternHit[] = []): void {
  if (!book) {
    book = document.createElement('dialog');
    book.className = 'scores-dialog pattern-book';
    book.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === book || t.closest('[data-close]')) book!.close();
    });
    (document.querySelector('.app') ?? document.body).append(book);
  }
  const now = new Set(current.map((h) => h.id));
  const found = PATTERN_ORDER.filter((id) => rec.patterns.includes(id)).length;
  const rows = PATTERN_ORDER.map((id) => {
    const p = PATTERNS[id];
    const known = rec.patterns.includes(id);
    const hidden = p.secret && !known && !now.has(id);
    return `<li class="${known ? 'got' : ''}${hidden ? ' secret' : ''}${now.has(id) ? ' now' : ''}" style="--pc:${PATTERN_COLOR[id]}">
      <span class="pb-tick" aria-label="${known ? 'Discovered' : 'Not yet'}">${known ? '✓' : hidden ? '?' : ''}</span>
      <span class="pb-text"><strong>${hidden ? '???' : p.name}${p.secret ? ' <em>secret</em>' : ''}${now.has(id) ? ' <em class="in">in your ride</em>' : ''}</strong><small>${hidden ? 'A secret pattern. Hit it once to learn it.' : esc(p.desc)}</small></span>
      <b class="pb-mult">+${p.mult}</b>
    </li>`;
  }).join('');
  book.innerHTML = `
    <div class="card">
      <p class="eyebrow">${found} of ${PATTERN_ORDER.length} discovered</p>
      <h2>Pattern book</h2>
      <p class="muted">Your ride reads like a poker hand: elements in a row (Flats don't count) make patterns that add to the multiplier.</p>
      <ul class="pattern-list">${rows}</ul>
      <button type="button" class="primary" data-close>Close</button>
    </div>`;
  book.showModal();
}

// ---- The day's grade (results card) ----

const GRADE_WORD: Record<Letter, string> = { S: 'Superb!', A: 'Great', B: 'Good', C: 'Okay', D: 'Rough day' };

export function gradeHtml(r: { grade: { letter: Letter; ratio: number; patterns: PatternId[]; good: string[]; tips: string[]; bestRoar: number }; bestGrade?: Letter; newPatterns: PatternId[] }): string {
  const g = r.grade;
  const best = better(g.letter, r.bestGrade);
  const bestLine = best
    ? `<span class="gr-best new">${r.bestGrade ? `New best! (was ${r.bestGrade})` : 'New best!'}</span>`
    : `<span class="gr-best">Best: ${r.bestGrade}</span>`;
  const fresh = r.newPatterns.length
    ? `<div class="gr-new"><span class="gr-new-label">New pattern${r.newPatterns.length > 1 ? 's' : ''}!</span>${r.newPatterns.map((id) => patternChip(id, 1, ' shine')).join('')}</div>`
    : '';
  const good = g.good.map((t) => `<li>${esc(t)}</li>`).join('');
  const tips = g.tips.map((t) => `<li>${esc(t)}</li>`).join('');
  return `
    <div class="grade-card grade-${g.letter}">
      <div class="gr-stamp" aria-label="Grade ${g.letter}"><span>${g.letter}</span></div>
      <div class="gr-side">
        <span class="gr-word">${GRADE_WORD[g.letter]}</span>
        <span class="gr-ratio">${g.ratio.toFixed(1)}× target · ${g.patterns.length} pattern${g.patterns.length === 1 ? '' : 's'} · roar ${g.bestRoar}</span>
        ${bestLine}
      </div>
    </div>
    ${fresh}
    ${good ? `<ul class="gr-good">${good}</ul>` : ''}
    ${tips ? `<div class="gr-tips"><span class="gr-tips-label">Next time…</span><ul>${tips}</ul></div>` : ''}`;
}

import { globalScores, localScores, type ScoreEntry } from './scores';

// The highscores window: everyone's best rides (the shared board) and this device's.

let dlg: HTMLDialogElement | null = null;
let tab: 'all' | 'mine' = 'all';

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function rows(list: (ScoreEntry & { mine?: boolean })[]): string {
  if (!list.length) return '<p class="empty">No rides yet. Go make somebody puke.</p>';
  return `<ol class="board">${list
    .map(
      (e, i) =>
        `<li class="${e.mine ? 'mine' : ''}${i < 3 ? ` podium p${i + 1}` : ''}"><span class="rank">${i + 1}</span><span class="who">${esc(e.name || 'Anonymous')}<small>${esc(e.park)}${e.day ? ` · day ${e.day}` : ''} · ${e.pukes} puke${e.pukes === 1 ? '' : 's'}</small></span><strong>${e.score.toLocaleString()}</strong></li>`,
    )
    .join('')}</ol>`;
}

async function fill(): Promise<void> {
  if (!dlg) return;
  const body = dlg.querySelector<HTMLElement>('.board-body')!;
  dlg.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  if (tab === 'mine') {
    body.innerHTML = rows(localScores());
    return;
  }
  body.innerHTML = '<p class="empty">Loading the board…</p>';
  try {
    const g = await globalScores();
    if (tab !== 'all') return;
    body.innerHTML = g
      ? rows(g)
      : '<p class="empty">The shared board lives in the claude.ai version of the game. Your rides on this device are under “This device”.</p>';
  } catch {
    body.innerHTML = '<p class="empty">Couldn’t reach the shared board. Try again in a moment.</p>';
  }
}

export function openScores(): void {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'scores-dialog';
    dlg.innerHTML = `
      <div class="card">
        <p class="eyebrow">Best single rides</p>
        <h2>Highscores</h2>
        <div class="tabs" role="group" aria-label="Which board">
          <button type="button" data-tab="all">Everyone</button>
          <button type="button" data-tab="mine">This device</button>
        </div>
        <div class="board-body"></div>
        <button type="button" class="primary" data-close>Close</button>
      </div>`;
    dlg.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === dlg || t.closest('[data-close]')) dlg!.close();
      const b = t.closest<HTMLButtonElement>('[data-tab]');
      if (b) {
        tab = b.dataset.tab as 'all' | 'mine';
        void fill();
      }
    });
    (document.querySelector('.app') ?? document.body).append(dlg);
  }
  dlg.showModal();
  void fill();
}

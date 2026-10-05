import { type PlayRecord, type StationStyle, UNLOCKS, type UnlockId, emptyRecord, stationStyles } from '../run/unlocks';

// The unlocks window, the "Unlocked!" toast, and keeping the season record in
// local storage (it's what unlocks carry over between visits).

const KEY = 'loophole.record';

export function loadRecord(): PlayRecord {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyRecord();
    const r = { ...emptyRecord(), ...(JSON.parse(raw) as Partial<PlayRecord>) };
    // Saves from before the skill layer (or damaged ones) lack these: start them empty.
    if (!Array.isArray(r.patterns)) r.patterns = [];
    if (!r.grades || typeof r.grades !== 'object' || Array.isArray(r.grades)) r.grades = {};
    return r;
  } catch {
    return emptyRecord();
  }
}

let last = '';
export function saveRecord(r: PlayRecord): void {
  const s = JSON.stringify(r);
  if (s === last) return;
  last = s;
  try {
    localStorage.setItem(KEY, s);
  } catch {
    /* private mode: unlocks just won't persist */
  }
}

/** A celebratory toast at the top of the screen. */
export function toast(title: string, sub = ''): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-icon" aria-hidden="true">🎁</span><span><strong></strong><small></small></span>`;
  el.querySelector('strong')!.textContent = title;
  el.querySelector('small')!.textContent = sub;
  (document.querySelector('.app') ?? document.body).append(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4800);
}

const STYLE_NAMES: Record<StationStyle, string> = { classic: 'Classic red', candy: 'Candy stripe', gold: 'Gold' };

let dlg: HTMLDialogElement | null = null;

export function openUnlocks(r: PlayRecord, onStyle: (s: StationStyle) => void): void {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'scores-dialog unlocks-dialog';
    dlg.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === dlg || t.closest('[data-close]')) dlg!.close();
      const b = t.closest<HTMLButtonElement>('[data-style]');
      if (b) {
        onStyleCb(b.dataset.style as StationStyle);
        render();
      }
    });
    (document.querySelector('.app') ?? document.body).append(dlg);
  }
  onStyleCb = onStyle;
  rec = r;
  render();
  dlg.showModal();
}

let onStyleCb: (s: StationStyle) => void = () => {};
let rec: PlayRecord = emptyRecord();

function render(): void {
  if (!dlg) return;
  const ids = Object.keys(UNLOCKS) as UnlockId[];
  const got = ids.filter((id) => rec.unlocked.includes(id)).length;
  const rows = ids
    .map((id) => {
      const u = UNLOCKS[id];
      const on = rec.unlocked.includes(id);
      return `<li class="${on ? 'got' : 'locked'}"><span class="u-icon" aria-hidden="true">${on ? '★' : '🔒'}</span><span class="u-text"><strong>${u.name}</strong><small>${on ? u.desc : u.how}</small></span></li>`;
    })
    .join('');
  const styles = stationStyles(rec)
    .map((s) => `<button type="button" class="style-btn ${s}${rec.station === s ? ' on' : ''}" data-style="${s}" aria-pressed="${rec.station === s}">${STYLE_NAMES[s]}</button>`)
    .join('');
  dlg.innerHTML = `
    <div class="card">
      <p class="eyebrow">${got} of ${ids.length} unlocked</p>
      <h2>Unlocks</h2>
      <p class="muted">Earned across all your seasons, and kept for the next ones.</p>
      <ul class="unlock-list">${rows}</ul>
      <p class="eyebrow">Station paint</p>
      <div class="styles">${styles}</div>
      <p class="muted small">${rec.seasons} season${rec.seasons === 1 ? '' : 's'} played · ${rec.wins} won · ${rec.totalPukes.toLocaleString()} pukes · best ride ${rec.bestRide.toLocaleString()}</p>
      <button type="button" class="primary" data-close>Close</button>
    </div>`;
}

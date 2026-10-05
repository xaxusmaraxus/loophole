import './style.css';
import './boss.css';
import { music } from './core/music';
import { sfx } from './core/sfx';
import { Game } from './game';
import { bulgeFor, type Dir } from './puzzle/board';
import { Renderer } from './render/renderer';
import type { ToolId } from './run/run';
import { Hud } from './ui/hud';
import { savePhoto } from './ui/photo';
import { lastRecord, nameLocal, postScore, setPlayerName } from './ui/scores';
import { copyShare, shareNative } from './ui/share';
import { openScores } from './ui/scoreboard';
import { driveToken } from './ui/map';
import { PlotPanel } from './ui/plot';

let mapBusy = false;
import type { SpecialId } from './puzzle/pieces';
import { UNLOCKS, type UnlockId } from './run/unlocks';
import { loadRecord, openUnlocks, saveRecord, toast } from './ui/unlocks';

const game = new Game();
// Unlocks carry over between seasons: load the record, then start the season with its kit.
game.record = loadRecord();
game.newRun(game.seed);
const canvas = document.getElementById('park') as HTMLCanvasElement;
const renderer = new Renderer(canvas, game);
const hud = new Hud(game);

function act(fn: () => void): void {
  fn();
  saveRecord(game.record);
  syncMusic();
  hud.update();
  plotPanel.update();
  // The score show stays up through the results, then clears.
  if (renderer.show.active && game.phase !== 'ride' && game.phase !== 'results') renderer.show.end();
}

// ---- The park plot panel (backpack grid beside the map and shop) ----
const plotPanel = new PlotPanel(game, document.getElementById('plotPanel')!, () => act(() => {}));
Object.assign(window, { loopholePlot: plotPanel });
// ---- end park plot panel ----

// Handy for playtesting from the browser console.
Object.assign(window, { loophole: game, loopholeRenderer: renderer, loopholeHud: hud, loopholeAct: act });

renderer.onRideDone = () => act(() => game.rideDone());
renderer.onOpenMe = () => act(() => game.open());
// The always-running ride: a lap paid out at the station, so the bank ticks up.
renderer.onLap = (lap, total, bossHits) => hud.lapPaid(lap, total, bossHits, renderer.stationScreen());
// The wallet counter waits for laps still on their way round; can't-afford taps shake it.
hud.pendingLaps = () => renderer.pendingLapTickets();
renderer.onBroke = () => hud.broke();

/** Tap a tile: buy it into the ride (with the purchase juice), or aim a tool. */
function tapCell(x: number, y: number): void {
  const buying = !game.aiming && game.board.loop && game.phase === 'build';
  const bulge = buying ? bulgeFor(game.board, x, y) : null;
  const cost = bulge ? game.bulgeCost(bulge) : 0;
  const rate = game.rate;
  act(() => game.tap(x, y));
  // It went in if the bulge's tile is track now.
  const bought = !!bulge && game.board.ends[0].some((c) => c.x === bulge.c.x && c.y === bulge.c.y);
  if (!bought) return;
  const pts = renderer.purchased([bulge.c, bulge.d], cost, game.rate - rate);
  hud.spend(cost, pts);
}
Object.assign(window, { loopholeTap: tapCell });
// Boss days: pips crack as the boss pukes, and the title card waits for "Bring it on!".
renderer.show.onBossPuke = () => {
  hud.bossCrack();
  music.stinger('crack');
};
hud.onBossCard = (kind) => music.stinger(kind === 'intro' ? 'bossIntro' : 'round');
document.getElementById('bossCard')!.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-boss-go]')) {
    (e.currentTarget as HTMLElement).hidden = true;
    sfx.bell();
  }
});
renderer.onUnlock = (id) => toast(`Unlocked: ${UNLOCKS[id as UnlockId].name}`, UNLOCKS[id as UnlockId].desc);
document.getElementById('unlocksHelp')!.addEventListener('click', () => {
  (document.getElementById('helpDialog') as HTMLDialogElement).close();
  document.getElementById('unlocks')!.click();
});
document.getElementById('unlocks')!.addEventListener('click', () =>
  openUnlocks(game.record, (style) => {
    game.record.station = style;
    saveRecord(game.record);
    renderer.restyleStation();
  }),
);

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return;
  // The boss's title card is up: any key that would play waits until it's dismissed.
  const bossCard = document.getElementById('bossCard')!;
  if (!bossCard.hidden && bossCard.classList.contains('intro')) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      bossCard.hidden = true;
      sfx.bell();
    }
    return;
  }
  if (game.phase === 'ride') {
    // Fast-forward the scoring show: everything resolves at once, same totals.
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      renderer.skipRide();
    }
    return;
  }
  const dir = KEYS[e.key];
  if (dir && (e.key.startsWith('Arrow') || game.phase === 'build')) {
    e.preventDefault();
    act(() => game.swipe(dir));
  } else if (e.key === 'Enter' && game.phase === 'build' && !(e.target instanceof HTMLButtonElement)) {
    act(() => game.open());
  } else if (e.key === 'Escape' && game.aiming) {
    act(() => (game.aiming = null));
  } else if (/^[1-5]$/.test(e.key) && game.phase === 'build') {
    const owned = document.querySelectorAll<HTMLButtonElement>('#tools [data-tool], #tools [data-special]');
    const btn = owned[Number(e.key) - 1];
    if (btn?.dataset.special) act(() => game.useSpecial(btn.dataset.special as SpecialId));
    else if (btn) act(() => game.useTool(btn.dataset.tool as ToolId));
  } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
    act(() => game.undo());
  }
});

// On the park: a drag is a swipe. While dragging, the park shows what the swipe
// would feed into the track. A tap only aims tools (or, on touch, meets a guest).
const wrap = document.getElementById('canvasWrap')!;
let start: { x: number; y: number } | null = null;
/** How far a drag goes before it counts as a swipe (and shows its preview). */
const SWIPE_PX = 16;
const dragDir = (dx: number, dy: number): Dir | null =>
  Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX ? null : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
wrap.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.overlay, .boss-card, .plot-panel, .go3d')) return;
  if (game.phase === 'ride') {
    renderer.skipRide();
    return;
  }
  start = { x: e.clientX, y: e.clientY };
  // Keep the drag ours even if it wanders off the park.
  try {
    wrap.setPointerCapture(e.pointerId);
  } catch {
    // Not capturable (synthetic events): fine.
  }
});
wrap.addEventListener('pointermove', (e) => {
  if (!start) return;
  renderer.setPreview(dragDir(e.clientX - start.x, e.clientY - start.y));
});
wrap.addEventListener('pointerup', (e) => {
  renderer.setPreview(null);
  if (!start) return;
  const dir = dragDir(e.clientX - start.x, e.clientY - start.y);
  start = null;
  if (!dir) {
    // A tap aims a tool, or grows the always-running loop over a tile next to it.
    const cell = game.aiming || game.board.loop ? renderer.cellAt(e.clientX, e.clientY) : null;
    const grows = !!cell && !game.aiming && game.growCells.some((c) => c.x === cell.x && c.y === cell.y);
    if (cell && (game.aiming || grows)) tapCell(cell.x, cell.y);
    else if (e.pointerType !== 'mouse') showGuest(e.clientX, e.clientY, true);
    return;
  }
  act(() => game.swipe(dir));
});
wrap.addEventListener('pointercancel', () => {
  start = null;
  renderer.setPreview(null);
});

// Guests: hover one in the park (or tap on a touch screen) to meet them.
const guestCard = document.getElementById('guestCard')!;
let guestShown = -1;
let guestTimer = 0;
function showGuest(x: number, y: number, sticky = false): boolean {
  const hit = (game.phase === 'build' || game.phase === 'intro') && !game.aiming ? renderer.guestAt(x, y) : null;
  renderer.hoverId = hit?.rider.id ?? null;
  wrap.style.cursor = hit ? 'help' : '';
  clearTimeout(guestTimer);
  if (!hit) {
    guestCard.hidden = true;
    guestShown = -1;
    return false;
  }
  if (hit.rider.id !== guestShown) {
    guestShown = hit.rider.id;
    guestCard.className = `guest-card${hit.rider.kind === 'vip' ? ' vip' : ''}${hit.rider.boss ? ' boss' : ''}`;
    guestCard.replaceChildren(hud.guestCard(hit.rider));
  }
  const r = wrap.getBoundingClientRect();
  const w = 250;
  guestCard.style.left = `${Math.min(r.width - w / 2 - 8, Math.max(w / 2 + 8, hit.x - r.left))}px`;
  guestCard.style.top = `${hit.y - r.top}px`;
  guestCard.hidden = false;
  if (sticky)
    guestTimer = window.setTimeout(() => {
      guestCard.hidden = true;
      guestShown = -1;
      renderer.hoverId = null;
    }, 2600);
  return true;
}
wrap.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || start || (e.target as HTMLElement).closest('.overlay')) return;
  if (showGuest(e.clientX, e.clientY)) return;
  // Tiles that grow the loop are clickable.
  const cell = game.phase === 'build' && game.board.loop && !game.aiming ? renderer.cellAt(e.clientX, e.clientY) : null;
  wrap.style.cursor = cell && game.growCells.some((c) => c.x === cell.x && c.y === cell.y) ? 'pointer' : '';
});
wrap.addEventListener('pointerleave', () => {
  guestCard.hidden = true;
  guestShown = -1;
  renderer.hoverId = null;
});

document.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((b) =>
  b.addEventListener('click', () => act(() => game.swipe(b.dataset.dir as Dir))),
);
document.getElementById('open')!.addEventListener('click', () => act(() => game.open()));
document.getElementById('tools')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tool], [data-special]');
  if (btn?.dataset.special) act(() => game.useSpecial(btn.dataset.special as SpecialId));
  else if (btn) act(() => game.useTool(btn.dataset.tool as ToolId));
});
// Hovering an attraction's card makes its landmark in the park wave hello.
let lastAttr = -1;
document.getElementById('attractions')!.addEventListener('mouseover', (e) => {
  const li = (e.target as HTMLElement).closest('.attraction:not(.empty)');
  const i = li ? [...li.parentElement!.children].indexOf(li) : -1;
  if (i !== lastAttr && i >= 0) renderer.pulseAttraction(i);
  lastAttr = i;
});
document.getElementById('switchEnd')!.addEventListener('click', () => act(() => game.selectEnd()));
document.getElementById('undo')!.addEventListener('click', () => act(() => game.undo()));
document.getElementById('newRun')!.addEventListener('click', () => act(() => game.newRun()));
document.getElementById('newRunHelp')!.addEventListener('click', () => {
  (document.getElementById('helpDialog') as HTMLDialogElement).close();
  act(() => game.newRun());
});

document.getElementById('overlay')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'node') {
    // The car drives to the picked stop first.
    if (mapBusy) return;
    mapBusy = true;
    const col = Number(btn.dataset.col);
    const node = Number(btn.dataset.node);
    sfx.whistle();
    void driveToken(col, node).then(() => {
      mapBusy = false;
      act(() => game.chooseNode(col, node));
    });
    return;
  }
  if (action === 'share') {
    void shareNative().then((note) => {
      if (note) btn.textContent = note;
    });
    return;
  }
  if (action === 'copy-share') {
    void copyShare().then((ok) => (btn.textContent = ok ? 'Copied!' : 'Copy failed'));
    return;
  }
  if (action === 'save-photo') {
    void savePhoto().then((note) => {
      if (note) btn.textContent = note;
    });
    return;
  }
  act(() => {
    if (action === 'continue') game.continueFromResults();
    else if (action === 'reward') game.chooseReward(Number(btn.dataset.index));
    else if (action === 'begin') game.beginPark();
    else if (action === 'skip') game.skipReward();
    else if (action === 'crack') {
      game.crackEgg();
      sfx.chain(3);
    } else if (action === 'egg-take') game.takeFromEgg(Number(btn.dataset.index));
    else if (action === 'egg-leave') game.closeEgg();
    else if (action === 'buy') game.buy(Number(btn.dataset.index));
    else if (action === 'leave') game.leaveShop();
    else if (action === 'newrun') game.newRun();
  });
  requestAnimationFrame(() => document.querySelector<HTMLElement>('#overlay [autofocus], #overlay button')?.focus());
});

document.getElementById('overlay')!.addEventListener('submit', (e) => {
  const form = (e.target as HTMLElement).closest<HTMLFormElement>('[data-form="post-score"]');
  if (!form) return;
  e.preventDefault();
  const name = String(new FormData(form).get('name') ?? '');
  setPlayerName(name);
  const note = form.querySelector<HTMLElement>('.post-note')!;
  const rec = lastRecord;
  if (!rec) return;
  rec.entry.name = name.trim() || 'Anonymous';
  nameLocal(rec.entry.at, rec.entry.name);
  note.textContent = 'Posting…';
  void postScore(rec.entry).then((res) => {
    note.textContent =
      res === 'posted'
        ? 'On the board!'
        : res === 'kept'
          ? 'Your best on the board is higher.'
          : res === 'denied'
            ? 'Kept on this device (the shared board is read-only for you).'
            : 'Kept on this device.';
  });
});

document.getElementById('scores')!.addEventListener('click', () => openScores());

window.addEventListener('resize', () => renderer.fit());
// The park is framed between the HUD bars: re-frame when they change size.
let reframeQueued = false;
const hudResize = new ResizeObserver(() => {
  if (reframeQueued) return;
  reframeQueued = true;
  requestAnimationFrame(() => {
    reframeQueued = false;
    // The banner row hangs just under the top HUD, however many rows that wrapped into.
    const under = document.getElementById('hudUnder');
    const top = document.getElementById('hudTop');
    const host = under?.offsetParent;
    if (under && top && host) under.style.top = `${top.getBoundingClientRect().bottom - host.getBoundingClientRect().top + 8}px`;
    renderer.reframe();
  });
});
for (const el of [document.getElementById('hudTop'), document.getElementById('hudUnder'), document.querySelector('.hud-bar')]) if (el) hudResize.observe(el);

const soundBtn = document.getElementById('sound') as HTMLButtonElement;
const syncSound = () => {
  soundBtn.innerHTML = `<span aria-hidden="true">${sfx.isMuted() ? '🔇' : '🔊'}</span>`;
  soundBtn.title = sfx.isMuted() ? 'Sound off' : 'Sound on';
  soundBtn.setAttribute('aria-pressed', String(!sfx.isMuted()));
};
soundBtn.addEventListener('click', () => {
  sfx.setMuted(!sfx.isMuted());
  syncSound();
});
syncSound();

const fsBtn = document.getElementById('fullscreen') as HTMLButtonElement;
const app = document.querySelector<HTMLElement>('.app')!;
if (!document.fullscreenEnabled) fsBtn.hidden = true;
fsBtn.addEventListener('click', () => {
  const req = document.fullscreenElement ? document.exitFullscreen() : app.requestFullscreen();
  req?.catch(() => (fsBtn.hidden = true));
});
document.addEventListener('fullscreenchange', () => {
  fsBtn.title = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  fsBtn.setAttribute('aria-label', fsBtn.title);
  requestAnimationFrame(() => renderer.fit());
});

// Music: starts on the first key press or tap (browsers need a gesture), then follows the game.
let lastPhase = '';
function syncMusic(): void {
  const p = game.phase;
  music.setPark(game.cfg.park.id);
  // (The ride theme starts at the dispatch bell, from the ride itself, not when Open is pressed.)
  if (p !== 'ride') music.setMode(p === 'intro' ? 'menu' : p === 'build' ? 'build' : p === 'results' || p === 'over' || p === 'won' ? 'results' : 'map');
  // Boss days get the boss variant of the park's song while you build and ride.
  music.setBoss(!!game.fight && (p === 'build' || p === 'ride' || p === 'results'));
  if (p === 'results' && lastPhase !== 'results' && game.result && !game.result.passed && !game.result.again) music.stinger('lose');
  if ((p === 'conquered' || p === 'won') && lastPhase !== p) music.stinger('conquered');
  lastPhase = p;
}
const startMusic = () => music.start();
window.addEventListener('pointerdown', startMusic, { once: true });
window.addEventListener('keydown', startMusic, { once: true });
syncMusic();
const musicBtn = document.getElementById('music') as HTMLButtonElement;
const syncMusicBtn = () => {
  musicBtn.setAttribute('aria-pressed', String(!music.isMuted()));
  musicBtn.title = music.isMuted() ? 'Music off' : 'Music on';
};
musicBtn.addEventListener('click', () => {
  music.setMuted(!music.isMuted());
  if (!music.isMuted()) music.start();
  syncMusicBtn();
});
syncMusicBtn();

// How to play.
const help = document.getElementById('helpDialog') as HTMLDialogElement;
document.getElementById('help')!.addEventListener('click', () => help.showModal());
help.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t === help || t.closest('[data-close]')) help.close();
});

// Popovers open on hover; on touch screens a tap toggles them.
document.querySelectorAll<HTMLElement>('.pop-wrap').forEach((w) =>
  w.querySelector('button')!.addEventListener('click', () => {
    const open = !w.classList.contains('open');
    document.querySelectorAll('.pop-wrap.open').forEach((o) => o.classList.remove('open'));
    w.classList.toggle('open', open);
  }),
);
document.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest('.pop-wrap')) document.querySelectorAll('.pop-wrap.open').forEach((o) => o.classList.remove('open'));
});

function frame(t: number): void {
  renderer.frame(t);
  hud.tick(performance.now());
  requestAnimationFrame(frame);
}

hud.update();
plotPanel.update();
requestAnimationFrame(frame);

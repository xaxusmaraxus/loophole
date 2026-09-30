import './style.css';
import { sfx } from './core/sfx';
import { Game } from './game';
import type { Dir } from './puzzle/board';
import { Renderer } from './render/renderer';
import type { ToolId } from './run/run';
import { Hud } from './ui/hud';

const game = new Game();
const canvas = document.getElementById('park') as HTMLCanvasElement;
const renderer = new Renderer(canvas, game);
const hud = new Hud(game);

function act(fn: () => void): void {
  fn();
  hud.update();
}

// Handy for playtesting from the browser console.
Object.assign(window, { loophole: game, loopholeRenderer: renderer });

renderer.onRideDone = () => act(() => game.rideDone());

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return;
  const dir = KEYS[e.key];
  if (dir && (e.key.startsWith('Arrow') || game.phase === 'build')) {
    e.preventDefault();
    act(() => (e.shiftKey ? game.buildDir(dir) : game.swipe(dir)));
  } else if (e.key === 'Tab' && game.phase === 'build') {
    e.preventDefault();
    act(() => game.selectEnd());
  } else if (e.key === 'Enter' && game.phase === 'build' && !(e.target instanceof HTMLButtonElement)) {
    act(() => game.open());
  } else if (e.key === 'Escape' && game.aiming) {
    act(() => (game.aiming = null));
  } else if (/^[1-5]$/.test(e.key) && game.phase === 'build') {
    const owned = document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]');
    const btn = owned[Number(e.key) - 1];
    if (btn) act(() => game.useTool(btn.dataset.tool as ToolId));
  } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
    act(() => game.undo());
  }
});

// On the park: a drag is a swipe, a tap builds on the tapped cell.
const wrap = document.getElementById('canvasWrap')!;
let start: { x: number; y: number } | null = null;
wrap.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.overlay')) return;
  start = { x: e.clientX, y: e.clientY };
});
wrap.addEventListener('pointerup', (e) => {
  if (!start) return;
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  start = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) {
    const cell = renderer.cellAt(e.clientX, e.clientY);
    if (cell) act(() => game.tap(cell.x, cell.y));
    return;
  }
  const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  act(() => game.swipe(dir));
});
wrap.addEventListener('pointercancel', () => (start = null));

document.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((b) =>
  b.addEventListener('click', () => act(() => game.swipe(b.dataset.dir as Dir))),
);
document.getElementById('open')!.addEventListener('click', () => act(() => game.open()));
document.getElementById('tools')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tool]');
  if (btn) act(() => game.useTool(btn.dataset.tool as ToolId));
});
document.getElementById('attractions')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn) return;
  if (btn.dataset.attrSell) act(() => game.sellAttraction(Number(btn.dataset.attrSell)));
  else if (btn.dataset.attrMove) act(() => game.moveAttraction(Number(btn.dataset.attrMove), Number(btn.dataset.by) as -1 | 1));
});
document.getElementById('switchEnd')!.addEventListener('click', () => act(() => game.selectEnd()));
document.getElementById('undo')!.addEventListener('click', () => act(() => game.undo()));
document.getElementById('newRun')!.addEventListener('click', () => act(() => game.newRun()));

document.getElementById('overlay')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  act(() => {
    if (action === 'continue') game.continueFromResults();
    else if (action === 'reward') game.chooseReward(Number(btn.dataset.index));
    else if (action === 'begin') game.beginPark();
    else if (action === 'node') game.chooseNode(Number(btn.dataset.col), Number(btn.dataset.node));
    else if (action === 'skip') game.skipReward();
    else if (action === 'buy') game.buy(Number(btn.dataset.index));
    else if (action === 'leave') game.leaveShop();
    else if (action === 'newrun') game.newRun();
  });
  requestAnimationFrame(() => document.querySelector<HTMLElement>('#overlay [autofocus], #overlay button')?.focus());
});

window.addEventListener('resize', () => renderer.fit());

const soundBtn = document.getElementById('sound') as HTMLButtonElement;
const syncSound = () => {
  soundBtn.textContent = sfx.isMuted() ? 'Sound off' : 'Sound on';
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
  fsBtn.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  requestAnimationFrame(() => renderer.fit());
});

function frame(t: number): void {
  renderer.frame(t);
  requestAnimationFrame(frame);
}

hud.update();
requestAnimationFrame(frame);

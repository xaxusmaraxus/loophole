import './style.css';
import { Game } from './game';
import type { Dir } from './puzzle/board';
import { Renderer } from './render/renderer';
import type { PerkId } from './run/run';
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
(window as unknown as { loophole: Game }).loophole = game;

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
    act(() => game.swipe(dir));
  } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
    act(() => game.undo());
  }
});

// Swipe on the park.
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
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
  const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  act(() => game.swipe(dir));
});
wrap.addEventListener('pointercancel', () => (start = null));

document.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((b) =>
  b.addEventListener('click', () => act(() => game.swipe(b.dataset.dir as Dir))),
);
document.getElementById('undo')!.addEventListener('click', () => act(() => game.undo()));
document.getElementById('newRun')!.addEventListener('click', () => act(() => game.newRun()));

document.getElementById('overlay')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  act(() => {
    if (action === 'continue') game.continueFromResults();
    else if (action === 'perk') game.choosePerk(btn.dataset.perk as PerkId);
    else if (action === 'newrun') game.newRun();
  });
  requestAnimationFrame(() => document.querySelector<HTMLElement>('#overlay [autofocus], #overlay button')?.focus());
});

window.addEventListener('resize', () => renderer.fit());

function frame(t: number): void {
  renderer.frame(t);
  requestAnimationFrame(frame);
}

hud.update();
requestAnimationFrame(frame);

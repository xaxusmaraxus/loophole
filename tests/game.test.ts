import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { idx } from '../src/puzzle/board';
import { dayConfig, modsFor, parkFor } from '../src/run/run';

/** A new game past the first park's intro card. */
function freshGame(): Game {
  const g = new Game('TEST01');
  g.beginDay();
  g.events.length = 0;
  return g;
}

describe('sunset', () => {
  it('stops swipes but not building or opening, and never opens the ride by itself', () => {
    const g = freshGame();
    g.daylight = 0;
    const tiles = [...g.board.tiles];
    g.swipe('left');
    g.swipe('right');
    expect(g.board.tiles).toEqual(tiles);
    expect(g.phase).toBe('build');
    const s = g.board.station;
    const n = g.board.size;
    const target = [
      { x: s.x + 1, y: s.y },
      { x: s.x - 1, y: s.y },
      { x: s.x, y: s.y + 1 },
      { x: s.x, y: s.y - 1 },
    ].find((p) => p.x >= 0 && p.y >= 0 && p.x < n && p.y < n && !g.board.obstacles[idx(g.board, p.x, p.y)])!;
    g.tap(target.x, target.y);
    expect(g.board.ends[0].length + g.board.ends[1].length).toBe(1);
    expect(g.openKind).toBe('shuttle');
  });

  it('building spends no daylight', () => {
    const g = freshGame();
    const before = g.daylight;
    const t = g.board.station;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.tap(t.x + dx, t.y + dy);
    expect(g.daylight).toBe(before);
  });
});

describe('tools', () => {
  it('paint upgrades a tile and spends a charge; undo refunds it', () => {
    const g = freshGame();
    const b = g.board;
    const i = b.tiles.findIndex((t) => t > 0 && t < 7);
    const before = b.tiles[i];
    g.tools.paint = 1;
    g.useTool('paint');
    g.tap(i % b.size, Math.floor(i / b.size));
    expect(g.tools.paint).toBe(0);
    // It may chain away, but the tile never goes down a tier.
    expect(g.board.tiles[i] === 0 || g.board.tiles[i] >= before + 1).toBe(true);
    g.undo();
    expect(g.tools.paint).toBe(1);
    expect(g.board.tiles[i]).toBe(before);
  });

  it('crane moves a tile to another cell', () => {
    const g = freshGame();
    const b = g.board;
    b.tiles = b.tiles.map(() => 0);
    const n = b.size;
    const free = [...Array(n * n).keys()].filter((k) => !b.obstacles[k] && k !== idx(b, b.station.x, b.station.y));
    const [from, to] = [free[0], free[free.length - 1]];
    b.tiles[from] = 3;
    g.tools.crane = 1;
    g.useTool('crane');
    g.tap(from % n, Math.floor(from / n));
    g.tap(to % n, Math.floor(to / n));
    expect(g.board.tiles[to]).toBe(3);
    expect(g.board.tiles[from]).toBe(0);
    expect(g.tools.crane).toBe(0);
  });

  it('coffee adds daylight, even after sunset', () => {
    const g = freshGame();
    g.daylight = 0;
    g.tools.coffee = 1;
    g.useTool('coffee');
    expect(g.daylight).toBe(5);
  });

  it('rewards add upgrades or tool charges', () => {
    const g = freshGame();
    g.offer = [{ kind: 'tool', id: 'dynamite' }, { kind: 'upgrade', id: 'latenight' }];
    g.phase = 'reward';
    g.chooseReward(0);
    expect(g.tools.dynamite).toBe(2);
    g.phase = 'reward';
    g.offer = [{ kind: 'upgrade', id: 'latenight' }];
    g.chooseReward(0);
    expect(g.upgrades).toContain('latenight');
    expect(g.cfg.daylight).toBe(dayConfig(g.dayNum, modsFor([])).daylight + 5);
  });
});

/** Pretend the current day just ended with this many tickets. */
function finish(g: Game, score: number): void {
  g.phase = 'results';
  g.result = { kind: 'circuit', stats: g.stats, tickets: [], score, target: g.cfg.target, passed: score >= g.cfg.target };
  g.continueFromResults();
}

describe('season', () => {
  it('runs three parks of three days, then the finale', () => {
    expect([1, 3, 4, 6, 7, 9, 10, 11].map((d) => parkFor(d).id)).toEqual([
      'meadow', 'meadow', 'boardwalk', 'boardwalk', 'hollow', 'hollow', 'finale', 'finale',
    ]);
  });

  it('opens each park with its intro card', () => {
    const g = new Game('TEST01');
    expect(g.phase).toBe('intro');
    g.beginDay();
    expect(g.phase).toBe('build');
  });

  it('banks surplus tickets and opens the shop after the last day of a park', () => {
    const g = freshGame();
    for (let d = 1; d <= 3; d++) {
      finish(g, g.cfg.target + 50);
      expect(g.phase).toBe('reward');
      g.chooseReward(0);
    }
    expect(g.funds).toBe(150);
    expect(g.phase).toBe('shop');
    const heart = g.shop.findIndex((i) => i.kind === 'heart');
    g.hearts = 2;
    g.funds = 500;
    g.buy(heart);
    expect(g.hearts).toBe(3);
    g.leaveShop();
    expect(g.dayNum).toBe(4);
    expect(g.cfg.park.id).toBe('boardwalk');
    expect(g.phase).toBe('intro');
  });

  it('wins the season by beating the finale, and repeats it on a miss', () => {
    const g = freshGame();
    g.dayNum = 9;
    finish(g, g.cfg.target);
    g.chooseReward(0);
    g.leaveShop();
    expect(g.dayNum).toBe(10);
    finish(g, 0);
    expect(g.hearts).toBe(2);
    g.chooseReward(0);
    expect(g.dayNum).toBe(10);
    finish(g, g.cfg.target);
    expect(g.phase).toBe('won');
  });
});

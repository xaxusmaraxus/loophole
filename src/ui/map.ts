import type { Game } from '../game';
import { mapArt } from '../render3d/mapart';
import { BOSSES } from '../riders/riders';
import { FINALE_DAY, NODE_INFO, PARKS, PARK_BOSS, type ParkId, SEASON_ORDER } from '../run/run';

// The route map, Slay the Spire style: a painted map of the park, read from the
// gates at the bottom up to the boss's lair at the top. Every stop is a little
// clay diorama on a medallion; trails join each stop to every stop in the next
// row. Your route and the trails you can take now stand out, the rest stay a
// faint hint, and a coaster-car token drives to the stop you pick.

/** The sheet's coordinate box (the SVG viewBox); nodes are placed in the same units. */
const W = 100;
const H = 130;

function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

interface Spot {
  x: number;
  y: number;
}

const LOOK: Record<ParkId, { ground: string; alt: string; dark: string; ink: string; leaf: string; accent: string }> = {
  meadow: { ground: '#9fd675', alt: '#c6ec9e', dark: '#6fae57', ink: '#2b2140', leaf: '#4e9a4a', accent: '#7fd3f0' },
  boardwalk: { ground: '#f1d59c', alt: '#fbeccb', dark: '#dcb877', ink: '#3a2a20', leaf: '#3f9a5a', accent: '#5cc8f0' },
  hollow: { ground: '#5a5277', alt: '#7a71a0', dark: '#3a3354', ink: '#1a1426', leaf: '#2e2844', accent: '#b9a8ff' },
  finale: { ground: '#f6cfe0', alt: '#fff0f6', dark: '#e3a9c3', ink: '#2b2140', leaf: '#72c457', accent: '#ffd23f' },
};

function tree(x: number, y: number, s: number, leaf: string, ink: string, dead = false): string {
  if (dead)
    return `<g stroke="${ink}" stroke-width="0.55" stroke-linecap="round" fill="none" opacity="0.8"><path d="M${x} ${y} l0 ${-4.4 * s} m0 ${1.6 * s} l${-1.7 * s} ${-1.5 * s} m${1.7 * s} ${0.2 * s} l${1.5 * s} ${-1.7 * s}"/></g>`;
  return `<g><ellipse cx="${x + 0.8 * s}" cy="${y + 0.2}" rx="${2 * s}" ry="${0.6 * s}" fill="${ink}" opacity="0.12"/><rect x="${x - 0.3 * s}" y="${y - 1.6 * s}" width="${0.6 * s}" height="${1.8 * s}" rx="0.3" fill="#8a5a36"/><circle cx="${x}" cy="${y - 3 * s}" r="${2.2 * s}" fill="${leaf}"/><circle cx="${x - 0.7 * s}" cy="${y - 3.6 * s}" r="${0.9 * s}" fill="#fff" opacity="0.18"/></g>`;
}

function palm(x: number, y: number, s: number): string {
  const leaves = [-2.4, -1.4, -0.6, 0.6, 1.4, 2.4]
    .map((a) => `<path d="M${x} ${y - 4.4 * s} q${a * 1.2 * s} ${-1.5 * s} ${a * 2.3 * s} ${0.7 * s}" stroke="#3f9a5a" stroke-width="${0.95 * s}" fill="none" stroke-linecap="round"/>`)
    .join('');
  return `<g><path d="M${x} ${y} q${0.8 * s} ${-2.2 * s} 0 ${-4.4 * s}" stroke="#a0703f" stroke-width="${0.75 * s}" fill="none" stroke-linecap="round"/>${leaves}</g>`;
}

/**
 * The painted park under the trails. Calm on purpose: a soft lit gradient, a few
 * big shapes, one themed feature (a river, the sea, the moon, bunting) and a
 * handful of trees at the edges, away from the stops and trails.
 */
function backdrop(park: ParkId, seed: number, spots: Spot[], paths: Spot[], boss: Spot | null): string {
  const L = LOOK[park];
  const r = prng(seed);
  const out: string[] = [];
  out.push(`<defs>
    <radialGradient id="mapLight" cx="50%" cy="42%" r="75%">
      <stop offset="0" stop-color="${L.alt}"/>
      <stop offset="0.55" stop-color="${L.ground}"/>
      <stop offset="1" stop-color="${L.dark}"/>
    </radialGradient>
    <radialGradient id="mapSpot" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff3b0" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#fff3b0" stop-opacity="0"/>
    </radialGradient>
    <filter id="mapSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4"/></filter>
    <filter id="mapGrain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="${seed % 97}"/>
      <feColorMatrix values="0 0 0 0 0.2  0 0 0 0 0.15  0 0 0 0 0.1  0 0 0 0.06 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
  </defs>`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#mapLight)"/>`);
  // A few big, soft rolling shapes.
  const soft: string[] = [];
  for (let k = 0; k < 5; k++)
    soft.push(`<ellipse cx="${r() * W}" cy="${10 + r() * (H - 20)}" rx="${24 + r() * 26}" ry="${10 + r() * 12}" fill="${k % 2 ? L.alt : L.dark}" opacity="${0.22 + r() * 0.16}"/>`);
  out.push(`<g filter="url(#mapSoft)">${soft.join('')}</g>`);
  const clear = (x: number, y: number, d = 13) =>
    y > 24 && y < H - 8 && spots.every((q) => Math.hypot(q.x - x, (q.y - y) * 0.9) > d) && paths.every((q) => Math.hypot(q.x - x, q.y + 2.6 - y) > 5 && Math.hypot(q.x - x, q.y - y) > 3.5);
  if (park === 'meadow') {
    // A lazy river across the park.
    const d = `M-4 ${54 + r() * 10} C 25 ${40 + r() * 10}, 35 ${88 + r() * 8}, 60 ${80 + r() * 8} S 90 ${60 + r() * 10}, 106 ${70 + r() * 10}`;
    out.push(`<path d="${d}" fill="none" stroke="${shadeHex(L.accent, -0.15)}" stroke-width="6.4" stroke-linecap="round" opacity="0.55"/>`);
    out.push(`<path d="${d}" fill="none" stroke="${L.accent}" stroke-width="4.6" stroke-linecap="round" opacity="0.85"/>`);
    out.push(`<path d="${d}" fill="none" stroke="#e6fbff" stroke-width="1" stroke-dasharray="3 5" stroke-linecap="round" opacity="0.8"/>`);
  }
  if (park === 'boardwalk') {
    out.push(`<path d="M${W} 0 L84 0 Q78 22 85 44 T83 88 T86 ${H} L${W} ${H} Z" fill="${L.accent}"/>`);
    out.push(`<path d="M84 0 Q78 22 85 44 T83 88 T86 ${H}" fill="none" stroke="#fff" stroke-width="1.1" opacity="0.9"/>`);
    out.push(`<path d="M88 0 Q82 22 89 44 T87 88 T90 ${H}" fill="none" stroke="#fff" stroke-width="0.4" opacity="0.5"/>`);
  }
  if (park === 'hollow') {
    out.push(`<circle cx="82" cy="16" r="9" fill="#f6f1d8" opacity="0.18" filter="url(#mapSoft)"/><circle cx="82" cy="16" r="5.4" fill="#f6f1d8"/><circle cx="84.3" cy="14.8" r="4.8" fill="${L.ground}"/>`);
    for (let k = 0; k < 4; k++) out.push(`<ellipse cx="${r() * W}" cy="${30 + r() * 90}" rx="${22 + r() * 16}" ry="2.6" fill="#fff" opacity="0.07" filter="url(#mapSoft)"/>`);
  }
  if (park === 'finale') {
    let d = 'M0 9';
    for (let x = 0; x < W; x += 8) d += ` Q${x + 4} 13 ${x + 8} 9`;
    out.push(`<path d="${d}" fill="none" stroke="${L.ink}" stroke-width="0.3" opacity="0.6"/>`);
    for (let x = 2; x < W; x += 8) out.push(`<path d="M${x} 10 l2 3.4 l2 -3.4 z" fill="${['#f0584e', '#ffd23f', '#45a8e0'][Math.round(x / 8) % 3]}"/>`);
  }
  // The boss's lair glows.
  if (boss) out.push(`<ellipse cx="${boss.x}" cy="${boss.y + 2}" rx="20" ry="14" fill="url(#mapSpot)"/>`);
  // A few trees (palms, dead trees) at the edges.
  let placed = 0;
  for (let k = 0; k < 60 && placed < 9; k++) {
    const side = k % 2 ? r() * 16 + 3 : W - 3 - r() * 16;
    const x = park === 'boardwalk' && side > 60 ? 4 + r() * 14 : side;
    const y = 26 + r() * (H - 36);
    if (!clear(x, y)) continue;
    const s2 = 0.9 + r() * 0.5;
    out.push(park === 'boardwalk' ? palm(x, y, s2) : tree(x, y, s2, park === 'finale' ? ['#72c457', '#ff8fb8', '#ffd23f'][k % 3] : L.leaf, L.ink, park === 'hollow'));
    placed++;
  }
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" filter="url(#mapGrain)"/>`);
  // A gilt inner frame.
  out.push(`<rect x="2.4" y="2.4" width="${W - 4.8}" height="${H - 4.8}" rx="3.5" fill="none" stroke="#e8c15a" stroke-width="0.55" opacity="0.9"/>`);
  out.push(`<rect x="3.4" y="3.4" width="${W - 6.8}" height="${H - 6.8}" rx="2.8" fill="none" stroke="${L.ink}" stroke-width="0.18" opacity="0.35"/>`);
  return out.join('');
}

function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (k > 0 ? (255 - v) * k : v * k))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}

/** A gentle trail from a to b: the SVG path, and points along it (so scenery keeps off it). */
function trail(a: Spot, b: Spot, bend: number): { d: string; pts: Spot[] } {
  const dy = b.y - a.y;
  const c1 = { x: a.x + bend, y: a.y + dy * 0.45 };
  const c2 = { x: b.x - bend, y: b.y - dy * 0.45 };
  const pts: Spot[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    const u = 1 - t;
    pts.push({
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    });
  }
  const f = (n: number) => n.toFixed(2);
  return { d: `M${f(a.x)} ${f(a.y)} C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`, pts };
}

/**
 * The car token drives along the trail from where you are to the picked stop.
 * Resolves when it arrives (right away if there's no trail to follow).
 */
export function driveToken(col: number, node: number): Promise<void> {
  const sheet = document.querySelector('.mapsheet');
  const token = sheet?.querySelector<HTMLElement>('.mtoken');
  const path = sheet?.querySelector<SVGPathElement>(`path.trail.open[data-to="${col}-${node}"]`);
  if (!sheet || !token || !path || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const len = path.getTotalLength();
  const t0 = performance.now();
  const dur = 700 + len * 18;
  token.classList.add('driving');
  return new Promise((done) => {
    let lastX = path.getPointAtLength(0).x;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const p = path.getPointAtLength(len * e);
      token.style.left = `${(p.x / W) * 100}%`;
      token.style.top = `${(p.y / H) * 100}%`;
      if (Math.abs(p.x - lastX) > 0.05) token.style.setProperty('--flip', p.x < lastX ? '-1' : '1');
      lastX = p.x;
      if (t < 1) requestAnimationFrame(step);
      else setTimeout(done, 180);
    };
    requestAnimationFrame(step);
  });
}

export function mapHtml(g: Game): string {
  const park = g.cfg.park;
  const id = park.id as ParkId;
  const rows = g.parkMap;
  const seed = hash(`${g.seed}:${id}:${g.parkIndex}`);
  const r = prng(seed);
  // Where everything goes: the gates at the bottom, the boss at the top.
  const gates: Spot = { x: 50, y: H - 17 };
  const top = 31;
  const bottom = H - 40;
  const spots: Spot[][] = rows.map((row, ci) => {
    const y = rows.length === 1 ? (top + bottom) / 2 : bottom - (ci * (bottom - top)) / (rows.length - 1);
    return row.map((_, ni) => {
      const x = row.length === 1 ? 50 : 20 + (ni * 60) / (row.length - 1);
      return { x: x + (r() - 0.5) * 8, y: y + (r() - 0.5) * 2.5 };
    });
  });
  const taken = (ci: number, ni: number) => g.visited.some((v) => v.col === ci && v.node === ni) || (g.mapPos?.col === ci && g.mapPos.node === ni);
  const here = g.mapPos ? spots[g.mapPos.col][g.mapPos.node] : gates;
  // Trails.
  const trails: string[] = [];
  const along: Spot[] = [];
  const add = (a: Spot, b: Spot, cls: string, from: string, to: string) => {
    const t = trail(a, b, (r() - 0.5) * 9);
    along.push(...t.pts);
    trails.push(`<path class="trail ${cls}" d="${t.d}" data-from="${from}" data-to="${to}"/>`);
  };
  // Only your route and the trails you can take now are drawn strongly; the rest are a faint hint.
  spots[0].forEach((b, ni) => add(gates, b, !g.mapPos ? (g.isReachable(0) ? 'open' : 'faint') : taken(0, ni) ? 'done' : 'faint', 'gates', `0-${ni}`));
  for (let ci = 0; ci + 1 < spots.length; ci++)
    spots[ci].forEach((a, ai) =>
      spots[ci + 1].forEach((b, bi) => {
        const cur = g.mapPos?.col === ci && g.mapPos.node === ai;
        const cls = taken(ci, ai) && taken(ci + 1, bi) ? 'done' : cur && g.isReachable(ci + 1) ? 'open' : 'faint';
        add(a, b, cls, `${ci}-${ai}`, `${ci + 1}-${bi}`);
      }),
    );
  // Open trails on top.
  trails.sort((p, q) => Number(p.includes(' open')) - Number(q.includes(' open')));
  // Stops.
  const boss = PARK_BOSS[id];
  const nodes = rows
    .map((row, ci) =>
      row
        .map((n, ni) => {
          const s = spots[ci][ni];
          const visited = g.visited.some((v) => v.col === ci && v.node === ni);
          const current = g.mapPos?.col === ci && g.mapPos.node === ni;
          const reachable = g.isReachable(ci);
          const state = current ? 'current' : visited ? 'visited' : reachable ? 'reachable' : 'locked';
          const info = NODE_INFO[n.kind];
          const isBoss = n.kind === 'boss' || n.kind === 'finale';
          const name = n.kind === 'boss' ? BOSSES[boss].name : info.name;
          const desc = isBoss ? `${info.desc} Stomach ${BOSSES[boss].stomach}. ${BOSSES[boss].trait}` : info.desc;
          const art = mapArt(n.kind, id, isBoss ? boss : undefined);
          return `<button type="button" class="mnode ${n.kind} ${state}${isBoss ? ' big' : ''}" style="left:${((s.x / W) * 100).toFixed(2)}%;top:${((s.y / H) * 100).toFixed(2)}%" data-action="node" data-col="${ci}" data-node="${ni}" ${reachable ? '' : 'disabled'} aria-label="${name}. ${desc}">
            <span class="mglow" aria-hidden="true"></span>
            ${art ? `<img src="${art}" alt="" draggable="false">` : `<span class="mdot" aria-hidden="true"></span>`}
            <span class="mlabel">${n.kind === 'boss' ? `Boss: ${name}` : name}</span>
            <span class="mtip" role="presentation"><strong>${n.kind === 'boss' ? `Boss: ${name}` : name}</strong>${desc}</span>
          </button>`;
        })
        .join(''),
    )
    .join('');
  const gatesArt = mapArt('gates', id);
  const token = mapArt('token', id);
  const next = SEASON_ORDER[g.parkIndex + 1];
  return `
    <div class="mapsheet park-${id}">
      <svg class="map-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        ${backdrop(id, seed, [...spots.flat(), gates], along, rows.length > 1 ? spots[spots.length - 1][0] : null)}
        <g class="trails">${trails.join('')}</g>
      </svg>
      <div class="mstop gates" style="left:${(gates.x / W) * 100}%;top:${(gates.y / H) * 100}%">${gatesArt ? `<img src="${gatesArt}" alt="" draggable="false">` : ''}<span class="mlabel">Park gates</span></div>
      ${nodes}
      ${token ? `<img class="mtoken" src="${token}" alt="You are here" style="left:${(here.x / W) * 100}%;top:${(here.y / H) * 100}%">` : ''}
      <header class="map-head">
        <p class="map-eyebrow">Season day ${g.dayNum} of ${FINALE_DAY}</p>
        <h2 class="map-title"><span>${park.name}</span></h2>
      </header>
      ${g.notice ? `<p class="map-note">${g.notice}</p>` : '<p class="map-note soft">Pick your next stop. The boss waits at the top.</p>'}
      <p class="map-next">${next ? `Next park: ${PARKS[next].name} →` : 'Then: the end of the season'}</p>
    </div>`;
}

import type { Game } from '../game';
import { mapArt } from '../render3d/mapart';
import { BOSSES } from '../riders/riders';
import { FINALE_DAY, NODE_INFO, PARKS, PARK_BOSS, type ParkId, SEASON_ORDER } from '../run/run';

// The route map, Slay the Spire style: a painted map of the park, read from the
// gates at the bottom up to the boss's lair at the top. Every stop is a little
// clay diorama; inked trails join each stop to every stop in the next row, and
// the trails you can take next march toward you.

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

const LOOK: Record<ParkId, { ground: string; alt: string; dark: string; ink: string; leaf: string; trail: string }> = {
  meadow: { ground: '#a8dc7c', alt: '#c2e896', dark: '#86c262', ink: '#2b2140', leaf: '#4e9a4a', trail: '#f3e7c6' },
  boardwalk: { ground: '#f2d9a4', alt: '#f8e6bf', dark: '#e2c287', ink: '#3a2a20', leaf: '#3f9a5a', trail: '#fff3d8' },
  hollow: { ground: '#5d5578', alt: '#6f6790', dark: '#4a4262', ink: '#1a1426', leaf: '#3a3450', trail: '#8b83a8' },
  finale: { ground: '#f7d6e4', alt: '#fbe6ef', dark: '#eab8cd', ink: '#2b2140', leaf: '#72c457', trail: '#fff7fb' },
};

function tree(x: number, y: number, s: number, leaf: string, ink: string, dead = false): string {
  if (dead)
    return `<g stroke="${ink}" stroke-width="0.5" stroke-linecap="round" fill="none"><path d="M${x} ${y} l0 ${-4 * s} m0 ${1.5 * s} l${-1.6 * s} ${-1.4 * s} m${1.6 * s} ${0.2 * s} l${1.4 * s} ${-1.6 * s}"/></g>`;
  return `<g><rect x="${x - 0.35 * s}" y="${y - 1.6 * s}" width="${0.7 * s}" height="${1.8 * s}" rx="0.3" fill="#8a5a36" stroke="${ink}" stroke-width="0.35"/><circle cx="${x}" cy="${y - 2.8 * s}" r="${2.1 * s}" fill="${leaf}" stroke="${ink}" stroke-width="0.4"/><circle cx="${x - 0.6 * s}" cy="${y - 3.3 * s}" r="${0.6 * s}" fill="#fff" opacity="0.28"/></g>`;
}

function palm(x: number, y: number, s: number, ink: string): string {
  const leaves = [-2.4, -1.6, -0.8, 0.8, 1.6, 2.4]
    .map((a) => `<path d="M${x} ${y - 4.2 * s} q${a * 1.2 * s} ${-1.4 * s} ${a * 2.2 * s} ${0.6 * s}" stroke="#3f9a5a" stroke-width="${0.9 * s}" fill="none" stroke-linecap="round"/>`)
    .join('');
  return `<g><path d="M${x} ${y} q${0.8 * s} ${-2 * s} 0 ${-4.2 * s}" stroke="#a0703f" stroke-width="${0.7 * s}" fill="none" stroke-linecap="round"/>${leaves}<circle cx="${x}" cy="${y - 4.2 * s}" r="${0.35 * s}" fill="${ink}"/></g>`;
}

/** The painted park under the trails: ground, blobs, and themed doodles away from the stops. */
function backdrop(park: ParkId, seed: number, spots: Spot[], paths: Spot[]): string {
  const L = LOOK[park];
  const r = prng(seed);
  const out: string[] = [];
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${L.ground}"/>`);
  for (let k = 0; k < 16; k++)
    out.push(`<ellipse cx="${r() * W}" cy="${r() * H}" rx="${6 + r() * 14}" ry="${4 + r() * 9}" fill="${k % 2 ? L.alt : L.dark}" opacity="${0.35 + r() * 0.3}"/>`);
  const clear = (x: number, y: number, d = 12) =>
    y > 22 && y < H - 6 && spots.every((s) => Math.hypot(s.x - x, (s.y - y) * 0.9) > d) && paths.every((q) => Math.hypot(q.x - x, q.y + 2.6 - y) > 4.2 && Math.hypot(q.x - x, q.y - y) > 2.5);
  if (park === 'boardwalk') {
    // The sea down the right-hand side, with waves and a pier.
    out.push(`<path d="M${W} 0 L78 0 Q72 20 79 40 T77 80 T80 ${H} L${W} ${H} Z" fill="#5cc8f0"/>`);
    out.push(`<path d="M78 0 Q72 20 79 40 T77 80 T80 ${H}" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.8"/>`);
    for (let k = 0; k < 14; k++) {
      const x = 84 + r() * 12;
      const y = 4 + r() * (H - 8);
      out.push(`<path d="M${x} ${y} q1 -1 2 0 t2 0" stroke="#fff" stroke-width="0.45" fill="none" opacity="0.8"/>`);
    }
    out.push(`<rect x="76" y="62" width="18" height="3" fill="#b98552" stroke="${L.ink}" stroke-width="0.35"/>`);
    for (let x = 78; x < 94; x += 3) out.push(`<rect x="${x}" y="65" width="0.8" height="2.4" fill="#8a5a2e"/>`);
  }
  let pond: Spot | null = null;
  if (park === 'meadow') {
    // A duck pond, wherever it fits.
    pond = [{ x: 12, y: 62 }, { x: 88, y: 66 }, { x: 12, y: 44 }, { x: 88, y: 44 }, { x: 12, y: 84 }, { x: 88, y: 88 }].find((c) =>
      spots.every((s) => Math.hypot(s.x - c.x, s.y - c.y) > 17) && paths.every((q) => Math.hypot(q.x - c.x, q.y - c.y) > 9),
    ) ?? null;
    if (pond) {
      const { x, y } = pond;
      out.push(`<ellipse cx="${x}" cy="${y}" rx="8" ry="5" fill="#5cc8f0" stroke="${L.ink}" stroke-width="0.45"/><ellipse cx="${x - 2}" cy="${y - 1.4}" rx="3.6" ry="1.3" fill="#b9f0ff" opacity="0.8"/>`);
      out.push(`<g><ellipse cx="${x + 3}" cy="${y + 1.5}" rx="1.3" ry="0.8" fill="#ffd23f" stroke="${L.ink}" stroke-width="0.25"/><circle cx="${x + 4}" cy="${y + 0.6}" r="0.6" fill="#ffd23f" stroke="${L.ink}" stroke-width="0.25"/></g>`);
    }
  }
  if (park === 'hollow') {
    out.push(`<circle cx="84" cy="12" r="6" fill="#f3efd6"/><circle cx="86.5" cy="10.5" r="5.2" fill="${L.ground}"/>`);
    for (let k = 0; k < 7; k++) {
      const x = 6 + r() * 88;
      const y = 10 + r() * 110;
      if (!clear(x, y)) continue;
      out.push(`<path d="M${x - 1.4} ${y} v-2.4 a1.4 1.4 0 0 1 2.8 0 v2.4 z" fill="#8a84a0" stroke="${L.ink}" stroke-width="0.35"/>`);
    }
    for (let k = 0; k < 8; k++) out.push(`<ellipse cx="${r() * W}" cy="${r() * H}" rx="${8 + r() * 10}" ry="${2 + r() * 2}" fill="#fff" opacity="0.1"/>`);
  }
  if (park === 'finale') {
    for (const y of [9, 16]) {
      let d = `M0 ${y}`;
      for (let x = 0; x < W; x += 6) d += ` Q${x + 3} ${y + 3} ${x + 6} ${y}`;
      out.push(`<path d="${d}" fill="none" stroke="${L.ink}" stroke-width="0.3"/>`);
      for (let x = 1.5; x < W; x += 6) out.push(`<path d="M${x} ${y + 0.8} l1.5 2.6 l1.5 -2.6 z" fill="${['#f0584e', '#ffd23f', '#45a8e0'][Math.round(x) % 3]}"/>`);
    }
  }
  // Trees (or palms, or dead trees) wherever there's room.
  for (let k = 0; k < 70; k++) {
    const x = 4 + r() * (park === 'boardwalk' ? 68 : 92);
    const y = 6 + r() * (H - 10);
    if (!clear(x, y) || (pond && Math.hypot(x - pond.x, y - pond.y) < 11)) continue;
    const s = 0.8 + r() * 0.5;
    out.push(park === 'boardwalk' ? palm(x, y, s, L.ink) : tree(x, y, s, park === 'finale' ? ['#72c457', '#ff8fb8', '#ffd23f'][k % 3] : L.leaf, L.ink, park === 'hollow' && k % 2 === 0));
  }
  // Flowers and pebbles.
  for (let k = 0; k < 40; k++) {
    const x = r() * W;
    const y = r() * H;
    if (!clear(x, y, 8)) continue;
    out.push(`<circle cx="${x}" cy="${y}" r="${0.4 + r() * 0.3}" fill="${['#ff5d8a', '#ffd23f', '#fbf6ec', '#9d6ef0'][k % 4]}" opacity="0.9"/>`);
  }
  // A compass rose.
  out.push(
    `<g transform="translate(9 ${H - 10})" stroke="${L.ink}" stroke-width="0.35"><circle r="4.2" fill="#fbf6ec" opacity="0.85"/><path d="M0 -3.6 L1 0 L0 3.6 L-1 0 Z" fill="#f0584e"/><path d="M-3.6 0 L0 -0.8 L3.6 0 L0 0.8 Z" fill="${L.ink}" opacity="0.7"/><text y="-4.8" font-size="2.4" text-anchor="middle" fill="${L.ink}" stroke="none" font-family="Bungee, sans-serif">N</text></g>`,
  );
  return out.join('');
}

/** A wobbly inked trail from a to b: the SVG path, and points along it (so scenery keeps off it). */
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
  const add = (a: Spot, b: Spot, cls: string) => {
    const t = trail(a, b, (r() - 0.5) * 10);
    along.push(...t.pts);
    trails.push(`<path class="trail ${cls}" d="${t.d}"/>`);
  };
  spots[0].forEach((b, ni) => add(gates, b, !g.mapPos ? (g.isReachable(0) ? 'open' : '') : taken(0, ni) ? 'done' : 'faded'));
  for (let ci = 0; ci + 1 < spots.length; ci++)
    spots[ci].forEach((a, ai) =>
      spots[ci + 1].forEach((b, bi) => {
        const cur = g.mapPos?.col === ci && g.mapPos.node === ai;
        const cls = taken(ci, ai) && taken(ci + 1, bi) ? 'done' : cur && g.isReachable(ci + 1) ? 'open' : g.mapPos && ci + 1 <= g.mapPos.col ? 'faded' : '';
        add(a, b, cls);
      }),
    );
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
        <defs>
          <filter id="mapGrain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 97}"/>
            <feColorMatrix values="0 0 0 0 0.2  0 0 0 0 0.15  0 0 0 0 0.1  0 0 0 0.09 0"/>
            <feComposite in2="SourceGraphic" operator="in"/>
          </filter>
        </defs>
        ${backdrop(id, seed, [...spots.flat(), gates], along)}
        <rect x="0" y="0" width="${W}" height="${H}" filter="url(#mapGrain)"/>
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

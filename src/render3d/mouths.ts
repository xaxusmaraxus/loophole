import { CircleGeometry, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, RingGeometry, Shape, ShapeGeometry } from 'three';
import { Geo, shade, v3 } from './geo';
import { GLOW_LAYER } from './post';
import { MATS } from './toon';

// The two open ends of the track are hungry mouths: a chunky clay chomper in
// the end's color, sitting on the head of the track and facing the cells it
// can eat from. Tiles swiped into it become track.

export interface Mouth {
  group: Group;
  /** The body turns to face what it's about to eat (the halo stays flat). */
  body: Group;
  /** The two halves of the puck: they swing apart around the middle to open the mouth. */
  jaws: [Group, Group];
  halo: Mesh;
  haloMat: MeshBasicMaterial;
}

/** Radius and height of the chomper (cells). */
const R = 0.3;
const H = 0.15;
const LIP = '#7a1f35';

/**
 * One half of the puck (side 1: x > 0, side -1: x < 0), split along the
 * x = 0 plane; the mouth opens at +z. Puffy clay profile, a dark lip on the
 * cut face, and teeth that point across at the other half.
 */
function jawGeo(color: string, side: 1 | -1): Geo {
  const g = new Geo();
  const prof: [number, number][] = [
    [R * 0.82, 0],
    [R, H * 0.45],
    [R * 0.84, H],
  ];
  const top = v3(0, H * 1.18, 0);
  const bot = v3(0, 0, 0);
  const mid = v3(0, H * 0.5, 0);
  const N = 12;
  const ring = (a: number) => prof.map(([r, y]) => v3(side * Math.sin(a) * r, y, Math.cos(a) * r));
  const topC = shade(color, 0.1);
  for (let i = 0; i < N; i++) {
    const p = ring((Math.PI * i) / N);
    const q = ring((Math.PI * (i + 1)) / N);
    for (let k = 0; k < prof.length - 1; k++) g.quad(p[k], q[k], q[k + 1], p[k + 1], k === 0 ? shade(color, -0.12) : color, mid);
    g.tri(p[2], q[2], top, topC, mid);
    g.tri(p[0], q[0], bot, shade(color, -0.25), mid);
  }
  // The cut face: the inside of the mouth.
  const front = ring(0);
  const back = ring(Math.PI);
  const face = [bot, ...front, top, ...[...back].reverse()];
  const c = v3(0, H * 0.5, 0);
  const inside = v3(side, H * 0.5, 0);
  for (let i = 0; i < face.length; i++) g.tri(face[i], face[(i + 1) % face.length], c, LIP, inside);
  // Teeth along the top of the lip, interlocking with the other half's.
  const zs = side > 0 ? [0.78, 0.42] : [0.6, 0.24];
  for (const z of zs) {
    const len = R * 0.26;
    const m = new Matrix4().makeRotationZ((side * Math.PI) / 2).setPosition(-side * len * 0.35, H * 0.86, z * R);
    g.cyl(m, R * 0.1, 0.003, len, '#fffaf0', 5);
  }
  return g;
}

export function makeMouth(color: string): Mouth {
  const group = new Group();
  const body = new Group();
  group.add(body);
  const jaws = ([1, -1] as const).map((side) => {
    const j = new Group();
    j.add(new Mesh(jawGeo(color, side).build(), MATS.gloss));
    body.add(j);
    return j;
  }) as [Group, Group];
  // Inside: a dark throat and a pink tongue, seen when it opens.
  const inner = new Geo();
  inner.sphere(v3(0, H * 0.32, 0), R * 0.8, '#3a0f22', 1, 0.3, 1, 12, 5, true);
  inner.sphere(v3(0, H * 0.5, R * 0.3), R * 0.38, '#f27a9a', 1, 0.32, 1.2, 10, 5, true);
  body.add(new Mesh(inner.build(), MATS.gloss));
  // Googly eyes on stalks at the back, looking up at you.
  const eyes = new Geo();
  const dark = shade(color, -0.3);
  for (const sx of [-1, 1]) {
    const ex = sx * R * 0.34;
    const ez = -R * 0.5;
    const ey = H * 1.1 + R * 0.42;
    eyes.post(ex, H * 0.8, ez, R * 0.07, ey - H * 0.8, dark, 6);
    eyes.sphere(v3(ex, ey, ez), R * 0.27, '#fffaf0', 1, 1, 1, 10, 6, true);
    eyes.sphere(v3(ex + sx * R * 0.02, ey + R * 0.2, ez - R * 0.1), R * 0.12, '#2b2140', 1, 0.7, 1, 8, 5, true);
    eyes.sphere(v3(ex - sx * R * 0.04, ey + R * 0.27, ez - R * 0.06), R * 0.04, '#ffffff', 1, 1, 1, 6, 4, true);
  }
  body.add(new Mesh(eyes.build(), MATS.gloss));
  body.traverse((m) => (m.castShadow = true));
  // A soft glowing pad under it, pulsing in the end's color.
  const haloMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false });
  const halo = new Mesh(new CircleGeometry(0.36, 28).rotateX(-Math.PI / 2), haloMat);
  halo.layers.set(GLOW_LAYER);
  halo.renderOrder = 4;
  group.add(halo);
  return { group, body, jaws, halo, haloMat };
}

/** A flat chevron pointing along +z, for "feed this way" arrows. */
const chevShape = (() => {
  const s = new Shape();
  const w = 0.16;
  const h = 0.12;
  const t = 0.06;
  s.moveTo(-w, -h / 2);
  s.lineTo(0, h / 2);
  s.lineTo(w, -h / 2);
  s.lineTo(w, -h / 2 + t);
  s.lineTo(0, h / 2 + t);
  s.lineTo(-w, -h / 2 + t);
  s.closePath();
  return s;
})();
const chevGeo = new ShapeGeometry(chevShape).rotateX(-Math.PI / 2).rotateY(Math.PI);

export function makeChevron(): Mesh {
  const m = new Mesh(chevGeo, new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, side: DoubleSide }));
  m.layers.set(GLOW_LAYER);
  m.renderOrder = 6;
  return m;
}

/** A thick square glow ring around a crate's lid (the eat preview). */
const outlineGeo = new RingGeometry(0.4, 0.52, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2);
export function makeOutline(): Mesh {
  const m = new Mesh(outlineGeo, new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
  m.layers.set(GLOW_LAYER);
  m.renderOrder = 6;
  return m;
}

/** One glowing bead of the "open me" link between the two ends. */
const beadGeo = new CircleGeometry(0.065, 12);
export function makeBead(): Mesh {
  const m = new Mesh(beadGeo, new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, side: DoubleSide }));
  m.layers.set(GLOW_LAYER);
  m.renderOrder = 7;
  return m;
}

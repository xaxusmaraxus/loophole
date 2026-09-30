import { Group, Matrix4, Mesh } from 'three';
import { PAL, SHIRTS } from '../render/palette';
import type { AttractionId } from '../run/attractions';
import type { UpgradeId } from '../run/run';
import { type Col, Geo, shade, v3 } from './geo';
import { M, arc } from './models';
import { GLOW_LAYER, BLOOM_LAYER } from './post';
import { MATS } from './toon';
import { GLOW_MAT } from './island';

// What you've bought, standing in the park. Every attraction gets its own clay
// landmark on a lot beside the board (and bounces when it scores), every upgrade
// a prop on the plaza, every bus tour a bus. Origin of each piece: its lot's
// center on the ground, facing +z (the camera).

type P = { matte: Geo; gloss: Geo; cloth: Geo; glow: Geo };

function parts(): P {
  return { matte: new Geo(), gloss: new Geo(), cloth: new Geo(), glow: new Geo() };
}

function toGroup(p: P): Group {
  const g = new Group();
  for (const [k, mat] of [['matte', MATS.matte], ['gloss', MATS.gloss], ['cloth', MATS.cloth]] as const) {
    if (p[k].empty) continue;
    const m = new Mesh(p[k].build(), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  if (!p.glow.empty) {
    const m = new Mesh(p.glow.build(), GLOW_MAT);
    m.layers.set(GLOW_LAYER);
    m.layers.enable(BLOOM_LAYER);
    g.add(m);
  }
  return g;
}

/** A round plinth every attraction stands on, gold-rimmed when it's rare. */
function plinth(p: P, rare: boolean): void {
  p.matte.cyl(M(0, 0.02, 0), 0.24, 0.26, 0.04, '#e2dccb', 20, '#f1eadb', true);
  p.gloss.cyl(M(0, 0.042, 0), 0.245, 0.245, 0.008, rare ? PAL.gold : '#c9c2d6', 20);
}

function pennant(p: P, x: number, z: number, h: number, col: Col): void {
  p.matte.post(x, 0.04, z, 0.008, h, PAL.ink, 6);
  p.cloth.box(M(x + 0.035, 0.04 + h - 0.03, z), 0.07, 0.045, 0.006, col, 0.003);
}

export function attractionGroup(id: AttractionId, rare: boolean): Group {
  const p = parts();
  const { matte: m, gloss: gl, cloth: cl, glow } = p;
  plinth(p, rare);
  switch (id) {
    case 'loopdeloop': {
      const ring = arc(32, (t) => v3(Math.sin(t * Math.PI * 2) * 0.12, 0.2 - Math.cos(t * Math.PI * 2) * 0.14, 0));
      for (const dz of [-0.018, 0.018]) gl.pipe(ring.map((q) => q.clone().setZ(dz)), 0.012, PAL.red, 6, true);
      m.post(0, 0.04, 0, 0.012, 0.03, PAL.ink, 6);
      gl.sphere(v3(0, 0.34, 0.03), 0.025, PAL.gold, 1, 1, 1, 8, 5, true);
      break;
    }
    case 'longhaul': {
      // A signpost of far-off places.
      m.post(0, 0.04, 0, 0.018, 0.42, '#8a5a36', 7);
      ['#f0584e', '#45a8e0', '#72c457', '#ffd23f'].forEach((c, k) =>
        m.box(new Matrix4().makeRotationY(k % 2 ? 0.5 : -0.4).setPosition(k % 2 ? 0.05 : -0.05, 0.16 + k * 0.07, 0.02), 0.16, 0.045, 0.012, c, 0.006),
      );
      break;
    }
    case 'flatearth': {
      // A flat world on a stand, with an elephant-ish lump under it.
      m.post(0, 0.04, 0, 0.02, 0.2, '#8c96b8', 8);
      gl.cyl(M(0, 0.26, 0), 0.18, 0.18, 0.03, '#45a8e0', 24, '#5cc8f0');
      for (const [x, z, r] of [[-0.05, 0.02, 0.06], [0.07, -0.04, 0.05], [0.02, 0.09, 0.04]] as const) m.sphere(v3(x, 0.278, z), r, PAL.grass[1], 1, 0.2, 1, 8, 4, true);
      break;
    }
    case 'chaingang': {
      // Giant chain links.
      for (let k = 0; k < 3; k++) {
        const flip = k % 2 === 1;
        const link = arc(20, (t) => {
          const a = t * Math.PI * 2;
          return flip ? v3(0, 0.12 + k * 0.1 + Math.sin(a) * 0.06, Math.cos(a) * 0.035) : v3(Math.cos(a) * 0.035, 0.12 + k * 0.1 + Math.sin(a) * 0.06, 0);
        });
        gl.pipe(link, 0.014, '#a9adc0', 6, true);
      }
      m.post(0, 0.04, 0, 0.01, 0.04, PAL.ink, 6);
      break;
    }
    case 'collector': {
      // A shelf of little crates, one of each tier.
      m.cube(0, 0.18, -0.04, 0.34, 0.28, 0.1, '#8a5a36', 0.012);
      const cols = ['#f0584e', '#ff9a3c', '#ffd23f', '#72c457', '#45a8e0', '#9d6ef0', '#ff8fb8'];
      cols.forEach((c, k) => gl.cube(-0.12 + (k % 4) * 0.08, 0.1 + Math.floor(k / 4) * 0.12, 0.02, 0.06, 0.06, 0.06, c, 0.01));
      break;
    }
    case 'photobooth': {
      m.cube(0, 0.2, 0, 0.26, 0.34, 0.2, '#ffd23f', 0.02);
      cl.box(M(-0.04, 0.2, 0.101), 0.12, 0.26, 0.01, PAL.red, 0.004);
      m.cube(0.08, 0.3, 0.105, 0.06, 0.05, 0.02, PAL.ink, 0.006);
      glow.sphere(v3(0.08, 0.35, 0.115), 0.02, '#ffffff', 1, 1, 1, 6, 4);
      break;
    }
    case 'seasonpass': {
      // A giant ticket stub on a stand.
      m.post(0, 0.04, 0, 0.012, 0.12, PAL.ink, 6);
      m.box(new Matrix4().makeRotationZ(-0.12).setPosition(0, 0.26, 0), 0.3, 0.16, 0.02, '#ffd23f', 0.02);
      m.box(new Matrix4().makeRotationZ(-0.12).setPosition(0, 0.26, 0.011), 0.2, 0.02, 0.004, PAL.red);
      for (const sx of [-1, 1]) m.sphere(v3(sx * 0.15, 0.26 - sx * 0.02, 0), 0.025, '#e2dccb', 1, 1, 1.2, 6, 4, true);
      break;
    }
    case 'earlybird': {
      // A rooster statue under a rising sun.
      m.sphere(v3(0, 0.14, 0), 0.08, '#fbf6ec', 1, 1.05, 1.2, 10, 7, true);
      m.sphere(v3(0, 0.25, 0.05), 0.05, '#fbf6ec', 1, 1, 1, 8, 6, true);
      m.sphere(v3(0, 0.31, 0.05), 0.022, PAL.red, 0.6, 1.2, 1.4, 6, 4, true);
      m.cyl(new Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.25, 0.1), 0.015, 0, 0.04, PAL.gold, 6);
      for (let k = 0; k < 3; k++) m.sphere(v3(0, 0.18 + k * 0.03, -0.1 - k * 0.02), 0.03, ['#45a8e0', '#72c457', PAL.red][k], 0.5, 1.4, 1, 6, 4, true);
      glow.sphere(v3(0.16, 0.36, -0.12), 0.06, PAL.gold, 1, 1, 1, 10, 6);
      break;
    }
    case 'splashzone': {
      // A little fountain.
      gl.cyl(M(0, 0.06, 0), 0.2, 0.2, 0.05, '#5cc8f0', 20, '#8fdcf6');
      m.cyl(M(0, 0.065, 0), 0.21, 0.22, 0.04, '#d9dbe6', 20, undefined, true);
      gl.cyl(M(0, 0.14, 0), 0.03, 0.02, 0.16, '#b9f0ff', 8);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        gl.sphere(v3(Math.cos(a) * 0.09, 0.2 - (k % 2) * 0.04, Math.sin(a) * 0.09), 0.02, '#b9f0ff', 1, 1.3, 1, 6, 4, true);
      }
      break;
    }
    case 'corndogcart': {
      m.cube(0, 0.12, 0, 0.26, 0.12, 0.16, PAL.red, 0.02, '#ff8a80');
      for (const sx of [-1, 1]) m.cyl(new Matrix4().makeRotationZ(Math.PI / 2).setPosition(sx * 0.1, 0.06, 0.09), 0.035, 0.035, 0.02, PAL.ink, 10);
      m.post(0, 0.18, 0, 0.008, 0.18, PAL.ink, 6);
      cl.cyl(M(0, 0.38, 0), 0.2, 0.0, 0.06, PAL.gold, 12);
      m.beam(v3(0.02, 0.18, 0.05), v3(0.02, 0.24, 0.05), 0.01, '#e8d9b0');
      gl.cyl(M(0.02, 0.29, 0.05), 0.03, 0.028, 0.1, '#e0962a', 8);
      break;
    }
    case 'tilttable': {
      m.post(0, 0.04, 0, 0.02, 0.14, '#8c96b8', 8);
      gl.box(new Matrix4().makeRotationX(0.45).multiply(new Matrix4().makeRotationZ(0.2)).setPosition(0, 0.22, 0), 0.34, 0.03, 0.22, '#9d6ef0', 0.012);
      for (const [x, z] of [[-0.08, 0.02], [0.06, -0.04], [0.02, 0.06]] as const) gl.sphere(v3(x, 0.26 + z * 0.4, z), 0.02, '#e7e9f2', 1, 1, 1, 8, 5, true);
      break;
    }
    case 'crowdpleaser': {
      // A little stage with a spotlight and a mic.
      m.cube(0, 0.08, 0, 0.36, 0.08, 0.26, '#8a5a36', 0.012, '#a8784a');
      cl.box(M(0, 0.26, -0.12), 0.36, 0.28, 0.012, PAL.red, 0.004);
      m.post(0.04, 0.12, 0.04, 0.006, 0.14, PAL.ink, 6);
      gl.sphere(v3(0.04, 0.27, 0.04), 0.018, '#8c96b8', 1, 1.2, 1, 6, 4, true);
      glow.sphere(v3(-0.12, 0.42, 0.02), 0.03, '#fff1b0', 1, 1, 1, 6, 4);
      break;
    }
    case 'quicktrip': {
      // A giant stopwatch.
      gl.cyl(new Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.24, 0), 0.15, 0.15, 0.05, '#e7e9f2', 24, '#fbf6ec');
      m.beam(v3(0, 0.24, 0.03), v3(0.06, 0.3, 0.03), 0.012, PAL.red);
      gl.cyl(M(0, 0.4, 0), 0.02, 0.02, 0.04, '#a9adc0', 8);
      m.post(0, 0.04, 0, 0.012, 0.06, PAL.ink, 6);
      break;
    }
    case 'adrenaline': {
      // A mini drop tower.
      m.post(0, 0.04, -0.04, 0.03, 0.5, '#e7e9f2', 8);
      gl.cyl(M(0, 0.28, -0.04), 0.07, 0.07, 0.05, PAL.red, 12);
      gl.cyl(M(0, 0.56, -0.04), 0.0, 0.04, 0.05, PAL.gold, 8);
      glow.sphere(v3(0, 0.6, -0.04), 0.02, PAL.red, 1, 1, 1, 6, 4);
      break;
    }
    case 'twilight': {
      // A crescent moon lamp with stars.
      m.post(0, 0.04, 0, 0.01, 0.2, PAL.ink, 6);
      glow.sphere(v3(0, 0.34, 0), 0.1, '#f3efd6', 1, 1, 0.6, 14, 9);
      m.sphere(v3(0.05, 0.36, 0.02), 0.09, '#2b3a6e', 1, 1, 0.7, 12, 8, true);
      for (const [x, y] of [[-0.15, 0.4], [0.14, 0.2], [-0.1, 0.18]] as const) glow.sphere(v3(x, y, 0.02), 0.018, PAL.gold, 1, 1, 1, 6, 4);
      break;
    }
  }
  pennant(p, 0.2, 0.12, 0.3, rare ? PAL.gold : SHIRTS[(id.length * 3) % SHIRTS.length]);
  return toGroup(p);
}

export function upgradeGroup(id: UpgradeId, count: number): Group {
  const p = parts();
  const { matte: m, gloss: gl, cloth: cl, glow } = p;
  switch (id) {
    case 'latenight': {
      // A clock tower with a lit face.
      m.cube(0, 0.22, 0, 0.14, 0.44, 0.14, '#b98552', 0.02);
      m.cyl(M(0, 0.5, 0), 0.12, 0, 0.12, PAL.red, 4);
      glow.cyl(new Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.36, 0.072), 0.05, 0.05, 0.01, '#fff1b0', 16);
      m.beam(v3(0, 0.36, 0.08), v3(0, 0.395, 0.08), 0.008, PAL.ink);
      m.beam(v3(0, 0.36, 0.08), v3(0.025, 0.36, 0.08), 0.008, PAL.ink);
      break;
    }
    case 'lumber': {
      for (let k = 0; k < 6; k++) m.cyl(new Matrix4().makeRotationZ(Math.PI / 2).setPosition(0, 0.04 + Math.floor(k / 3) * 0.07, -0.07 + (k % 3) * 0.07 + (k >= 3 ? 0.035 : 0)), 0.035, 0.035, 0.3, '#a8784a', 8, '#e8c28c');
      break;
    }
    case 'hype': {
      // A hype guy on a crate with a megaphone.
      m.cube(0, 0.06, 0, 0.16, 0.12, 0.16, '#b98552', 0.012);
      m.sphere(v3(0, 0.2, 0), 0.05, '#45a8e0', 1, 1.2, 0.9, 8, 6, true);
      m.sphere(v3(0, 0.29, 0), 0.045, '#eab893', 1, 1, 1, 8, 6, true);
      gl.cyl(new Matrix4().makeRotationX(-1.2).setPosition(0.06, 0.3, 0.06), 0.012, 0.04, 0.08, PAL.red, 8);
      break;
    }
    case 'fries': {
      m.cube(0, 0.12, 0, 0.22, 0.24, 0.14, '#fbf6ec', 0.02);
      cl.box(M(0, 0.28, 0.05), 0.26, 0.04, 0.1, PAL.red, 0.01);
      gl.cyl(M(0, 0.36, 0), 0.06, 0.045, 0.08, PAL.red, 8);
      for (let k = 0; k < 6; k++) m.box(M(-0.03 + (k % 3) * 0.03, 0.42 + (k % 2) * 0.02, -0.01 + Math.floor(k / 3) * 0.02), 0.012, 0.08, 0.012, PAL.gold);
      break;
    }
    case 'billboard': {
      for (const sx of [-1, 1]) m.post(sx * 0.14, 0, 0, 0.012, 0.28, PAL.ink, 6);
      m.box(M(0, 0.36, 0), 0.4, 0.2, 0.02, '#fbf6ec', 0.01);
      m.box(M(0, 0.36, 0.011), 0.36, 0.16, 0.004, PAL.red);
      m.box(M(-0.06, 0.38, 0.015), 0.14, 0.03, 0.004, PAL.gold);
      m.box(M(0.05, 0.33, 0.015), 0.18, 0.02, 0.004, '#fbf6ec');
      break;
    }
    case 'landscaper': {
      // A topiary in a pot.
      m.cyl(M(0, 0.06, 0), 0.07, 0.09, 0.12, '#c96b3a', 10);
      m.sphere(v3(0, 0.2, 0), 0.08, PAL.leaf[1], 1, 1, 1, 10, 7, true);
      m.sphere(v3(0, 0.33, 0), 0.055, PAL.leaf[1], 1, 1, 1, 10, 7, true);
      break;
    }
    case 'scenic': {
      // A coin telescope on a post.
      m.post(0, 0, 0, 0.015, 0.18, '#8c96b8', 8);
      gl.cyl(new Matrix4().makeRotationX(1.2).setPosition(0, 0.24, 0), 0.035, 0.045, 0.14, '#45a8e0', 10);
      break;
    }
    case 'wrench': {
      // A tool shed.
      m.cube(0, 0.12, 0, 0.24, 0.24, 0.2, PAL.red, 0.015);
      m.box(new Matrix4().makeRotationZ(0.5).setPosition(-0.06, 0.28, 0), 0.16, 0.02, 0.24, '#6e6886', 0.006);
      m.box(new Matrix4().makeRotationZ(-0.5).setPosition(0.06, 0.28, 0), 0.16, 0.02, 0.24, '#6e6886', 0.006);
      m.cube(0, 0.1, 0.101, 0.08, 0.16, 0.01, '#fbf6ec', 0.004);
      break;
    }
  }
  // Doubled up: a little gold star for each extra copy.
  for (let k = 1; k < Math.min(count, 4); k++) gl.sphere(v3(-0.12 + k * 0.06, 0.02, 0.14), 0.02, PAL.gold, 1, 0.6, 1, 6, 4, true);
  return toGroup(p);
}

/** A tour bus, painted in its passengers' colour. */
export function busGroup(color: Col): Group {
  const p = parts();
  const { matte: m, gloss: gl } = p;
  m.cube(0, 0.13, 0, 0.62, 0.18, 0.22, color, 0.04, shade(color, 0.15));
  m.cube(0, 0.24, 0, 0.58, 0.04, 0.2, '#fbf6ec', 0.02);
  for (let k = 0; k < 5; k++) gl.cube(-0.22 + k * 0.11, 0.17, 0.111, 0.08, 0.06, 0.004, '#b9f0ff', 0.004);
  gl.cube(0.3, 0.16, 0, 0.02, 0.08, 0.18, '#b9f0ff', 0.004);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.cyl(new Matrix4().makeRotationX(Math.PI / 2).setPosition(sx * 0.2, 0.045, sz * 0.1), 0.045, 0.045, 0.03, PAL.ink, 10, '#8c96b8');
  m.cube(0, 0.29, 0, 0.3, 0.04, 0.12, '#8a5a36', 0.01);
  return toGroup(p);
}

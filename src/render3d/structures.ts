import { Group, Matrix4, Mesh, type Object3D, type Vector3 } from 'three';
import { PAL, SHIRTS } from '../render/palette';
import type { AttractionId, Rarity } from '../run/attractions';
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

/** A round plinth every attraction stands on: gold-rimmed when it's rare, a
 *  gold tiered stage ringed with marquee bulbs when it's legendary. */
function plinth(p: P, rarity: Rarity): void {
  if (rarity === 'legendary') {
    p.matte.cyl(M(0, 0.02, 0), 0.25, 0.27, 0.04, '#e9c46a', 24, '#f6dc8c', true);
    p.gloss.cyl(M(0, 0.045, 0), 0.255, 0.255, 0.012, PAL.gold, 24);
    p.matte.cyl(M(0, 0.06, 0), 0.2, 0.21, 0.03, '#fbf0d2', 24, '#fff6e0', true);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      p.glow.sphere(v3(Math.cos(a) * 0.245, 0.03, Math.sin(a) * 0.245), 0.012, k % 2 ? '#fff1b0' : '#ff9a3c', 1, 1, 1, 6, 4);
    }
    return;
  }
  p.matte.cyl(M(0, 0.02, 0), 0.24, 0.26, 0.04, '#e2dccb', 20, '#f1eadb', true);
  p.gloss.cyl(M(0, 0.042, 0), 0.245, 0.245, 0.008, rarity === 'rare' ? PAL.gold : '#c9c2d6', 20);
}

/** Legendaries stand this much bigger than a common (baked into their group). */
const LEGEND_SCALE = 1.5;

/** A front-facing (+z) pie wedge, for wheels of fortune. */
function wedge(g: Geo, c: Vector3, r: number, a0: number, a1: number, col: Col): void {
  const a = v3(c.x + Math.cos(a0) * r, c.y + Math.sin(a0) * r, c.z);
  const b = v3(c.x + Math.cos(a1) * r, c.y + Math.sin(a1) * r, c.z);
  g.tri(c, a, b, col, c.clone().setZ(c.z - 1));
}

function pennant(p: P, x: number, z: number, h: number, col: Col): void {
  p.matte.post(x, 0.04, z, 0.008, h, PAL.ink, 6);
  p.cloth.box(M(x + 0.035, 0.04 + h - 0.03, z), 0.07, 0.045, 0.006, col, 0.003);
}

/** A separately built (and animated) piece of an attraction. */
function sub(build: (p: P) => void): Group {
  const p = parts();
  build(p);
  return toGroup(p);
}

const circle = (r: number, y: number, z = 0, segs = 28, vertical = false) =>
  arc(segs, (t) => {
    const a = t * Math.PI * 2;
    return vertical ? v3(Math.cos(a) * r, y + Math.sin(a) * r, z) : v3(Math.cos(a) * r, y, Math.sin(a) * r);
  });

export function attractionGroup(id: AttractionId, rarity: Rarity): Group {
  const p = parts();
  const { matte: m, gloss: gl, cloth: cl, glow } = p;
  plinth(p, rarity);
  // Moving bits: sub-groups added on top, driven every frame by `anims` (seconds).
  const extra: Object3D[] = [];
  const anims: ((t: number) => void)[] = [];
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
    case 'funnelcake': {
      // A candy-pink stand under a striped awning, a giant funnel cake on top.
      m.cube(0, 0.11, 0, 0.3, 0.14, 0.18, '#ff8fb8', 0.02, '#ffb0cc');
      m.cube(0, 0.19, 0.01, 0.33, 0.025, 0.21, PAL.white, 0.008);
      cl.box(M(0, 0.11, 0.092), 0.18, 0.06, 0.006, PAL.white, 0.003);
      for (let k = 0; k < 3; k++) gl.sphere(v3(-0.05 + k * 0.05, 0.11, 0.097), 0.012, ['#e8a94a', PAL.red, '#e8a94a'][k], 1, 1, 0.5, 6, 4, true);
      for (const sx of [-1, 1]) m.post(sx * 0.14, 0.2, -0.07, 0.008, 0.15, PAL.ink, 6);
      for (let k = 0; k < 6; k++) cl.box(new Matrix4().makeRotationX(0.35).setPosition(-0.15 + k * 0.06 + 0.03, 0.37, 0.01), 0.06, 0.012, 0.25, k % 2 ? PAL.white : '#ff6f9f', 0.004);
      for (let k = 0; k < 6; k++) cl.sphere(v3(-0.15 + k * 0.06 + 0.03, 0.325, 0.13), 0.03, k % 2 ? PAL.white : '#ff6f9f', 1, 0.6, 0.35, 8, 4, true);
      // The cake: a fried squiggle with a powdered-sugar dusting and a strawberry.
      gl.cyl(M(0, 0.43, 0), 0.12, 0.1, 0.015, PAL.white, 18);
      gl.pipe(arc(70, (t) => { const a = t * Math.PI * 2; const r = 0.075 + 0.025 * Math.cos(a * 7); return v3(Math.cos(a) * r, 0.452 + 0.006 * Math.sin(a * 5), Math.sin(a) * r); }), 0.015, '#e8a94a', 6, true);
      gl.pipe(arc(40, (t) => { const a = t * Math.PI * 2; const r = 0.032 + 0.014 * Math.cos(a * 5); return v3(Math.cos(a) * r, 0.458, Math.sin(a) * r); }), 0.014, '#d98f34', 6, true);
      for (let k = 0; k < 11; k++) {
        const a = k * 2.4;
        const r = 0.02 + (k % 4) * 0.025;
        m.sphere(v3(Math.cos(a) * r, 0.472, Math.sin(a) * r), 0.009, PAL.white, 1, 0.6, 1, 5, 3);
      }
      gl.sphere(v3(0, 0.485, 0.01), 0.025, PAL.red, 1, 1.1, 1, 8, 5, true);
      m.sphere(v3(0, 0.51, 0.01), 0.012, PAL.leaf[1], 1.4, 0.5, 1.4, 6, 3);
      break;
    }
    case 'ferris': {
      // A ferris wheel whose hub is a wheel of fortune; gondolas stay level as it turns.
      const H = 0.32;
      const R = 0.18;
      for (const z of [-0.075, 0.075]) {
        for (const sx of [-1, 1]) m.beam(v3(sx * 0.15, 0.07, z), v3(0, H, z), 0.022, '#e7e9f2');
        m.beam(v3(-0.085, 0.17, z), v3(0.085, 0.17, z), 0.014, '#e7e9f2');
      }
      m.cyl(new Matrix4().makeRotationX(Math.PI / 2).setPosition(0, H, 0), 0.016, 0.016, 0.17, '#a9adc0', 8);
      m.cube(0, 0.09, 0.13, 0.12, 0.03, 0.06, '#c96b3a', 0.01, '#e8a070');
      const wheel = sub((w) => {
        for (const dz of [-0.04, 0.04]) {
          w.gloss.pipe(circle(R, 0, dz, 36, true), 0.009, PAL.red, 6, true);
          w.gloss.pipe(circle(R * 0.55, 0, dz, 24, true), 0.006, PAL.white, 6, true);
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            w.matte.beam(v3(0, 0, dz), v3(Math.cos(a) * R, Math.sin(a) * R, dz), 0.006, PAL.white);
          }
        }
        for (let k = 0; k < 16; k++) {
          const a = ((k + 0.5) / 16) * Math.PI * 2;
          w.glow.sphere(v3(Math.cos(a) * R, Math.sin(a) * R, 0.05), 0.008, k % 2 ? '#fff1b0' : '#ff9a3c', 1, 1, 1, 5, 3);
        }
        // Fortune hub: eight painted wedges and a gold rim.
        const hub = v3(0, 0, 0.055);
        for (let k = 0; k < 8; k++) wedge(w.matte, hub, 0.08, (k / 8) * Math.PI * 2, ((k + 1) / 8) * Math.PI * 2, [PAL.red, PAL.white, '#45a8e0', PAL.gold, '#72c457', PAL.white, '#9d6ef0', '#ff9a3c'][k]);
        w.gloss.pipe(circle(0.08, 0, 0.056, 24, true), 0.01, PAL.gold, 6, true);
        w.gloss.sphere(v3(0, 0, 0.06), 0.018, PAL.gold, 1, 1, 0.7, 8, 5, true);
      });
      wheel.position.set(0, H, 0);
      const gondolas: Group[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const col = SHIRTS[k % 8];
        const gd = sub((q) => {
          q.matte.beam(v3(0, 0, 0), v3(0, -0.03, 0), 0.006, PAL.ink);
          q.matte.cube(0, -0.05, 0, 0.055, 0.042, 0.06, col, 0.01, shade(col, 0.15));
          q.gloss.cyl(M(0, -0.022, 0), 0.042, 0.012, 0.022, PAL.white, 8);
        });
        gd.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
        gondolas.push(gd);
        wheel.add(gd);
      }
      extra.push(wheel);
      anims.push((t) => {
        wheel.rotation.z = t * 0.35;
        for (const gd of gondolas) gd.rotation.z = -wheel.rotation.z;
      });
      break;
    }
    case 'mirrors': {
      // A funhouse facade: warped mirrors either side of the door, a jester on top.
      m.cube(0, 0.21, -0.05, 0.44, 0.3, 0.12, '#9d6ef0', 0.015, '#b48cf5');
      gl.cube(0, 0.075, 0.015, 0.46, 0.02, 0.02, PAL.gold, 0.006);
      gl.cube(0, 0.35, 0.015, 0.46, 0.02, 0.02, PAL.gold, 0.006);
      for (let k = 0; k < 8; k++) m.sphere(v3(-0.21 + k * 0.06, 0.37, -0.05), 0.034, k % 2 ? PAL.gold : '#ff8fb8', 1, 0.9, 1.4, 8, 5, true);
      [[-0.165, 1.35], [-0.09, 0.7], [0.09, 1.2], [0.165, 0.75]].forEach(([x, sx]) => {
        m.box(M(x, 0.21, 0.012), 0.065, 0.2, 0.012, PAL.gold, 0.005);
        gl.sphere(v3(x, 0.21, 0.02), 0.026, '#d6f1ff', sx, 3.3, 0.25, 10, 7, true);
        glow.sphere(v3(x - 0.008, 0.25, 0.028), 0.006, '#ffffff', 1, 2.5, 0.5, 5, 3);
      });
      // The door, with a curtain of stripes.
      m.cube(0, 0.15, 0.012, 0.075, 0.13, 0.012, PAL.ink, 0.006);
      for (let k = 0; k < 3; k++) cl.box(M(-0.022 + k * 0.022, 0.15, 0.02), 0.02, 0.11, 0.004, k % 2 ? PAL.gold : PAL.red, 0.002);
      // The jester: a big grinning face that rocks from side to side.
      const face = sub((q) => {
        q.matte.sphere(v3(0, 0, 0), 0.07, PAL.white, 1, 1, 0.7, 12, 8, true);
        for (const sx of [-1, 1]) {
          q.matte.sphere(v3(sx * 0.025, 0.018, 0.045), 0.011, PAL.ink, 1, 1.3, 0.6, 6, 4, true);
          q.matte.sphere(v3(sx * 0.04, -0.012, 0.042), 0.013, '#ff8fb8', 1, 0.7, 0.4, 6, 4, true);
          q.matte.cyl(new Matrix4().makeRotationZ(-sx * 0.75).setPosition(sx * 0.06, 0.07, 0), 0.032, 0, 0.11, sx < 0 ? PAL.red : '#45a8e0', 8);
          q.gloss.sphere(v3(sx * 0.1, 0.105, 0), 0.016, PAL.gold, 1, 1, 1, 6, 4, true);
        }
        q.gloss.sphere(v3(0, 0, 0.055), 0.016, PAL.red, 1, 1, 1, 8, 5, true);
        q.matte.pipe(arc(10, (t) => v3(-0.03 + t * 0.06, -0.025 - Math.sin(t * Math.PI) * 0.016, 0.047)), 0.006, PAL.red, 5);
        // Ruff collar.
        for (let k = 0; k < 7; k++) q.cloth.sphere(v3(-0.06 + k * 0.02, -0.068, 0.01), 0.018, k % 2 ? PAL.white : '#9d6ef0', 1, 0.8, 1, 6, 4, true);
      });
      face.position.set(0, 0.43, 0.0);
      extra.push(face);
      anims.push((t) => (face.rotation.z = Math.sin(t * 1.6) * 0.16));
      break;
    }
    case 'gravitywell': {
      // A violet funnel sucking everything into a swirl, little planets in orbit above.
      m.cyl(M(0, 0.09, 0), 0.08, 0.1, 0.06, '#4d5170', 12, '#6e6886');
      for (let k = 0; k < 5; k++) {
        const top = k === 4;
        m.cyl(M(0, 0.15 + k * 0.05, 0), 0.03 + k * 0.032, 0.03 + (k + 1) * 0.032, 0.05, k % 2 ? '#9d6ef0' : '#5b3fa8', 20, top ? '#2b2140' : undefined, true);
        gl.pipe(circle(0.03 + (k + 1) * 0.032, 0.175 + k * 0.05, 0, 24), 0.006, PAL.gold, 5, true);
      }
      const yTop = 0.375;
      const swirl = sub((q) => {
        for (let arm = 0; arm < 3; arm++) {
          const pts = arc(18, (t) => {
            const a = (arm * Math.PI * 2) / 3 + t * 3.6;
            const r = 0.015 + t * 0.15;
            return v3(Math.cos(a) * r, 0, Math.sin(a) * r);
          });
          q.glow.pipe(pts, 0.009, arm === 1 ? '#5cc8f0' : '#c9a6ff', 5);
        }
        q.glow.sphere(v3(0, 0, 0), 0.022, '#fbf6ec', 1, 0.5, 1, 8, 4);
      });
      swirl.position.set(0, yTop, 0);
      extra.push(swirl);
      const orbit = sub((q) => {
        q.gloss.sphere(v3(0.2, 0.02, 0), 0.028, '#ff9a3c', 1, 1, 1, 8, 6, true);
        q.gloss.pipe(circle(0.04, 0.02, 0, 16).map((v) => v.add(v3(0.2, 0, 0))), 0.004, PAL.gold, 4, true);
        q.gloss.sphere(v3(-0.1, -0.03, 0.17), 0.02, '#45a8e0', 1, 1, 1, 8, 6, true);
        q.gloss.sphere(v3(-0.1, 0.05, -0.17), 0.016, '#72c457', 1, 1, 1, 8, 6, true);
      });
      orbit.position.set(0, 0.5, 0);
      extra.push(orbit);
      // The singularity itself, hovering over the swirl.
      glow.sphere(v3(0, 0.5, 0), 0.035, '#c9a6ff', 1, 1, 1, 10, 7);
      gl.pipe(circle(0.06, 0, 0, 24).map((v) => v.applyMatrix4(new Matrix4().makeRotationX(0.5)).add(v3(0, 0.5, 0))), 0.006, PAL.gold, 5, true);
      anims.push((t) => {
        swirl.rotation.y = -t * 1.8;
        orbit.rotation.y = t * 0.8;
      });
      break;
    }
    case 'buffet': {
      // A striped food pavilion with a turning turkey dinner on the roof.
      m.cube(0, 0.155, 0, 0.36, 0.2, 0.22, PAL.white, 0.012);
      for (let k = 0; k < 9; k++) if (k % 2 === 0) cl.box(M(-0.16 + k * 0.04, 0.155, 0.111), 0.04, 0.2, 0.004, PAL.red);
      for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) if (k % 2 === 0) cl.box(M(sx * 0.181, 0.155, -0.09 + k * 0.045), 0.004, 0.2, 0.045, PAL.red);
      // Serving window with a counter of dishes.
      m.cube(0, 0.18, 0.114, 0.24, 0.08, 0.006, '#6e2a2a', 0.003);
      gl.cube(0, 0.14, 0.13, 0.28, 0.018, 0.05, PAL.gold, 0.006);
      ['#ffd23f', '#72c457', '#ff8fb8', '#ff9a3c'].forEach((c, k) => {
        gl.cyl(M(-0.09 + k * 0.06, 0.153, 0.13), 0.022, 0.018, 0.008, PAL.white, 10);
        m.sphere(v3(-0.09 + k * 0.06, 0.162, 0.13), 0.016, c, 1, 0.6, 1, 6, 4, true);
      });
      // Roof with a scalloped edge.
      m.cube(0, 0.27, 0, 0.42, 0.03, 0.27, PAL.red, 0.01, '#ff8a80');
      gl.cube(0, 0.288, 0, 0.4, 0.008, 0.25, PAL.gold, 0.004);
      for (let k = 0; k < 9; k++) cl.sphere(v3(-0.2 + k * 0.05, 0.25, 0.135), 0.026, k % 2 ? PAL.white : PAL.red, 1, 0.8, 0.4, 8, 4, true);
      m.post(0, 0.29, 0, 0.02, 0.04, PAL.gold, 8);
      const dinner = sub((q) => {
        q.gloss.cyl(M(0, 0, 0), 0.15, 0.12, 0.02, PAL.white, 22, '#ffffff');
        q.gloss.pipe(circle(0.135, 0.012, 0, 28), 0.006, '#45a8e0', 5, true);
        q.matte.sphere(v3(0, 0.055, 0), 0.08, '#c0703a', 1.15, 0.75, 0.9, 12, 8, true);
        q.matte.sphere(v3(-0.01, 0.09, 0.0), 0.05, '#d98a4a', 1.2, 0.5, 0.8, 8, 5, true);
        for (const sx of [-1, 1]) {
          q.matte.beam(v3(sx * 0.06, 0.05, 0.04), v3(sx * 0.1, 0.1, 0.07), 0.035, '#b0602e', 0.03);
          q.matte.sphere(v3(sx * 0.105, 0.11, 0.075), 0.011, PAL.white, 1, 1, 1, 6, 4, true);
          q.matte.sphere(v3(sx * 0.115, 0.1, 0.08), 0.011, PAL.white, 1, 1, 1, 6, 4, true);
        }
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + 0.3;
          q.matte.sphere(v3(Math.cos(a) * 0.115, 0.022, Math.sin(a) * 0.115), k % 2 ? 0.02 : 0.016, k % 2 ? PAL.leaf[1] : PAL.red, 1, 0.7, 1, 6, 4, true);
        }
      });
      dinner.position.set(0, 0.335, 0);
      extra.push(dinner);
      anims.push((t) => (dinner.rotation.y = Math.sin(t * 0.6) * 0.6));
      break;
    }
    case 'fountain': {
      // A three-tier fountain, brimming and spouting green goo.
      const goo = '#8ee04a';
      m.cyl(M(0, 0.09, 0), 0.22, 0.23, 0.08, '#d9dbe6', 24, undefined, true);
      gl.pipe(circle(0.215, 0.13, 0, 32), 0.012, PAL.gold, 6, true);
      gl.cyl(M(0, 0.12, 0), 0.2, 0.2, 0.02, goo, 24, '#a6e05a');
      m.post(0, 0.12, 0, 0.045, 0.14, '#c9c2d6', 10, 0.03);
      m.cyl(M(0, 0.27, 0), 0.05, 0.13, 0.045, '#d9dbe6', 18, undefined, true);
      gl.cyl(M(0, 0.29, 0), 0.12, 0.12, 0.012, goo, 18, '#a6e05a');
      gl.pipe(circle(0.128, 0.292, 0, 24), 0.008, PAL.gold, 5, true);
      m.post(0, 0.29, 0, 0.026, 0.09, '#c9c2d6', 8, 0.02);
      m.cyl(M(0, 0.39, 0), 0.025, 0.07, 0.03, '#d9dbe6', 14, undefined, true);
      gl.cyl(M(0, 0.403, 0), 0.062, 0.062, 0.008, goo, 14, '#a6e05a');
      // Goo dribbling over each lip.
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.2;
        gl.sphere(v3(Math.cos(a) * 0.13, 0.255 - (k % 3) * 0.015, Math.sin(a) * 0.13), 0.016, goo, 1, 2.2 + (k % 3) * 0.6, 1, 6, 4, true);
        if (k % 2 === 0) gl.sphere(v3(Math.cos(a + 0.4) * 0.072, 0.37, Math.sin(a + 0.4) * 0.072), 0.011, goo, 1, 2.2, 1, 6, 4, true);
      }
      // The plume, which gushes.
      const plume = sub((q) => {
        q.gloss.cyl(M(0, 0.06, 0), 0.028, 0.018, 0.12, goo, 10, undefined, true);
        q.gloss.sphere(v3(0, 0.13, 0), 0.04, goo, 1, 0.8, 1, 10, 6, true);
        q.glow.sphere(v3(0, 0.15, 0), 0.02, '#d8ff9a', 1, 1, 1, 6, 4);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const pts = arc(6, (t) => v3(Math.cos(a) * (0.02 + t * 0.07), 0.13 + Math.sin(t * Math.PI * 0.8) * 0.04 - t * t * 0.06, Math.sin(a) * (0.02 + t * 0.07)));
          q.gloss.pipe(pts, 0.009, goo, 5);
          q.gloss.sphere(pts[pts.length - 1], 0.014, goo, 1, 1.2, 1, 6, 4, true);
        }
      });
      plume.position.set(0, 0.405, 0);
      extra.push(plume);
      anims.push((t) => {
        const k = Math.sin(t * 4);
        plume.scale.set(1 - k * 0.06, 1 + k * 0.14, 1 - k * 0.06);
      });
      break;
    }
    case 'thunder': {
      // A craggy red-rock mountain, a wooden coaster spiralling up it, a storm on top.
      m.blob(v3(0, 0.07, 0), 0.19, '#c9774a', 3, 0.2, 1.05, 0.35, 0.95);
      m.cyl(M(0, 0.24, -0.03), 0.16, 0.025, 0.36, '#d0784a', 7, '#f3efe6');
      m.cyl(M(-0.1, 0.14, 0.04), 0.08, 0.018, 0.2, '#e08a54', 6, '#f3efe6');
      m.cyl(M(0.1, 0.13, 0.03), 0.075, 0.015, 0.17, '#b8653d', 6);
      // Snowy tip and pale strata.
      m.cyl(M(0, 0.405, -0.03), 0.045, 0.012, 0.05, '#f3efe6', 7);
      for (const [y, r] of [[0.16, 0.13], [0.27, 0.088]] as const) m.cyl(M(0, y, -0.03), r + 0.004, r - 0.002, 0.016, '#ecb27c', 7);
      for (const [x, z, r] of [[0.15, 0.1, 0.05], [-0.16, 0.08, 0.04], [0.1, -0.15, 0.045]] as const) m.blob(v3(x, 0.07, z), r, '#d98a5a', Math.round(x * 100), 0.3);
      for (const [x, y, z] of [[-0.05, 0.3, 0.1], [0.08, 0.2, 0.15]] as const) m.sphere(v3(x, y, z), 0.022, PAL.leaf[2], 1, 1.2, 1, 6, 4, true);
      const helix = (u: number) => {
        const a = 0.6 + u * Math.PI * 2 * 1.5;
        const r = 0.215 - u * 0.075;
        return { a, p: v3(Math.cos(a) * r, 0.07 + u * 0.27, Math.sin(a) * r) };
      };
      for (const side of [-1, 1]) {
        gl.pipe(arc(48, (u) => { const { a, p: q } = helix(u); return q.add(v3(Math.cos(a) * side * 0.014, 0, Math.sin(a) * side * 0.014)); }), 0.006, PAL.red, 5);
      }
      for (let k = 0; k <= 16; k++) {
        const { p: q } = helix(k / 16);
        m.beam(v3(q.x, 0.04, q.z), v3(q.x, q.y - 0.006, q.z), 0.01, '#8a5a36');
        if (k % 2 === 0) m.beam(v3(q.x, q.y - 0.007, q.z).multiplyScalar(1), v3(q.x * 0.9, q.y - 0.007, q.z * 0.9), 0.008, '#5b3f2e');
      }
      const car = sub((q) => {
        q.gloss.cube(0, 0.022, 0, 0.06, 0.03, 0.035, PAL.gold, 0.01);
        q.matte.sphere(v3(0.005, 0.045, 0), 0.012, '#eab893', 1, 1, 1, 6, 4, true);
        q.matte.sphere(v3(-0.02, 0.045, 0), 0.012, '#c98d63', 1, 1, 1, 6, 4, true);
      });
      extra.push(car);
      anims.push((t) => {
        const u = 0.5 - 0.5 * Math.cos(t * 0.7);
        const { a, p: q } = helix(u);
        car.position.copy(q);
        car.rotation.y = -a - Math.PI / 2;
      });
      // Storm cloud and a lightning bolt that flickers.
      for (const [x, y, z, r] of [[-0.05, 0.6, 0, 0.05], [0.03, 0.62, 0, 0.06], [0.1, 0.59, 0.01, 0.042], [0.02, 0.575, 0.03, 0.05]] as const) m.sphere(v3(x, y, z), r, '#6e6886', 1, 0.8, 0.9, 10, 6, true);
      const bolt = sub((q) => {
        const zig = [v3(0.03, 0.56, 0.04), v3(-0.02, 0.5, 0.05), v3(0.025, 0.49, 0.05), v3(-0.015, 0.42, 0.04)];
        for (let k = 0; k < zig.length - 1; k++) q.glow.beam(zig[k], zig[k + 1], 0.022, PAL.gold, 0.012);
      });
      extra.push(bolt);
      anims.push((t) => {
        const f = t % 2.8;
        bolt.visible = !(f < 0.08 || (f > 0.16 && f < 0.22));
      });
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
  if (rarity === 'legendary') {
    for (const sx of [-1, 1]) pennant(p, sx * 0.2, -0.13, 0.42, sx < 0 ? PAL.red : PAL.gold);
  } else pennant(p, 0.2, 0.12, 0.3, rarity === 'rare' ? PAL.gold : SHIRTS[(id.length * 3) % SHIRTS.length]);
  const body = toGroup(p);
  for (const o of extra) body.add(o);
  if (anims.length) {
    // The plinth is always drawn when the landmark is, so it drives the clockwork.
    (body.children[0] as Mesh).onBeforeRender = () => {
      const t = performance.now() / 1000;
      for (const f of anims) f(t);
    };
  }
  if (rarity !== 'legendary') return body;
  // Legendaries stand half again as big (the renderer owns the outer group's scale for its bounce).
  const outer = new Group();
  body.scale.setScalar(LEGEND_SCALE);
  outer.add(body);
  return outer;
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

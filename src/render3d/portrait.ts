import { AmbientLight, DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Look } from '../riders/riders';
import { personGeo } from './models';
import { MATS } from './toon';

// Rider cards get a little 3D portrait of the same chibi model that stands in
// the queue, rendered once per look into the card's canvas.

const W = 66;
const H = 84;
let gl: WebGLRenderer | null = null;
let failed = false;
const scene = new Scene();
const cam = new PerspectiveCamera(26, W / H, 0.05, 20);
const rig = new Group();

function setup(): WebGLRenderer | null {
  if (gl || failed) return gl;
  try {
    const c = document.createElement('canvas');
    gl = new WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
    gl.setPixelRatio(1);
    gl.setSize(W, H, false);
    gl.setClearColor(0x000000, 0);
    const sun = new DirectionalLight('#fff2dc', 2.4);
    sun.position.set(-1, 2, 3);
    scene.add(sun, new HemisphereLight('#cfe0ff', '#c2a07a', 1.9), new AmbientLight('#ffffff', 0.1), rig);
  } catch {
    failed = true;
    gl = null;
  }
  return gl;
}

/** Draws the look into a 2D canvas; returns false if WebGL is unavailable. */
export function drawPortrait3D(target: HTMLCanvasElement, look: Look): boolean {
  const r = setup();
  if (!r) return false;
  rig.clear();
  const g = personGeo({ ...look, big: false, accessory: look.accessory === 'balloon' ? 'none' : look.accessory }, 'smile');
  const body = new Mesh(g.body, MATS.figure);
  rig.add(body);
  for (const sx of [-1, 1]) {
    const arm = new Mesh(g.arm, MATS.figure);
    arm.position.set(sx * g.shoulderX, g.shoulderY, 0);
    arm.rotation.z = sx * 0.2;
    rig.add(arm);
  }
  rig.rotation.y = -0.3;
  const top = g.headY;
  cam.position.set(0, top * 0.82, 1.05);
  cam.lookAt(0, top * 0.66, 0);
  r.render(scene, cam);
  target.width = W;
  target.height = H;
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(r.domElement, 0, 0);
  return true;
}

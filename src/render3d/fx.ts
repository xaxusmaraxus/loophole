import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { Geo, rng, v3 } from './geo';
import { BLOOM_LAYER, GLOW_LAYER } from './post';
import { MATS, toon } from './toon';

// Effects: voxel particles (sparkles, dust, confetti, puke that splats into
// puddles), mood bubbles, target rings, and a small object pool.

export class Pool<T extends Object3D> {
  private items: T[] = [];
  private used = 0;
  constructor(
    private parent: Object3D,
    private make: () => T,
  ) {}

  get(): T {
    let it = this.items[this.used];
    if (!it) {
      it = this.make();
      this.items.push(it);
      this.parent.add(it);
    }
    this.used++;
    it.visible = true;
    return it;
  }

  /** Hides everything not handed out since the last end(). */
  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
    this.used = 0;
  }
}

interface P {
  p: Vector3;
  v: Vector3;
  g: number;
  life: number;
  max: number;
  color: Color;
  size: number;
  spin: Vector3;
  rot: Vector3;
  flat: boolean;
  puke: boolean;
  drag: number;
}

const MAX = 1800;

export class Particles {
  readonly mesh: InstancedMesh;
  private ps: P[] = [];
  private m = new Matrix4();
  private q = new Quaternion();
  private s = new Vector3();
  private e = new Euler();
  onSplat: (x: number, z: number, size: number) => void = () => {};
  ground: (x: number, z: number) => number = () => 0;

  /** `glow` particles are unlit and bloom (sparks, fireworks). */
  constructor(parent: Object3D, glow = false) {
    const mat = glow ? new MeshBasicMaterial({ color: 0xffffff }) : toon({ vertexColors: false, rim: 0.2 });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), mat, MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.setColorAt(0, new Color(1, 1, 1));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(GLOW_LAYER);
    if (glow) this.mesh.layers.enable(BLOOM_LAYER);
    parent.add(this.mesh);
  }

  add(o: Omit<Partial<P>, 'color'> & { p: Vector3; v: Vector3; color: Color | string }): void {
    if (this.ps.length >= MAX) this.ps.shift();
    this.ps.push({
      g: 3,
      life: 0,
      max: 0.6,
      size: 0.03,
      spin: v3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
      rot: v3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      flat: false,
      puke: false,
      drag: 0.6,
      ...o,
      color: typeof o.color === 'string' ? new Color(o.color) : o.color,
    });
  }

  update(dt: number): void {
    const out: P[] = [];
    let k = 0;
    for (const p of this.ps) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.v.y -= p.g * dt;
      if (p.flat) {
        // Confetti flutters: strong drag and a sideways wobble.
        p.v.multiplyScalar(1 - Math.min(0.9, 2.2 * dt));
        p.v.x += Math.sin(p.life * 7 + p.rot.x) * dt * 1.5;
      } else p.v.multiplyScalar(1 - Math.min(0.5, p.drag * dt));
      p.p.addScaledVector(p.v, dt);
      p.rot.addScaledVector(p.spin, dt);
      const gy = this.ground(p.p.x, p.p.z);
      if (p.p.y < gy) {
        if (p.puke) {
          this.onSplat(p.p.x, p.p.z, p.size);
          continue;
        }
        p.p.y = gy;
        p.v.y = Math.abs(p.v.y) * 0.3;
        p.v.x *= 0.6;
        p.v.z *= 0.6;
      }
      const fade = Math.min(1, (p.max - p.life) / 0.2);
      const sz = p.size * fade;
      this.q.setFromEuler(this.e.set(p.rot.x, p.rot.y, p.rot.z));
      this.s.set(sz, p.flat ? sz * 0.15 : sz, p.flat ? sz * 0.7 : sz);
      this.m.compose(p.p, this.q, this.s);
      this.mesh.setMatrixAt(k, this.m);
      this.mesh.setColorAt(k, p.color);
      k++;
      out.push(p);
    }
    this.ps = out;
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.ps = [];
  }
}

// ---- Mood bubbles -----------------------------------------------------------

const bubbleMats = new Map<string, SpriteMaterial>();

/** A speech bubble with a little drawn icon: heart, dots, green swirl, or a bang. */
export function bubbleMaterial(mood: string): SpriteMaterial {
  let m = bubbleMats.get(mood);
  if (m) return m;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const x = c.getContext('2d')!;
  x.lineJoin = 'round';
  x.lineCap = 'round';
  const body = () => {
    x.beginPath();
    x.roundRect(10, 8, 108, 84, 30);
    x.moveTo(34, 88);
    x.lineTo(24, 120);
    x.lineTo(58, 90);
  };
  x.fillStyle = '#2b2140';
  x.strokeStyle = '#2b2140';
  x.lineWidth = 14;
  body();
  x.stroke();
  x.fill();
  x.fillStyle = '#fbf6ec';
  body();
  x.fill();
  const cx = 64;
  const cy = 50;
  if (mood === 'happy') {
    x.fillStyle = '#ff5d8a';
    x.beginPath();
    x.moveTo(cx, cy + 26);
    x.bezierCurveTo(cx - 44, cy - 2, cx - 20, cy - 36, cx, cy - 12);
    x.bezierCurveTo(cx + 20, cy - 36, cx + 44, cy - 2, cx, cy + 26);
    x.fill();
  } else if (mood === 'meh') {
    x.fillStyle = '#2b2140';
    for (const dx of [-24, 0, 24]) {
      x.beginPath();
      x.arc(cx + dx, cy, 8, 0, Math.PI * 2);
      x.fill();
    }
  } else if (mood === 'sick') {
    // A green face with swirly eyes.
    x.fillStyle = '#a6e05a';
    x.beginPath();
    x.arc(cx, cy, 30, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = '#3c6a1a';
    x.lineWidth = 5;
    for (const dx of [-12, 12]) {
      x.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.2) x.lineTo(cx + dx + Math.cos(a) * a * 1.1, cy - 6 + Math.sin(a) * a * 1.1);
      x.stroke();
    }
    x.beginPath();
    x.moveTo(cx - 12, cy + 16);
    for (let k = 0; k <= 4; k++) x.lineTo(cx - 12 + k * 6, cy + 16 + (k % 2 ? -4 : 4));
    x.stroke();
  } else {
    x.fillStyle = '#f0584e';
    x.beginPath();
    x.roundRect(cx - 7, cy - 30, 14, 40, 7);
    x.fill();
    x.beginPath();
    x.arc(cx, cy + 22, 8, 0, Math.PI * 2);
    x.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  m = new SpriteMaterial({ map: t, depthTest: true, depthWrite: false, transparent: true });
  bubbleMats.set(mood, m);
  return m;
}

export function makeBubble(): Sprite {
  const s = new Sprite(bubbleMaterial('meh'));
  s.scale.set(0.17, 0.17, 1);
  s.center.set(0.2, 0);
  s.layers.set(GLOW_LAYER);
  s.renderOrder = 5;
  return s;
}

// ---- Target markers -----------------------------------------------------------

const ringGeo = new RingGeometry(0.34, 0.44, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2);

export function makeMarker(): Mesh {
  const m = new Mesh(ringGeo, new MeshBasicMaterial({ color: '#ffd23f', transparent: true, depthWrite: false }));
  m.layers.set(GLOW_LAYER);
  m.renderOrder = 4;
  return m;
}

// ---- Puddles ---------------------------------------------------------------------

export function puddleGeo(list: { x: number; y: number; z: number; r: number; seed: number }[]): Geo {
  const g = new Geo();
  for (const p of list) {
    const r = rng(p.seed);
    const ring = (rad: number, y: number) => {
      const pts: Vector3[] = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const rr = rad * (0.7 + r() * 0.5);
        pts.push(v3(p.x + Math.cos(a) * rr, y, p.z + Math.sin(a) * rr * 0.85));
      }
      return pts;
    };
    g.disc(ring(p.r, p.y), '#8cc23e');
    g.disc(ring(p.r * 0.55, p.y + 0.002), '#b8e068');
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2;
      const d = p.r * (1.2 + r() * 0.5);
      g.sphere(v3(p.x + Math.cos(a) * d, p.y + 0.004, p.z + Math.sin(a) * d), p.r * 0.2, '#8cc23e', 1, 0.25, 1, 6, 3);
    }
  }
  return g;
}

export { MATS };

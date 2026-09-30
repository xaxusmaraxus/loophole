import { BufferGeometry, Color, Float32BufferAttribute, Matrix4, Vector3 } from 'three';

// Geometry batch: appends flat-shaded, vertex-colored primitives into one
// BufferGeometry. Convex primitives orient their triangles outward on their
// own, so callers never think about winding. Colors are sRGB hex strings or
// Colors (three stores Colors linear, which is what vertex colors want).

export type Col = Color | string;

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpN = new Vector3();
const cache = new Map<string, Color>();

export function col(c: Col): Color {
  if (typeof c !== 'string') return c;
  let v = cache.get(c);
  if (!v) {
    v = new Color(c);
    cache.set(c, v);
  }
  return v;
}

/** Lighten (k > 0) or darken (k < 0) a color, in sRGB-ish terms. */
export function shade(c: Col, k: number): Color {
  const out = col(c).clone();
  if (k >= 0) out.lerp(new Color(1, 1, 1), k);
  else out.multiplyScalar(1 + k);
  return out;
}

export function v3(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

export class Geo {
  pos: number[] = [];
  nor: number[] = [];
  colr: number[] = [];

  get empty(): boolean {
    return this.pos.length === 0;
  }

  private vert(p: Vector3, n: Vector3, c: Color): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.colr.push(c.r, c.g, c.b);
  }

  /** One flat triangle, flipped if needed so it faces away from `inside`. */
  tri(a: Vector3, b: Vector3, c: Vector3, color: Col, inside: Vector3): void {
    tmpA.subVectors(b, a);
    tmpB.subVectors(c, a);
    tmpN.crossVectors(tmpA, tmpB);
    const cx = (a.x + b.x + c.x) / 3 - inside.x;
    const cy = (a.y + b.y + c.y) / 3 - inside.y;
    const cz = (a.z + b.z + c.z) / 3 - inside.z;
    if (tmpN.x * cx + tmpN.y * cy + tmpN.z * cz < 0) {
      const t = b;
      b = c;
      c = t;
      tmpN.negate();
    }
    if (tmpN.lengthSq() < 1e-14) return;
    tmpN.normalize();
    const k = col(color);
    this.vert(a, tmpN, k);
    this.vert(b, tmpN, k);
    this.vert(c, tmpN, k);
  }

  /** A triangle with explicit per-vertex normals (for smooth tubes and spheres). */
  triSmooth(a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3, color: Col): void {
    tmpA.subVectors(b, a);
    tmpB.subVectors(c, a);
    tmpN.crossVectors(tmpA, tmpB);
    const k = col(color);
    if (tmpN.dot(na) < 0) {
      this.vert(a, na, k);
      this.vert(c, nc, k);
      this.vert(b, nb, k);
    } else {
      this.vert(a, na, k);
      this.vert(b, nb, k);
      this.vert(c, nc, k);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: Col, inside: Vector3): void {
    this.tri(a, b, c, color, inside);
    this.tri(a, c, d, color, inside);
  }

  /** Box spanning ±size/2 in the local space of `m`, optionally chamfered. */
  box(m: Matrix4, sx: number, sy: number, sz: number, color: Col, bevel = 0, top?: Col): void {
    const h = v3(sx / 2, sy / 2, sz / 2);
    const o = v3(0, 0, 0).applyMatrix4(m);
    const topC = top ?? shade(color, 0.05);
    if (bevel <= 0) {
      const c: Vector3[] = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) c.push(v3(x * h.x, y * h.y, z * h.z).applyMatrix4(m));
      const faces: [number, number, number, number, Col][] = [
        [0, 1, 3, 2, color],
        [4, 5, 7, 6, color],
        [0, 1, 5, 4, shade(color, -0.12)],
        [2, 3, 7, 6, topC],
        [0, 2, 6, 4, color],
        [1, 3, 7, 5, color],
      ];
      for (const [a, b, cc, d, k] of faces) this.quad(c[a], c[b], c[cc], c[d], k, o);
      return;
    }
    const b = Math.min(bevel, Math.min(h.x, h.y, h.z) * 0.9);
    const P = (x: number, y: number, z: number) => v3(x, y, z).applyMatrix4(m);
    const px = (x: number, y: number, z: number) => P(x * h.x, y * (h.y - b), z * (h.z - b));
    const py = (x: number, y: number, z: number) => P(x * (h.x - b), y * h.y, z * (h.z - b));
    const pz = (x: number, y: number, z: number) => P(x * (h.x - b), y * (h.y - b), z * h.z);
    const edge = shade(color, 0.08);
    for (const s of [-1, 1]) {
      this.quad(px(s, -1, -1), px(s, 1, -1), px(s, 1, 1), px(s, -1, 1), color, o);
      this.quad(py(-1, s, -1), py(1, s, -1), py(1, s, 1), py(-1, s, 1), s > 0 ? topC : shade(color, -0.15), o);
      this.quad(pz(-1, -1, s), pz(1, -1, s), pz(1, 1, s), pz(-1, 1, s), color, o);
    }
    for (const a of [-1, 1])
      for (const c of [-1, 1]) {
        this.quad(px(a, c, -1), px(a, c, 1), py(a, c, 1), py(a, c, -1), c > 0 ? edge : color, o);
        this.quad(px(a, -1, c), px(a, 1, c), pz(a, 1, c), pz(a, -1, c), color, o);
        this.quad(py(-1, a, c), py(1, a, c), pz(1, a, c), pz(-1, a, c), a > 0 ? edge : color, o);
      }
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) this.tri(px(x, y, z), py(x, y, z), pz(x, y, z), y > 0 ? edge : color, o);
  }

  /** Axis-aligned box from its center. */
  cube(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Col, bevel = 0, top?: Col): void {
    this.box(new Matrix4().makeTranslation(cx, cy, cz), sx, sy, sz, color, bevel, top);
  }

  /** Cylinder or cone along local +Y, centered at m's origin. */
  cyl(m: Matrix4, rb: number, rt: number, h: number, color: Col, sides = 8, cap?: Col, smooth = false): void {
    const o = v3(0, 0, 0).applyMatrix4(m);
    const bot: Vector3[] = [];
    const top: Vector3[] = [];
    const nrm: Vector3[] = [];
    const nm = new Matrix4().extractRotation(m);
    const slope = (rb - rt) / h;
    for (let k = 0; k < sides; k++) {
      const a = (Math.PI * 2 * (k + 0.5)) / sides;
      bot.push(v3(Math.cos(a) * rb, -h / 2, Math.sin(a) * rb).applyMatrix4(m));
      top.push(v3(Math.cos(a) * rt, h / 2, Math.sin(a) * rt).applyMatrix4(m));
      nrm.push(v3(Math.cos(a), slope, Math.sin(a)).normalize().applyMatrix4(nm));
    }
    const cb = v3(0, -h / 2, 0).applyMatrix4(m);
    const ct = v3(0, h / 2, 0).applyMatrix4(m);
    const capC = cap ?? shade(color, 0.06);
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      if (rt > 1e-4) {
        if (smooth) {
          this.triSmooth(bot[k], bot[k2], top[k2], nrm[k], nrm[k2], nrm[k2], color);
          this.triSmooth(bot[k], top[k2], top[k], nrm[k], nrm[k2], nrm[k], color);
        } else this.quad(bot[k], bot[k2], top[k2], top[k], color, o);
        this.tri(ct, top[k], top[k2], capC, o);
      } else this.tri(bot[k], bot[k2], ct, color, o);
      if (rb > 1e-4) this.tri(cb, bot[k], bot[k2], shade(color, -0.2), o);
    }
  }

  /** Cylinder standing on the point (x, y, z). */
  post(x: number, y: number, z: number, r: number, h: number, color: Col, sides = 8, rt = r, cap?: Col): void {
    this.cyl(new Matrix4().makeTranslation(x, y + h / 2, z), r, rt, h, color, sides, cap);
  }

  /** Low-poly UV sphere; `smooth` gives soft shading (fewer ink lines inside). */
  sphere(c: Vector3, r: number, color: Col, sx = 1, sy = 1, sz = 1, segs = 10, rings = 6, smooth = false, m?: Matrix4): void {
    const pts: Vector3[][] = [];
    const nrm: Vector3[][] = [];
    const rot = m ? new Matrix4().extractRotation(m) : null;
    for (let i = 0; i <= rings; i++) {
      const v = (Math.PI * i) / rings;
      const row: Vector3[] = [];
      const nrow: Vector3[] = [];
      for (let k = 0; k < segs; k++) {
        const u = (Math.PI * 2 * k) / segs;
        const d = v3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
        const p = v3(d.x * r * sx, d.y * r * sy, d.z * r * sz);
        const n = v3(d.x / sx, d.y / sy, d.z / sz).normalize();
        if (rot) {
          p.applyMatrix4(rot);
          n.applyMatrix4(rot);
        }
        row.push(p.add(c));
        nrow.push(n);
      }
      pts.push(row);
      nrm.push(nrow);
    }
    for (let i = 0; i < rings; i++)
      for (let k = 0; k < segs; k++) {
        const k2 = (k + 1) % segs;
        const a = pts[i][k];
        const b = pts[i][k2];
        const cc = pts[i + 1][k2];
        const d = pts[i + 1][k];
        if (smooth) {
          const [na, nb, nc, nd] = [nrm[i][k], nrm[i][k2], nrm[i + 1][k2], nrm[i + 1][k]];
          if (i > 0) this.triSmooth(a, b, cc, na, nb, nc, color);
          if (i < rings - 1) this.triSmooth(a, cc, d, na, nc, nd, color);
        } else {
          if (i === 0) this.tri(a, cc, d, color, c);
          else if (i === rings - 1) this.tri(a, b, cc, color, c);
          else this.quad(a, b, cc, d, color, c);
        }
      }
  }

  /** Chunky rock or foliage lump: a jittered icosahedron. */
  blob(c: Vector3, r: number, color: Col, seed: number, jitter = 0.22, sx = 1, sy = 1, sz = 1, topLight = 0.08): void {
    const t = (1 + Math.sqrt(5)) / 2;
    const verts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
      [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const rnd = rng(seed);
    const pts = verts.map(([x, y, z]) => {
      const n = v3(x, y, z).normalize();
      const k = r * (1 + (rnd() * 2 - 1) * jitter);
      return v3(c.x + n.x * k * sx, c.y + n.y * k * sy, c.z + n.z * k * sz);
    });
    const lit = shade(color, topLight);
    for (const [a, b, d] of faces) {
      const cy = (pts[a].y + pts[b].y + pts[d].y) / 3;
      this.tri(pts[a], pts[b], pts[d], cy > c.y + r * sy * 0.35 ? lit : color, c);
    }
  }

  /** A tube through ring centers with their (right, up) frames. Smooth radial normals. */
  tube(centers: Vector3[], rights: Vector3[], ups: Vector3[], r: number, color: Col | ((i: number) => Col), sides = 6): void {
    const rings: Vector3[][] = [];
    const nrms: Vector3[][] = [];
    for (let i = 0; i < centers.length; i++) {
      const ring: Vector3[] = [];
      const nr: Vector3[] = [];
      for (let k = 0; k < sides; k++) {
        const a = (Math.PI * 2 * (k + 0.5)) / sides;
        const n = rights[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(ups[i], Math.sin(a));
        nr.push(n);
        ring.push(centers[i].clone().addScaledVector(n, r));
      }
      rings.push(ring);
      nrms.push(nr);
    }
    for (let i = 0; i < centers.length - 1; i++) {
      const k0 = typeof color === 'function' ? color(i) : color;
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        this.triSmooth(rings[i][k], rings[i][k2], rings[i + 1][k2], nrms[i][k], nrms[i][k2], nrms[i + 1][k2], k0);
        this.triSmooth(rings[i][k], rings[i + 1][k2], rings[i + 1][k], nrms[i][k], nrms[i + 1][k2], nrms[i + 1][k], k0);
      }
    }
  }

  /** A tube along a free 3D polyline (frames are made up as it goes). */
  pipe(pts: Vector3[], r: number, color: Col, sides = 6, closed = false): void {
    if (pts.length < 2) return;
    const all = closed ? [...pts, pts[0]] : pts;
    const n = pts.length;
    const rights: Vector3[] = [];
    const ups: Vector3[] = [];
    let prevUp = v3(0, 1, 0);
    for (let i = 0; i < all.length; i++) {
      const a = closed ? pts[(i - 1 + n) % n] : all[Math.max(0, i - 1)];
      const b = closed ? pts[(i + 1) % n] : all[Math.min(all.length - 1, i + 1)];
      const t = b.clone().sub(a).normalize();
      let rt = prevUp.clone().cross(t);
      if (rt.lengthSq() < 1e-6) rt = v3(1, 0, 0).cross(t);
      rt.normalize();
      const up = t.clone().cross(rt).normalize();
      rights.push(rt);
      ups.push(up);
      prevUp = up;
    }
    this.tube(all, rights, ups, r, color, sides);
  }

  /** A thin square beam from a to b. */
  beam(a: Vector3, b: Vector3, w: number, color: Col, d = w): void {
    const dir = b.clone().sub(a);
    const l = dir.length();
    if (l < 1e-4) return;
    const y = dir.divideScalar(l);
    const x = y.clone().cross(Math.abs(y.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0)).normalize();
    const z = x.clone().cross(y);
    const m = new Matrix4().makeBasis(x, y, z).setPosition(a.clone().add(b).multiplyScalar(0.5));
    this.box(m, w, l, d, color);
  }

  /** A flat polygon lying on y (fan from its centroid), facing up. */
  disc(pts: Vector3[], color: Col): void {
    const c = pts.reduce((s, p) => s.add(p), v3(0, 0, 0)).divideScalar(pts.length);
    const below = c.clone().setY(c.y - 1);
    for (let i = 0; i < pts.length; i++) this.tri(c, pts[i], pts[(i + 1) % pts.length], color, below);
  }

  /** Transform everything added since `from` (a vertex count) by m. */
  transform(m: Matrix4, from = 0): void {
    const nm = new Matrix4().extractRotation(m);
    const p = new Vector3();
    for (let i = from * 3; i < this.pos.length; i += 3) {
      p.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]).applyMatrix4(m);
      this.pos[i] = p.x;
      this.pos[i + 1] = p.y;
      this.pos[i + 2] = p.z;
      p.set(this.nor[i], this.nor[i + 1], this.nor[i + 2]).applyMatrix4(nm);
      this.nor[i] = p.x;
      this.nor[i + 1] = p.y;
      this.nor[i + 2] = p.z;
    }
  }

  /** Vertices so far (for transform). */
  get count(): number {
    return this.pos.length / 3;
  }

  /** Merge another batch in. */
  add(g: Geo): void {
    this.pos.push(...g.pos);
    this.nor.push(...g.nor);
    this.colr.push(...g.colr);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.colr, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

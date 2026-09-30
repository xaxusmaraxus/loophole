import {
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  type MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PointLight,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  MeshBasicMaterial as BasicMat,
} from 'three';
import { sfx } from '../core/sfx';
import type { Game } from '../game';
import {
  type Board,
  type ChainStep,
  type End,
  type SwipeResult as MoveResult,
  type Pt,
  buildTargets,
  canConnect,
  idx,
  isWall,
  rideOrder,
} from '../puzzle/board';
import { RideAnim, parkS } from '../ride/ride';
import type { Rider } from '../riders/riders';
import { Geo, rng, v3 } from '../render3d/geo';
import { GLOW_MAT, GRASS_Y, type Island, WATER_Y, buildIsland } from '../render3d/island';
import { type CarKind, CRATE_H, type Face, M, type Parts, carGeo, crateGeo, mysteryGeo, personGeo, rope } from '../render3d/models';
import { Particles, Pool, bubbleMaterial, makeBubble, makeMarker, puddleGeo } from '../render3d/fx';
import { BLOOM_LAYER, GLOW_LAYER, Post } from '../render3d/post';
import { MATS, SHARED, toon } from '../render3d/toon';
import { TrackPath } from '../render3d/track';
import { buildCellTrack } from '../render3d/trackmesh';
import { ScoreShow } from '../ui/scoreshow';
import { PAL, type ParkTheme, THEMES, TIER_RAMPS } from './palette';

// The park as a little 3D diorama: cel-shaded, ink-lined, procedurally built
// each day. It only presents: all rules live in the game.

const SLIDE_MS = 100;
const WAVE_MS = 170;
/** Pennant colors for the two track ends. */
const END_COLORS = ['#f0584e', '#45a8e0'];
const PITCH = (48 * Math.PI) / 180;
const FOV = 30;
export const CAR_GAP = 0.3;
/** Guests on foot are drawn a little larger than riders, so the crowd reads. */
const STAND_SCALE = 1.3;
/** The queue starts beside the station's sign, not in front of it. */
const QUEUE_START = 0.7;

export interface Walker {
  look: Rider['look'];
  x: number;
  z: number;
  tx: number;
  tz: number;
  speed: number;
  sick?: boolean;
  mood?: 'happy' | 'meh' | 'sick' | 'angry';
  delay: number;
  /** Walk phase, for the step animation. */
  ph?: number;
  /** Stays put once it arrives (the curtain call after a ride). */
  hold?: boolean;
  /** Game time until which this guest is mid-puke. */
  pukeUntil?: number;
}

/** A slow-motion camera shot on something (a rider, the lead car). */
interface Shot {
  at: () => Vector3;
  start: number;
  until: number;
  zoom: number;
  slow: number;
  yaw: number;
}

interface Word {
  el: HTMLElement;
  at: Vector3;
  born: number;
  max: number;
}

/** A guest's rig: body, two arms and two legs, sharing cached geometry. */
class Rig extends Group {
  body = new Mesh(undefined, MATS.matte);
  armL = new Mesh(undefined, MATS.matte);
  armR = new Mesh(undefined, MATS.matte);
  legL = new Mesh(undefined, MATS.matte);
  legR = new Mesh(undefined, MATS.matte);
  constructor() {
    super();
    for (const m of [this.body, this.armL, this.armR, this.legL, this.legR]) {
      m.castShadow = true;
      this.add(m);
    }
  }
}

interface Pose {
  /** Walk cycle phase (radians); undefined = standing still. */
  walk?: number;
  /** 0 = arms down, 1 = arms up (screaming on a ride). */
  arms?: number;
  seated?: boolean;
  face?: Face;
  /** Place with this matrix instead of position + yaw. */
  matrix?: Matrix4;
  yaw?: number;
  wobble?: number;
}

export class Renderer {
  readonly gl: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.5, 90);
  readonly post = new Post();
  readonly show: ScoreShow;
  onRideDone: () => void = () => {};
  n = 5;
  path!: TrackPath;
  now = 0;

  private world = new Group();
  private dyn = new Group();
  private trackGroup = new Group();
  private island: Island | null = null;
  private sun = new DirectionalLight('#fff4e0', 2);
  private hemi = new HemisphereLight('#d6e6ff', '#b89a78', 1.2);
  private lampLights: PointLight[] = [];
  private trackKey = '';
  private cellGroups = new Map<string, Group>();
  private riseAt = new Map<string, number>();
  private crates: Pool<Mesh>;
  private people: Pool<Rig>;
  private cars: Pool<Mesh>;
  private markers: Pool<Mesh>;
  private bubbles: Pool<Sprite>;
  private mists: Pool<Sprite>;
  private pennants: Group[] = [];
  readonly particles: Particles;
  private sparks: Particles;
  private later: { at: number; fn: () => void }[] = [];
  private compact = false;
  private puddles: { x: number; y: number; z: number; r: number; seed: number }[] = [];
  private puddleMesh: Mesh | null = null;
  private puddleDirty = false;
  private tileAnim: { start: number; move: MoveResult; fired: number } | null = null;
  private combo: { value: number; bumped: number; until: number } | null = null;
  private shake = { until: 0, mag: 0 };
  private comboEl = document.getElementById('combo');
  private flashes = new Map<number, number>();
  private walkers: Walker[] = [];
  private riderPos = new Map<number, { x: number; z: number; moving: boolean; ph: number }>();
  private fogged = new Set<number>();
  private ride: RideAnim | null = null;
  private words: Word[] = [];
  private wordLayer: HTMLDivElement;
  private goEl: HTMLDivElement;
  private hover: Pt | null = null;
  private base = { target: new Vector3(), dist: 12 };
  private aspect = 1;
  private cssW = 1;
  private cssH = 1;
  private follow = { w: 0, at: new Vector3() };
  private flash = 0;
  private dusk = 0;
  private stationSign: Mesh | null = null;
  /** The game clock: runs slower during slow motion (the ride, particles, walkers). */
  gameNow = 0;
  private shot: Shot | null = null;
  private shotAt = new Vector3();
  private shotYaw = 0;
  private shotZoom = 0.4;
  private cine = 0;
  private bars: HTMLDivElement[] = [];
  /** Riders lined up after the ride, by car index. */
  private lineup: Walker[] = [];
  /** Test hook (?fixeddt=ms): advance a fixed step per frame, however slow the frames are. */
  private fixed = Number(new URLSearchParams(location.search).get('fixeddt') ?? 0);
  private vnow = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly game: Game,
  ) {
    this.gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFSoftShadowMap;
    this.gl.shadowMap.autoUpdate = false;
    this.show = new ScoreShow(canvas.parentElement!);
    this.show.onShake = (mag, ms) => this.kick(mag, ms);
    this.show.onCheer = () => this.cheer(1);
    this.scene.add(this.world, this.dyn, this.trackGroup);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.015;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    for (let i = 0; i < 4; i++) {
      const l = new PointLight('#ffd98a', 0, 2.6, 1.6);
      this.lampLights.push(l);
      this.scene.add(l);
    }
    this.crates = new Pool(this.dyn, () => {
      const m = new Mesh(undefined, toon({ gloss: 1, rim: 0.4 }));
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    });
    this.people = new Pool(this.dyn, () => new Rig());
    this.cars = new Pool(this.dyn, () => {
      const m = new Mesh(undefined, MATS.gloss);
      m.castShadow = true;
      m.matrixAutoUpdate = false;
      return m;
    });
    this.markers = new Pool(this.dyn, makeMarker);
    this.bubbles = new Pool(this.dyn, makeBubble);
    this.mists = new Pool(this.dyn, makeMist);
    for (const end of [0, 1]) {
      const p = pennant(END_COLORS[end]);
      this.pennants.push(p);
      this.dyn.add(p);
    }
    this.particles = new Particles(this.dyn);
    this.sparks = new Particles(this.dyn, true);
    this.sparks.ground = () => -5;
    this.particles.ground = (x, z) => this.groundAt(x, z);
    this.particles.onSplat = (x, z, size) => this.splat(x, z, size);
    const wrap = canvas.parentElement!;
    this.wordLayer = document.createElement('div');
    this.wordLayer.className = 'words3d';
    this.wordLayer.setAttribute('aria-hidden', 'true');
    wrap.append(this.wordLayer);
    this.goEl = document.createElement('div');
    this.goEl.className = 'go3d';
    this.goEl.textContent = 'GO!';
    this.wordLayer.append(this.goEl);
    for (const cls of ['lb-top', 'lb-bot']) {
      const b = document.createElement('div');
      b.className = `letterbox ${cls}`;
      wrap.append(b);
      this.bars.push(b);
    }
    canvas.addEventListener('pointermove', (e) => (this.hover = this.cellAt(e.clientX, e.clientY)));
    canvas.addEventListener('pointerleave', () => (this.hover = null));
    const q = new URLSearchParams(location.search);
    if (q.has('noink')) this.post.enabled = false;
    if (q.has('inkdebug')) this.post.mat.uniforms.uDebug.value = 1;
    this.setupDay();
  }

  private get board(): Board {
    return this.game.board;
  }

  private get theme(): ParkTheme {
    return THEMES[this.game.cfg.park.id];
  }

  // ---- Geometry ----------------------------------------------------------------

  /** World position of a cell's center on the ground. */
  cell(p: Pt): Vector3 {
    return v3(p.x + 0.5, this.groundAt(p.x + 0.5, p.y + 0.5), p.y + 0.5);
  }

  groundAt(x: number, z: number): number {
    return x >= 0 && x <= this.n && z >= 0 && z <= this.n ? GRASS_Y : 0;
  }

  /** Where riders stand to board: the platform inside the station U. */
  stationCenter(): Vector3 {
    const s = this.board.station;
    return v3(s.x + 1, 0.1, s.y + 0.34);
  }

  /** Feet position of the i-th rider in the snaking queue below the station. */
  slot(i: number): Vector3 {
    const sc = this.stationCenter();
    const n = this.n;
    const dir = this.queueDir();
    const room = (dir > 0 ? n + 0.45 - sc.x : sc.x + 0.45) - QUEUE_START;
    const total = Math.max(1, this.game.queue.length);
    const perRow = Math.max(4, Math.min(Math.floor(room / 0.3) + 1, Math.ceil(total / 3)));
    const spacing = Math.min(0.3, room / Math.max(1, perRow - 1));
    const row = Math.floor(i / perRow);
    const k = i % perRow;
    const along = row % 2 === 0 ? k : perRow - 1 - k;
    return v3(sc.x + dir * (QUEUE_START + along * spacing), 0, this.board.station.y + 1.44 + Math.min(row, 2) * 0.4);
  }

  private queueDir(): number {
    const sc = this.stationCenter();
    return this.n - sc.x > sc.x ? 1 : -1;
  }

  /** World to page (client) coordinates. */
  project(v: Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** Board cell under a page coordinate, or null. */
  cellAt(clientX: number, clientY: number): Pt | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // A crate's lid first, then the ground.
    const hit = new Vector3();
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < this.n && y < this.n;
    if (ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -(GRASS_Y + CRATE_H)), hit)) {
      const x = Math.floor(hit.x);
      const y = Math.floor(hit.z);
      if (inside(x, y) && this.board.tiles[idx(this.board, x, y)]) return { x, y };
    }
    if (!ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -GRASS_Y), hit)) return null;
    const x = Math.floor(hit.x);
    const y = Math.floor(hit.z);
    return inside(x, y) ? { x, y } : null;
  }

  /** Shake the park (keeps the stronger of overlapping shakes). */
  kick(mag: number, ms: number): void {
    if (this.now < this.shake.until && this.shake.mag > mag) return;
    this.shake = { until: this.now + ms, mag };
  }

  /** Click or space during the ride: resolve the rest of the scoring at once. */
  skipRide(): void {
    this.ride?.skip(this.gameNow);
    this.shot = null;
  }

  // ---- Setup ---------------------------------------------------------------------

  private setupDay(): void {
    const b = this.board;
    this.n = b.size;
    this.world.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      if (m.material && !Array.isArray(m.material) && (m.material as { isShaderMaterial?: boolean }).isShaderMaterial) m.material.dispose();
    });
    for (const c of [...this.world.children]) this.world.remove(c);
    this.later = [];
    const park = this.game.cfg.park.id;
    const seed = this.game.dayNum * 977 + this.game.seed.charCodeAt(0) * 13 + (this.game.seed.charCodeAt(1) || 0);
    this.island = buildIsland(b, park, seed);
    this.world.add(this.island.group);
    this.world.add(this.buildStation());
    this.island.lamps.forEach((p, i) => this.lampLights[i].position.copy(p));
    this.scene.background = new Color(this.island.look.horizon);
    this.trackKey = '';
    for (const g of this.cellGroups.values()) this.trackGroup.remove(g);
    this.cellGroups.clear();
    this.riseAt.clear();
    this.syncTrack(true);
    this.tileAnim = null;
    this.combo = null;
    this.ride = null;
    this.show.end();
    this.walkers = [];
    this.lineup = [];
    this.shot = null;
    this.cine = 0;
    this.particles.clear();
    this.puddles = [];
    this.puddleDirty = true;
    for (const w of this.words) w.el.remove();
    this.words = [];
    this.riderPos.clear();
    this.game.queue.forEach((r, i) => {
      const s = this.slot(i);
      const side = this.queueDir();
      this.riderPos.set(r.id, { x: s.x + side * (1.2 + i * 0.3), z: s.z, moving: true, ph: Math.random() * 6 });
    });
    const is = this.island;
    const cam = this.sun.shadow.camera;
    const half = Math.max(is.x1 - is.x0, is.z1 - is.z0) * 0.62;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 0.5;
    cam.far = 40;
    cam.updateProjectionMatrix();
    this.fit();
    this.dusk = -1;
  }

  /** The station: a deck under the U-turn, an island platform, a striped canopy and the sign. */
  private buildStation(): Group {
    const g = new Group();
    const s = this.board.station;
    const xc = s.x + 1;
    const z = s.y;
    const parts: Parts = { matte: new Geo(), gloss: new Geo(), cloth: new Geo(), glow: new Geo() };
    const m = parts.matte!;
    m.cube(xc, 0.03, z + 0.46, 1.9, 0.06, 0.94, '#8f96ae', 0.02, '#a9adc0');
    for (let k = 0; k < 9; k++) m.cube(xc - 0.9 + k * 0.225, 0.061, z + 0.46, 0.012, 0.004, 0.9, '#7a7f99');
    // Island platform, rounded at the front to follow the U.
    const pts: Vector3[] = [];
    const R = 0.37;
    pts.push(v3(xc - R, 0, z + 0.02), v3(xc + R, 0, z + 0.02));
    for (let k = 0; k <= 12; k++) {
      const a = (Math.PI * k) / 12;
      pts.push(v3(xc + Math.cos(a) * R, 0, z + 0.3 + Math.sin(a) * R));
    }
    const top = pts.map((p) => p.clone().setY(0.1));
    const inside = v3(xc, 0.05, z + 0.3);
    m.disc(top, '#e8e4f4');
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k];
      const b2 = pts[(k + 1) % pts.length];
      m.quad(a.clone().setY(0.06), b2.clone().setY(0.06), b2.clone().setY(0.1), a.clone().setY(0.1), '#b9bccd', inside);
    }
    for (let k = 0; k < 12; k += 2) {
      const a = (Math.PI * (k + 0.5)) / 12;
      m.cube(xc + Math.cos(a) * (R - 0.03), 0.102, z + 0.3 + Math.sin(a) * (R - 0.03), 0.05, 0.006, 0.05, PAL.gold);
    }
    // Canopy posts and a striped, scalloped roof over the platform.
    for (const px of [-0.22, 0.22]) m.post(xc + px, 0.1, z + 0.12, 0.018, 0.4, '#2b2140', 6);
    const cloth = parts.cloth!;
    const stripes = 6;
    for (let i = 0; i < stripes; i++) {
      const w = 0.62 / stripes;
      const x0 = xc - 0.31 + i * w;
      cloth.box(new Matrix4().makeRotationX(0.3).setPosition(x0 + w / 2, 0.52, z + 0.14), w, 0.014, 0.34, i % 2 ? PAL.white : PAL.red);
      cloth.sphere(v3(x0 + w / 2, 0.47, z + 0.31), w * 0.5, i % 2 ? PAL.white : PAL.red, 1, 0.55, 0.35, 8, 4);
    }
    m.cube(xc, 0.57, z - 0.02, 0.66, 0.04, 0.05, '#b83344', 0.012);
    // The marquee along the front of the station deck.
    const sign = new Mesh(new PlaneGeometry(0.98, 0.3), new BasicMat({ map: signTexture(), transparent: true }));
    const tilt = new Matrix4().makeRotationX(-0.55);
    sign.position.set(xc, 0.165, z + 1.03);
    sign.rotation.x = -0.55;
    sign.layers.set(GLOW_LAYER);
    this.stationSign = sign;
    g.add(sign);
    m.box(new Matrix4().copy(tilt).setPosition(xc, 0.155, z + 0.99), 1.02, 0.33, 0.03, '#9a5a1c', 0.01);
    for (const sx of [-0.4, 0.4]) m.post(xc + sx, 0, z + 1.02, 0.018, 0.12, '#2b2140', 6);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const lp = v3(Math.cos(a) * 0.52, Math.sin(a) * 0.17, 0.02).applyMatrix4(tilt);
      parts.glow!.sphere(v3(xc + lp.x, 0.16 + lp.y, z + 1.0 + lp.z), 0.018, '#fff1b0', 1, 1, 1, 6, 4);
    }
    // Queue barriers.
    const sc = this.stationCenter();
    const dir = this.queueDir();
    const far = dir > 0 ? this.n + 0.5 : -0.5;
    const zr = s.y + 1.44;
    const ropeCol = '#e8484f';
    for (let r2 = 0; r2 < 2; r2++) {
      const zz = zr + 0.2 + r2 * 0.4;
      const a = r2 % 2 === 0 ? v3(sc.x + dir * (QUEUE_START - 0.2), 0, zz) : v3(sc.x + dir * (QUEUE_START + 0.3), 0, zz);
      const b = r2 % 2 === 0 ? v3(far - dir * 0.35, 0, zz) : v3(far + dir * 0.1, 0, zz);
      const steps = Math.max(1, Math.round(Math.abs(b.x - a.x) / 0.7));
      for (let k = 0; k < steps; k++) rope(parts, a.clone().lerp(b, k / steps), a.clone().lerp(b, (k + 1) / steps), ropeCol);
    }
    for (const [key, mat] of Object.entries(MATS) as [keyof typeof MATS, (typeof MATS)[keyof typeof MATS]][]) {
      const geo = parts[key];
      if (!geo || geo.empty) continue;
      const mesh = new Mesh(geo.build(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    const glow = new Mesh(parts.glow!.build(), GLOW_MAT);
    glow.layers.set(GLOW_LAYER);
    glow.layers.enable(BLOOM_LAYER);
    g.add(glow);
    return g;
  }

  // ---- Camera framing ------------------------------------------------------------

  private framePoints(): Vector3[] {
    const is = this.island!;
    const pts: Vector3[] = [];
    if (this.compact) {
      // Phones: the board, station and queue fill the frame; the verge can crop.
      for (const x of [-0.35, this.n + 0.35])
        for (const z of [-0.2, this.n + 2.1]) {
          pts.push(v3(x, 0, z));
          pts.push(v3(x, 0.8, z));
        }
      return pts;
    }
    for (const x of [is.x0 - 0.1, is.x1 + 0.1])
      for (const z of [is.z0 - 0.05, is.z1 + 0.1]) {
        pts.push(v3(x, 0, z));
        pts.push(v3(x, -0.66, z));
      }
    // Room above the back row for tall loops and the trees.
    pts.push(v3(this.n / 2, 1.1, 0.1));
    return pts;
  }

  private solveFrame(aspect: number): { target: Vector3; dist: number; ext: Vector2 } {
    const cam = this.camera;
    cam.aspect = aspect;
    cam.fov = FOV;
    cam.updateProjectionMatrix();
    const is = this.island!;
    const target = v3((is.x0 + is.x1) / 2, 0, (is.z0 + is.z1) / 2);
    let dist = 16;
    const dir = v3(0, Math.sin(PITCH), Math.cos(PITCH));
    const pts = this.framePoints();
    const ext = new Vector2();
    for (let it = 0; it < 14; it++) {
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of pts) {
        const q = p.clone().project(cam);
        x0 = Math.min(x0, q.x);
        x1 = Math.max(x1, q.x);
        y0 = Math.min(y0, q.y);
        y1 = Math.max(y1, q.y);
      }
      ext.set(x1 - x0, y1 - y0);
      const halfH = Math.tan(((FOV / 2) * Math.PI) / 180) * dist;
      const halfW = halfH * aspect;
      const up = v3(0, Math.cos(PITCH), -Math.sin(PITCH));
      target.x += ((x0 + x1) / 2) * halfW * 0.9;
      target.addScaledVector(up, ((y0 + y1) / 2) * halfH * 0.9);
      const need = Math.max(ext.x / 2, ext.y / 2) / 0.99;
      dist *= 0.4 + 0.6 * need;
    }
    return { target, dist, ext };
  }

  private naturalAspect(): number {
    const { ext } = this.solveFrame(1);
    return Math.max(0.72, Math.min(1.3, ext.x / ext.y));
  }

  fit(): void {
    const area = this.canvas.closest('.park') ?? this.canvas.parentElement!;
    const availW = (area as HTMLElement).clientWidth;
    const above = ['attractions', 'dayBanner'].reduce((h, id) => h + (document.getElementById(id)?.offsetHeight ?? 0), 0);
    const reserved = (document.fullscreenElement ? 190 : 235) + above;
    const availH = Math.max(300, window.innerHeight - reserved);
    this.compact = availW < 620;
    this.aspect = this.naturalAspect();
    let w = availW;
    let h = w / this.aspect;
    if (h > availH) {
      h = availH;
      w = h * this.aspect;
    }
    this.cssW = Math.max(200, Math.floor(w));
    this.cssH = Math.max(200, Math.floor(h));
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    // The ink and bloom passes cost per pixel; cap the resolution a little on phones.
    const dpr = Math.min(this.compact ? 1.6 : 2, window.devicePixelRatio || 1);
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(this.cssW, this.cssH, false);
    this.post.setSize(Math.round(this.cssW * dpr), Math.round(this.cssH * dpr), dpr);
    const f = this.solveFrame(this.cssW / this.cssH);
    this.base = { target: f.target, dist: f.dist };
    if (this.show?.active) this.show.layout();
  }

  // ---- Events --------------------------------------------------------------------

  handleEvents(): void {
    for (const e of this.game.events.splice(0)) {
      switch (e.type) {
        case 'day':
          this.setupDay();
          break;
        case 'swipe':
          this.tileAnim = { start: this.now, move: e.result, fired: -1 };
          this.combo = null;
          break;
        case 'build': {
          const c = this.cell(e.laid);
          this.dust(c.clone().setY(0.1), 14, PAL.plaza[2]);
          this.sparkle(c.clone().setY(0.3), 10, TIER_RAMPS[Math.max(1, e.laid.tier)][1]);
          this.flashes.set(idx(this.board, e.laid.x, e.laid.y), this.now + 150);
          this.kick(0.6, 90);
          sfx.lay();
          break;
        }
        case 'blocked':
          this.kick(1, 90);
          sfx.blocked();
          break;
        case 'arrive': {
          const i = this.game.queue.indexOf(e.rider);
          const s = this.slot(i);
          this.riderPos.set(e.rider.id, { x: s.x + this.queueDir() * 1.6, z: s.z, moving: true, ph: 0 });
          if (e.reason !== 'walkin') this.word(e.reason === 'chain' ? 'WOW' : 'OOH', s.clone().setY(0.7), PAL.gold);
          break;
        }
        case 'undo':
          this.tileAnim = null;
          break;
        case 'open':
          sfx.open();
          this.startRide();
          break;
        case 'dark':
          this.word('SUNSET', this.stationCenter().setY(1.1), PAL.gold);
          sfx.meh();
          break;
        case 'tool': {
          const at = e.at ? this.cell(e.at) : this.stationCenter();
          if (e.tool === 'dynamite') {
            this.burst(at.clone().setY(0.2), 40, [PAL.gold, PAL.red, '#7a7f99', '#2b2140']);
            this.dust(at.clone().setY(0.1), 24, '#a9adc0');
            this.word('BOOM', at.clone().setY(0.8), PAL.gold, 1.3);
            this.kick(3, 260);
            sfx.blocked();
            sfx.chain(1);
          } else if (e.tool === 'paint' && e.at) {
            this.flashes.set(idx(this.board, e.at.x, e.at.y), this.now + 200);
            this.burst(at.clone().setY(0.35), 18, [PAL.heart, PAL.gold, PAL.white]);
            sfx.merge(3);
          } else if (e.tool === 'coffee') {
            this.word('+5 SWIPES', at.clone().setY(1), PAL.gold);
            sfx.hype();
          } else if (e.tool === 'megaphone') {
            this.word('COME RIDE!', at.clone().setY(1), PAL.white);
            sfx.open();
          } else sfx.lay();
          break;
        }
      }
    }
  }

  private startRide(): void {
    const result = this.game.result!;
    if (!result.kind) return;
    const sc = this.stationCenter();
    // Riders walk onto the platform, then the train leaves.
    this.game.queue.forEach((r, i) => {
      const p = this.riderPos.get(r.id);
      if (!p) return;
      this.walkers.push({ look: r.look, x: p.x, z: p.z, tx: sc.x + (Math.random() - 0.5) * 0.3, tz: sc.z, speed: 1.3, delay: i * 70 });
    });
    this.riderPos.clear();
    this.syncTrack();
    this.ride = new RideAnim(this, rideOrder(this.board, result.kind), result, this.show, this.gameNow + 900);
  }

  // ---- Effects ---------------------------------------------------------------------

  dust(at: Vector3, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 0.5;
      this.particles.add({ p: at.clone(), v: v3(Math.cos(a) * s, 0.3 + Math.random() * 0.4, Math.sin(a) * s), g: 1.5, max: 0.45 + Math.random() * 0.2, color, size: 0.03 + Math.random() * 0.03, drag: 3 });
    }
  }

  burst(at: Vector3, n: number, ramp: readonly string[]): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const s = 1 + Math.random() * 1.4;
      this.particles.add({ p: at.clone(), v: v3(Math.cos(a) * s, 1.2 + Math.random() * 1.6, Math.sin(a) * s * 0.7), g: 5, max: 0.6 + Math.random() * 0.4, color: ramp[i % ramp.length], size: i % 4 === 0 ? 0.05 : 0.032 });
    }
  }

  /** A green spray from `at` along `dir`, carried along by `carry` (the car's velocity). */
  puke(at: Vector3, n = 8, carry?: Vector3, dir?: Vector3): void {
    const ramp = ['#a6e05a', '#6fae2e', '#c8e86a', '#4f8a1f'];
    const d = dir ?? v3(0, 0.4, 1);
    for (let i = 0; i < n; i++) {
      const spread = 0.5 + n * 0.012;
      const v = d.clone().multiplyScalar(0.8 + Math.random() * 0.9);
      v.x += (Math.random() - 0.5) * spread;
      v.y += Math.random() * 0.8;
      v.z += (Math.random() - 0.5) * spread;
      if (carry) v.addScaledVector(carry, 0.35);
      this.particles.add({ p: at.clone(), v, g: 5.5, max: 1.6, color: ramp[i % ramp.length], size: 0.018 + Math.random() * 0.026, puke: i % 3 === 0, drag: 0.3 });
    }
  }

  sparkle(at: Vector3, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 0.8;
      this.particles.add({ p: at.clone(), v: v3(Math.cos(a) * s, 0.8 + Math.random() * 1.2, Math.sin(a) * s), g: 2.5, max: 0.4 + Math.random() * 0.3, color: i % 3 ? color : PAL.white, size: 0.025 + Math.random() * 0.02 });
    }
  }

  /** Confetti over the whole park, for the target and the slam. */
  cheer(power: number): void {
    const is = this.island;
    if (!is) return;
    const colors = [PAL.gold, PAL.heart, '#45a8e0', '#a6e05a', PAL.white, '#9d6ef0'];
    const n = Math.round(90 * power);
    for (let i = 0; i < n; i++)
      this.particles.add({
        p: v3(is.x0 + Math.random() * (is.x1 - is.x0), 2 + Math.random() * 1.5, is.z0 + Math.random() * (is.z1 - is.z0)),
        v: v3((Math.random() - 0.5) * 0.6, -0.4 - Math.random() * 0.6, (Math.random() - 0.5) * 0.4),
        g: 0.8,
        max: 3 + Math.random() * 1.5,
        color: colors[i % colors.length],
        size: 0.07,
        flat: true,
        spin: v3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5),
      });
    this.burst(this.stationCenter().setY(0.5), Math.round(30 * power), [PAL.gold, PAL.heart, PAL.white]);
    if (power >= 1 && !this.shot) this.fireworks(Math.round(1 + power * 2));
  }

  /** Rockets from behind the island that burst into glowing sparks. */
  fireworks(n: number): void {
    const is = this.island;
    if (!is) return;
    const colors = [['#ffd23f', '#fff1b0'], ['#ff5d8a', '#ffd0e0'], ['#45e0ff', '#d8f8ff'], ['#a6f05a', '#f0ffd0'], ['#c49dff', '#f0e4ff']];
    for (let k = 0; k < n; k++) {
      const delay = k * 260 + Math.random() * 200;
      const from = v3(0.3 + Math.random() * (this.n - 0.6), -0.4, is.z0 - 0.6 - Math.random() * 0.8);
      const top = v3(from.x + (Math.random() - 0.5) * 0.6, 1.05 + Math.random() * 0.45, Math.random() * 1.6);
      const rise = 700;
      const pal = colors[Math.floor(Math.random() * colors.length)];
      this.after(delay, () => {
        const v = top.clone().sub(from).multiplyScalar(1000 / rise);
        this.sparks.add({ p: from.clone(), v, g: 0, max: rise / 1000, color: pal[1], size: 0.05, drag: 0 });
        sfx.whistle();
      });
      this.after(delay + rise, () => {
        for (let i = 0; i < 70; i++) {
          const u = Math.random() * 2 - 1;
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(1 - u * u);
          const sp = 1.9 + Math.random() * 0.4;
          this.sparks.add({ p: top.clone(), v: v3(r * Math.cos(a) * sp, u * sp, r * Math.sin(a) * sp), g: 0.9, max: 1 + Math.random() * 0.5, color: pal[i % 2], size: 0.045 + Math.random() * 0.025, drag: 1.8 });
        }
        this.flash = Math.max(this.flash, 0.12);
        sfx.pop();
      });
    }
  }

  private after(ms: number, fn: () => void): void {
    this.later.push({ at: this.now + ms, fn });
  }

  hat(at: Vector3, color: string): void {
    this.particles.add({ p: at.clone(), v: v3((Math.random() - 0.5) * 1.2, 1.8, (Math.random() - 0.5) * 0.8), g: 4, max: 1.6, color, size: 0.07 });
  }

  word(text: string, at: Vector3, color: string, big = 1): void {
    // Stack shouts that land on the same spot instead of piling them up.
    const near = this.words.filter((w) => this.now - w.born < 700 && Math.hypot(w.at.x - at.x, w.at.z - at.z) < 0.9).length;
    at = at.clone().setY(at.y + near * 0.22);
    const el = document.createElement('span');
    el.className = 'w3d';
    el.textContent = text;
    el.style.color = color;
    el.style.setProperty('--s', String(big));
    this.wordLayer.append(el);
    this.words.push({ el, at: at.clone(), born: this.now, max: 1100 });
  }

  addWalker(w: Walker): void {
    this.walkers.push(w);
  }

  private splat(x: number, z: number, size: number): void {
    if (this.puddles.length > 70) return;
    // Merge into a nearby puddle rather than stacking dozens.
    const y = this.groundAt(x, z) + 0.004;
    const near = this.puddles.find((p) => Math.hypot(p.x - x, p.z - z) < Math.max(0.2, p.r));
    if (near) near.r = Math.min(0.26, near.r + size * 0.25);
    else this.puddles.push({ x, y, z, r: 0.05 + size, seed: Math.floor(Math.random() * 1e6) });
    this.puddleDirty = true;
  }

  // ---- Frame -----------------------------------------------------------------------

  frame(now: number): void {
    if (this.fixed) now = this.vnow += this.fixed;
    const dt = Math.min(this.fixed ? this.fixed / 1000 : 0.05, (now - this.now) / 1000 || 0);
    this.now = now;
    // Slow motion: ease into the shot's time scale, and back out.
    if (this.shot && now > this.shot.until) {
      this.shot = null;
      sfx.slowOut();
    }
    this.cine += ((this.shot ? 1 : 0) - this.cine) * Math.min(1, dt * (this.shot ? 7 : 4));
    if (this.cine < 0.002) this.cine = 0;
    const scale = 1 - this.cine * (1 - (this.shot?.slow ?? 0.2));
    const gdt = dt * scale;
    this.gameNow += gdt * 1000;
    this.handleEvents();
    SHARED.uTime.value = now / 1000;
    this.fireTileEffects();
    this.updateFog();
    this.syncTrack();
    this.updateLight(dt);
    this.drawTrackRise();
    this.drawCrates();
    this.drawTargets();
    this.drawQueue(dt);
    this.updateWalkers(gdt);
    if (this.ride) {
      this.ride.update(this.gameNow, gdt);
      this.ride.draw(this.gameNow);
      if (this.ride.finished(this.gameNow)) {
        this.ride = null;
        this.onRideDone();
      }
    } else if (this.game.phase !== 'ride') this.drawParkedTrain();
    this.show.tick(dt, now);
    const due = this.later.filter((l) => l.at <= now);
    this.later = this.later.filter((l) => l.at > now);
    for (const l of due) l.fn();
    this.particles.update(gdt);
    this.sparks.update(gdt);
    if (this.puddleDirty) this.rebuildPuddles();
    this.animateScenery(now);
    this.crates.end();
    this.people.end();
    this.cars.end();
    this.markers.end();
    this.bubbles.end();
    this.mists.end();
    this.updateCamera(dt);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.post.mat.uniforms.uFlash.value = this.flash * 0.5;
    this.post.mat.uniforms.uCine.value = this.cine;
    this.drawBars();
    this.post.render(this.gl, this.scene, this.camera, now / 1000);
    this.drawWords();
    this.drawCombo();
  }

  /** A white flash over the whole frame (boss pukes). */
  flashScreen(k: number): void {
    this.flash = Math.max(this.flash, k);
  }

  private updateCamera(dt: number): void {
    const cam = this.camera;
    const f = this.follow;
    const want = this.ride?.focus() ?? null;
    f.w += ((want ? 1 : 0) - f.w) * Math.min(1, dt * 2.2);
    if (want) f.at.lerp(want, f.w < 0.05 ? 1 : Math.min(1, dt * 3));
    const target = this.base.target.clone().lerp(f.at, f.w * 0.38);
    let dist = this.base.dist * (1 - f.w * 0.17);
    let pitch = PITCH;
    let yaw = 0;
    const c = this.cine;
    if (c > 0) {
      // Product-video push-in: close on the subject, lower angle, a slow orbit.
      if (this.shot) {
        this.shotAt.lerp(this.shot.at(), 0.35);
        const k = (this.now - this.shot.start) / Math.max(1, this.shot.until - this.shot.start);
        this.shotYaw = this.shot.yaw * (0.6 + k * 0.8);
        this.shotZoom = this.shot.zoom * (1 - k * 0.12);
      }
      const e = c * c * (3 - 2 * c);
      target.lerp(this.shotAt, e);
      dist *= 1 + (this.shotZoom - 1) * e;
      pitch += (0.6 - PITCH) * e;
      yaw = this.shotYaw * e;
    }
    const dir = v3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    cam.position.copy(target).addScaledVector(dir, dist);
    if (this.now < this.shake.until) {
      const m = this.shake.mag * 0.018;
      cam.position.x += (Math.random() - 0.5) * 2 * m;
      cam.position.y += (Math.random() - 0.5) * 2 * m;
    }
    cam.lookAt(target);
    cam.updateMatrixWorld();
  }

  /** Late in the day the light turns golden, then dusk comes and the lamps light up. */
  private updateLight(dt: number): void {
    const frac = this.game.daylight / Math.max(1, this.game.cfg.daylight);
    const park = this.game.cfg.park.id;
    let gold = frac < 0.6 ? Math.min(1, (0.6 - frac) / 0.3) : 0;
    let dusk = frac < 0.3 ? Math.min(1, (0.3 - frac) / 0.3) : 0;
    if (park === 'hollow') {
      gold = Math.max(gold, 0.3);
      dusk = Math.max(dusk, 0.55);
    }
    this.dusk = this.dusk < 0 ? dusk : this.dusk + (dusk - this.dusk) * Math.min(1, dt * 2);
    const d = this.dusk;
    const g = gold * (1 - d);
    const mix3 = (a: string, b: string, c: string) => new Color(a).lerp(new Color(b), g).lerp(new Color(c), d);
    this.sun.color.copy(mix3('#fff2dc', '#ffcf98', '#9a8cff'));
    this.sun.intensity = 2.3 - g * 0.2 - d * 1.3;
    const is = this.island!;
    const c = v3((is.x0 + is.x1) / 2, 0, (is.z0 + is.z1) / 2);
    const dir = v3(-0.42 - g * 0.4, 1 - g * 0.35 - d * 0.2, 0.62 - g * 0.2).normalize();
    this.sun.position.copy(c).addScaledVector(dir, 16);
    this.sun.target.position.copy(c);
    this.hemi.color.copy(mix3('#cfe0ff', '#ffe2cc', '#5a52a8'));
    this.hemi.groundColor.copy(mix3('#c2a07a', '#a07060', '#302850'));
    this.hemi.intensity = 1.9 - d * 0.5;
    SHARED.uRimColor.value.copy(mix3('#fff1d6', '#ffd29a', '#ffa8e8'));
    const lampK = Math.max(g * 0.35, d);
    for (const l of this.lampLights) l.intensity = lampK * 2.2;
    GLOW_MAT.color.setScalar(0.72 + lampK * 0.6);
    this.post.bloom = 0.25 + lampK * 1.6;
    for (const w of is.waters) {
      w.uniforms.uTime.value = this.now / 1000;
      w.uniforms.uDusk.value = d;
      w.uniforms.uGold.value = g;
    }
    const u = this.post.mat.uniforms;
    (u.uWarm.value as Color).setRGB(1.03 + g * 0.05, 1.0 - d * 0.02, 0.94 - g * 0.06 + d * 0.04);
    (u.uCool.value as Color).setRGB(0.9 + d * 0.02, 0.93 - d * 0.03, 1.06 + d * 0.08);
    if (this.scene.background instanceof Color) this.scene.background.set(is.look.horizon).lerp(new Color('#141638'), d * 0.6);
  }

  private animateScenery(now: number): void {
    const is = this.island;
    if (!is) return;
    if (is.ferris) {
      is.ferris.rotation.z = now / 9000;
      for (const c of is.ferris.children) if (c.userData.gondola) c.rotation.z = -is.ferris.rotation.z;
    }
    if (is.swing) {
      is.swing.rotation.y = now / 1400;
      is.swing.rotation.z = Math.sin(now / 2100) * 0.08;
    }
    // The sailboat circles the island; the clouds drift by.
    const t = now / 1000;
    const a = t * 0.05 + is.boat.userData.phase;
    const rx = (is.x1 - is.x0) / 2 + 1.4;
    const rz = (is.z1 - is.z0) / 2 + 1.2;
    const cx = (is.x0 + is.x1) / 2;
    const cz = (is.z0 + is.z1) / 2;
    is.boat.position.set(cx + Math.cos(a) * rx, WATER_Y + Math.sin(t * 2.1) * 0.012, cz + Math.sin(a) * rz);
    is.boat.rotation.set(Math.sin(t * 1.7) * 0.05, Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz), Math.sin(t * 1.3) * 0.08);
    const span = is.x1 - is.x0 + 6;
    for (const c of is.clouds) {
      c.userData.x0 ??= c.position.x - is.x0 + 3;
      c.position.x = is.x0 - 3 + ((c.userData.x0 + c.userData.speed * t) % span);
    }
  }

  // ---- Fog -----------------------------------------------------------------------

  private updateFog(): void {
    this.fogged.clear();
    const b = this.board;
    if (!this.game.cfg.park.fog || this.game.phase === 'ride' || this.game.phase === 'results') return;
    const seen = [{ x: b.station.x, y: b.station.y }, { x: b.station.x + 1, y: b.station.y }, ...b.ends[0], ...b.ends[1]];
    const t = this.now / 1000;
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        if (seen.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) <= 2)) continue;
        this.fogged.add(idx(b, x, y));
        const s = this.mists.get();
        s.position.set(x + 0.5 + Math.sin(t * 0.4 + x * 1.3) * 0.12, 0.42 + Math.sin(t * 0.7 + y) * 0.04, y + 0.5 + Math.cos(t * 0.3 + y * 1.7) * 0.1);
        const k = 1.25 + Math.sin(t * 0.5 + x + y) * 0.1;
        s.scale.set(k, k * 0.7, 1);
      }
  }

  // ---- Track -----------------------------------------------------------------------

  private syncTrack(force = false): void {
    const b = this.board;
    const key = JSON.stringify([b.ends, b.opened === 'circuit']);
    if (!force && key === this.trackKey) return;
    const had = new Set(this.cellGroups.keys());
    const fresh = this.trackKey !== '' && !force;
    this.trackKey = key;
    this.path = TrackPath.fromBoard(b);
    for (const g of this.cellGroups.values()) {
      this.trackGroup.remove(g);
      g.traverse((o) => (o as Mesh).geometry?.dispose());
    }
    this.cellGroups.clear();
    const look = this.island!.look;
    this.path.cells.forEach((c, i) => {
      const parts = buildCellTrack(this.path, i, { support: look.support, tie: look.tie });
      const g = new Group();
      for (const [k, mat] of [['gloss', MATS.gloss], ['matte', MATS.matte]] as const) {
        const geo = parts[k];
        if (!geo || geo.empty) continue;
        const m = new Mesh(geo.build(), mat);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      }
      if (parts.glow && !parts.glow.empty) {
        const m = new Mesh(parts.glow.build(), GLOW_MAT);
        m.layers.set(GLOW_LAYER);
        m.layers.enable(BLOOM_LAYER);
        g.add(m);
      }
      const k = `${c.x},${c.y}`;
      if (fresh && !had.has(k)) this.riseAt.set(k, this.now);
      this.cellGroups.set(k, g);
      this.trackGroup.add(g);
    });
  }

  private drawTrackRise(): void {
    for (const [k, t0] of this.riseAt) {
      const g = this.cellGroups.get(k);
      const t = Math.min(1, (this.now - t0) / 420);
      if (!g || t >= 1) {
        if (g) {
          g.scale.set(1, 1, 1);
          g.position.set(0, 0, 0);
        }
        this.riseAt.delete(k);
        continue;
      }
      // Pops up out of the ground with a little overshoot.
      const c = 1.7;
      const e = 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
      const [x, y] = k.split(',').map(Number);
      g.position.set((x + 0.5) * (1 - e), 0, (y + 0.5) * (1 - e));
      g.scale.set(e, Math.max(0.01, e), e);
    }
  }

  // ---- Crates ---------------------------------------------------------------------

  private crate(tier: number, x: number, z: number, cellI: number, flash = 0, lift = 0, squash = 0): void {
    const m = this.crates.get();
    const fog = this.fogged.has(cellI);
    m.geometry = fog ? mysteryGeo() : crateGeo(tier);
    const pop = 1 + flash * 0.22;
    m.position.set(x + 0.5, GRASS_Y + lift, z + 0.5);
    m.scale.set(pop * (1 + squash), pop * (1 - squash * 1.5), pop * (1 + squash));
    const mat = m.material as ReturnType<typeof toon>;
    mat.emissive.setScalar(flash * 0.9);
  }

  private drawCrates(): void {
    const b = this.board;
    const a = this.tileAnim;
    if (!a) {
      for (let y = 0; y < b.size; y++)
        for (let x = 0; x < b.size; x++) {
          const i = idx(b, x, y);
          const t = b.tiles[i];
          if (!t) continue;
          this.crate(t, x, y, i, this.flashAt(i));
          if (t === 7 && Math.random() < 0.04 && !this.fogged.has(i)) this.sparks.add({ p: v3(x + 0.2 + Math.random() * 0.6, CRATE_H + 0.1 + Math.random() * 0.25, y + 0.2 + Math.random() * 0.6), v: v3(0, 0.25, 0), g: 0, max: 0.5, color: '#fff6c8', size: 0.03, drag: 0 });
        }
      return;
    }
    const el = this.now - a.start;
    const mv = a.move;
    const ease = (t: number) => 1 - (1 - t) * (1 - t);
    if (el < SLIDE_MS) {
      const e = ease(el / SLIDE_MS);
      for (const s of mv.slides) {
        const x = s.from.x + (s.to.x - s.from.x) * e;
        const y = s.from.y + (s.to.y - s.from.y) * e;
        this.crate(s.tier, x, y, idx(b, s.to.x, s.to.y), 0, 0, Math.sin(e * Math.PI) * 0.06);
      }
      return;
    }
    const k = Math.floor((el - SLIDE_MS) / WAVE_MS);
    const e = ease(((el - SLIDE_MS) % WAVE_MS) / (WAVE_MS * 0.6));
    const base = k === 0 ? mv.slid : mv.chain.frames[k - 1];
    const wave: ChainStep[] = mv.chain.waves[k] ?? [];
    const busy = new Set(wave.flatMap((w) => [idx(b, w.from.x, w.from.y), idx(b, w.to.x, w.to.y)]));
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        const i = idx(b, x, y);
        if (base[i] && !busy.has(i)) this.crate(base[i], x, y, i, this.flashAt(i));
      }
    for (const w of wave) {
      const ti = idx(b, w.to.x, w.to.y);
      this.crate(w.tier - 1, w.to.x, w.to.y, ti);
      const t = Math.min(1, e);
      const x = w.from.x + (w.to.x - w.from.x) * t;
      const y = w.from.y + (w.to.y - w.from.y) * t;
      // The grabbed tile hops over into the merged one.
      this.crate(w.tier - 1, x, y, ti, 0, Math.sin(t * Math.PI) * 0.45);
    }
  }

  private flashAt(i: number): number {
    const until = this.flashes.get(i) ?? 0;
    return until > this.now ? Math.min(1, (until - this.now) / 160) : 0;
  }

  /** Fires sounds, bursts and the combo counter as the animation reaches each stage. */
  private fireTileEffects(): void {
    const a = this.tileAnim;
    if (!a) return;
    const m = a.move;
    const el = this.now - a.start;
    const stage = el < SLIDE_MS ? -1 : Math.min(m.chain.waves.length, Math.floor((el - SLIDE_MS) / WAVE_MS) + 1);
    const done = el >= SLIDE_MS + m.chain.waves.length * WAVE_MS;
    while (a.fired < stage) {
      a.fired++;
      const b = this.board;
      if (a.fired === 0) {
        m.merges.forEach((mg, i) => {
          this.flashes.set(idx(b, mg.x, mg.y), this.now + 160);
          this.burst(this.cell(mg).setY(0.3), 10, TIER_RAMPS[mg.tier]);
          sfx.merge(i + 1);
        });
        if (m.merges.length) this.bumpCombo(m.merges.length);
        if (!m.chain.waves.length) this.finishMove(m);
      } else {
        const wave = m.chain.waves[a.fired - 1];
        const link = a.fired;
        for (const w of wave) {
          this.flashes.set(idx(b, w.to.x, w.to.y), this.now + 200);
          this.burst(this.cell(w.to).setY(0.35), 14 + link * 6, TIER_RAMPS[w.tier]);
        }
        this.word(`CHAIN ${link + 1}`, this.cell(wave[0].to).setY(0.9), PAL.gold, 1 + link * 0.12);
        this.kick(Math.min(3, link), 140 + link * 40);
        sfx.chain(m.merges.length + link);
        this.bumpCombo((this.combo?.value ?? m.merges.length) + wave.length);
        if (a.fired === m.chain.waves.length) this.finishMove(m);
      }
    }
    if (done) this.tileAnim = null;
  }

  private finishMove(m: MoveResult): void {
    for (const s of m.spawned) this.flashes.set(idx(this.board, s.x, s.y), this.now + 140);
    for (const k of m.sunk) {
      const c = this.cell(k);
      this.dust(c.clone().setY(0.05), 10, this.theme.soft[2]);
      if (!k.tier) this.word('GLUB', c.clone().setY(0.6), this.theme.soft[0]);
    }
    if (m.sunk.length) sfx.meh();
    if (m.chain.waves.length) sfx.hype();
  }

  private bumpCombo(value: number): void {
    if (value < 2) return;
    this.combo = { value, bumped: this.now, until: this.now + 900 + value * 120 };
    const el = this.comboEl;
    if (!el) return;
    el.textContent = `${value >= 6 ? 'Mega' : 'Combo'} ×${value}`;
    el.dataset.level = value >= 6 ? 'mega' : value >= 4 ? 'big' : 'small';
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  private drawCombo(): void {
    const el = this.comboEl;
    if (!el) return;
    const c = this.combo;
    const visible = !!c && this.now < c.until;
    el.classList.toggle('show', visible);
    if (!c || !visible) return;
    const p = this.local(v3(this.n / 2, 0.4, this.n / 2));
    el.style.left = `${this.canvas.offsetLeft + p.x}px`;
    el.style.top = `${this.canvas.offsetTop + p.y}px`;
    const k = c.value >= 6 ? 0.17 : c.value >= 4 ? 0.15 : 0.13;
    el.style.fontSize = `${Math.round(this.cssW * 0.62 * k)}px`;
  }

  /** World point to CSS pixels inside the canvas box. */
  private local(v: Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.cssW, y: ((1 - p.y) / 2) * this.cssH };
  }

  private drawWords(): void {
    const off = { x: this.canvas.offsetLeft, y: this.canvas.offsetTop };
    this.words = this.words.filter((w) => {
      const age = this.now - w.born;
      if (age > w.max) {
        w.el.remove();
        return false;
      }
      const p = this.local(w.at);
      const rise = Math.min(1, age / 300) * 14;
      w.el.style.transform = `translate(${off.x + p.x}px, ${off.y + p.y - rise}px) translate(-50%, -50%)`;
      w.el.style.opacity = String(Math.min(1, (w.max - age) / 250));
      return true;
    });
    const b = this.board;
    const showGo = this.game.phase === 'build' && canConnect(b) && this.path.pts.length > 1;
    this.goEl.hidden = !showGo;
    if (showGo) {
      const a = this.path.pts[0].p;
      const c = this.path.pts[this.path.pts.length - 1].p;
      const p = this.local(a.clone().add(c).multiplyScalar(0.5).setY(Math.max(a.y, c.y) + 0.75));
      const bob = Math.sin(this.now / 180) * 3;
      this.goEl.style.transform = `translate(${off.x + p.x}px, ${off.y + p.y + bob}px) translate(-50%, -50%)`;
    }
  }

  // ---- Build targets and track ends ---------------------------------------------

  private drawTargets(): void {
    const build = this.game.phase === 'build';
    for (const p of this.pennants) p.visible = false;
    if (!build) return;
    const b = this.board;
    const blink = Math.floor(this.now / 300) % 2 === 0;
    const pulse = 0.55 + Math.sin(this.now / 160) * 0.25;
    const sel = this.game.selected;
    const mark = (x: number, y: number, color: string, strong: boolean) => {
      const m = this.markers.get();
      const i = idx(b, x, y);
      const top = b.tiles[i] ? CRATE_H + 0.012 : 0.012;
      const hov = !!this.hover && this.hover.x === x && this.hover.y === y;
      m.position.set(x + 0.5, GRASS_Y + top, y + 0.5);
      const s = (strong ? 1 : 0.94) * (hov ? 1.06 : 1) * (b.tiles[i] ? 0.98 : 1);
      m.scale.set(s, 1, s);
      const mat = m.material as MeshBasicMaterial;
      mat.color.set(color);
      mat.opacity = hov ? 1 : strong ? pulse + 0.2 : 0.55;
    };
    const aim = this.game.aiming;
    if (aim) {
      for (let y = 0; y < b.size; y++)
        for (let x = 0; x < b.size; x++) {
          const i = idx(b, x, y);
          const tile = b.tiles[i];
          const wall = isWall(b, x, y);
          const ok = aim.tool === 'dynamite' ? !!b.obstacles[i] : aim.tool === 'paint' ? !!tile && tile < 7 && !wall : aim.first ? !wall : !!tile && !wall;
          if (ok) mark(x, y, blink ? PAL.heart : PAL.white, true);
        }
      if (aim.first) mark(aim.first.x, aim.first.y, PAL.gold, true);
      return;
    }
    const targets = buildTargets(b);
    for (const t of targets.filter((t) => t.end !== sel)) mark(t.x, t.y, END_COLORS[t.end], false);
    for (const t of targets.filter((t) => t.end === sel)) mark(t.x, t.y, blink ? PAL.gold : PAL.white, true);
    // Pennants on each open end; the selected one waves harder.
    const pts = this.path.pts;
    if (this.path.closed || pts.length < 2) return;
    for (const end of [0, 1] as End[]) {
      const q = end === 0 ? pts[pts.length - 1] : pts[0];
      const p = this.pennants[end];
      p.visible = true;
      p.position.copy(q.p);
      p.scale.setScalar(end === sel ? 1.25 : 1);
      const flag = p.children[1];
      flag.rotation.y = Math.sin(this.now / (end === sel ? 110 : 260) + end) * (end === sel ? 0.5 : 0.25) + (end === 0 ? Math.PI : 0);
    }
  }

  // ---- People ------------------------------------------------------------------------

  /** Places a guest. Feet at `at` (or by pose.matrix). */
  person(look: Rider['look'], at: Vector3 | null, pose: Pose = {}): Rig {
    const rig = this.people.get();
    const g = personGeo(look, pose.face ?? 'smile', !!pose.seated);
    rig.body.geometry = g.body;
    rig.armL.geometry = g.arm;
    rig.armR.geometry = g.arm;
    rig.legL.visible = rig.legR.visible = !!g.leg;
    if (g.leg) {
      rig.legL.geometry = g.leg;
      rig.legR.geometry = g.leg;
    }
    const walk = pose.walk;
    const sw = walk === undefined ? 0 : Math.sin(walk);
    const bob = walk === undefined ? 0 : Math.abs(Math.cos(walk)) * 0.03;
    rig.body.position.set(0, bob, 0);
    rig.legL.position.set(-g.hipX, g.hipY, 0);
    rig.legR.position.set(g.hipX, g.hipY, 0);
    rig.legL.rotation.x = sw * 0.6;
    rig.legR.rotation.x = -sw * 0.6;
    const up = pose.arms ?? 0;
    rig.armL.position.set(-g.shoulderX, g.shoulderY + bob, 0);
    rig.armR.position.set(g.shoulderX, g.shoulderY + bob, 0);
    const wave = Math.sin(this.now / 90 + g.shoulderX * 50) * 0.2 * up;
    rig.armL.rotation.set(-sw * 0.7, 0, -(0.18 + up * 2.6 + wave));
    rig.armR.rotation.set(sw * 0.7, 0, 0.18 + up * 2.6 - wave);
    if (pose.matrix) {
      rig.matrixAutoUpdate = false;
      rig.matrix.copy(pose.matrix).multiply(new Matrix4().makeScale(g.scale, g.scale, g.scale));
      rig.matrixWorldNeedsUpdate = true;
    } else {
      rig.matrixAutoUpdate = true;
      rig.position.copy(at!);
      rig.rotation.set(0, pose.yaw ?? 0, (pose.wobble ?? 0) * Math.sin(this.now / 140));
      rig.scale.setScalar(g.scale * STAND_SCALE);
    }
    return rig;
  }

  bubble(mood: string, at: Vector3): void {
    const s = this.bubbles.get();
    s.material = bubbleMaterial(mood);
    s.position.copy(at);
  }

  private drawQueue(dt: number): void {
    if (this.game.phase !== 'build' && this.game.phase !== 'intro') return;
    const queue = this.game.queue;
    queue.forEach((r, i) => {
      const target = this.slot(i);
      let p = this.riderPos.get(r.id);
      if (!p) {
        p = { x: target.x, z: target.z, moving: false, ph: 0 };
        this.riderPos.set(r.id, p);
      }
      let yaw = 0;
      if (dt > 0) {
        const dx = target.x - p.x;
        const dz = target.z - p.z;
        const dist = Math.hypot(dx, dz);
        const step = 1.4 * dt;
        p.moving = dist > 0.01;
        if (dist <= step) {
          p.x = target.x;
          p.z = target.z;
        } else {
          p.x += (dx / dist) * step;
          p.z += (dz / dist) * step;
          yaw = Math.atan2(dx, dz);
        }
        if (p.moving) p.ph += dt * 14;
      }
      const sick = this.game.phase === 'build' && this.game.pukes(r) > 0;
      const rig = this.person(r.look, v3(p.x, 0, p.z), { walk: p.moving ? p.ph : undefined, yaw, face: sick ? 'meh' : 'smile' });
      // An idle hop now and then, so the line feels alive.
      if (!p.moving) rig.position.y = Math.max(0, Math.sin(this.now / 260 + r.id * 1.7) - 0.93) * 0.35;
      if (this.game.phase === 'build' && !p.moving) {
        const g = personGeo(r.look, 'smile');
        this.bubble(sick ? 'sick' : 'meh', v3(p.x, g.headY * g.scale * STAND_SCALE + 0.05, p.z));
      }
    });
  }

  private updateWalkers(dt: number): void {
    for (const w of this.walkers) {
      if (w.delay > 0) {
        w.delay -= dt * 1000;
        this.person(w.look, v3(w.x, 0, w.z), { face: w.sick ? 'sick' : 'smile' });
        continue;
      }
      const dx = w.tx - w.x;
      const dz = w.tz - w.z;
      const dist = Math.hypot(dx, dz);
      const s = w.speed * dt;
      if (dist <= s) {
        w.x = w.tx;
        w.z = w.tz;
      } else {
        w.x += (dx / dist) * s;
        w.z += (dz / dist) * s;
      }
      const arrived = w.x === w.tx && w.z === w.tz;
      w.ph = (w.ph ?? 0) + dt * 14;
      const puking = (w.pukeUntil ?? 0) > this.gameNow;
      const rig = this.person(w.look, v3(w.x, 0, w.z), {
        walk: arrived ? undefined : w.ph,
        yaw: arrived ? 0 : Math.atan2(dx, dz),
        face: w.sick ? 'sick' : 'smile',
        wobble: w.sick && !puking ? 0.12 : 0,
        arms: puking ? 0.35 : 0,
      });
      if (puking) rig.rotation.x = 0.45;
      if (w.mood) {
        const g = personGeo(w.look, 'smile');
        this.bubble(w.mood, v3(w.x, g.headY * g.scale * STAND_SCALE + 0.05, w.z));
      }
    }
    this.walkers = this.walkers.filter((w) => w.hold || !(w.x === w.tx && w.z === w.tz));
  }

  // ---- Train -------------------------------------------------------------------------

  /** Places one car on the track at arc length s, with its rider (if any). */
  car(kind: CarKind, s: number, rider?: { look: Rider['look']; face: Face; arms: number }): { head: Vector3; fwd: Vector3; up: Vector3 } {
    const f = this.path.sample(s);
    const m = new Matrix4().makeBasis(f.right, f.up, f.t).setPosition(f.p.clone().addScaledVector(f.up, 0.02));
    const c = this.cars.get();
    c.geometry = carGeo(kind);
    c.matrix.copy(m);
    c.matrixWorldNeedsUpdate = true;
    let head = f.p.clone().addScaledVector(f.up, 0.3);
    if (rider) {
      const seat = new Matrix4().copy(m).multiply(M(0, 0.075, -0.025)).multiply(new Matrix4().makeScale(0.8, 0.8, 0.8));
      this.person(rider.look, null, { seated: true, matrix: seat, face: rider.face, arms: rider.arms });
      const g = personGeo(rider.look, rider.face, true);
      head = v3(0, (g.headY - 0.03) * g.scale, 0.09 * g.scale).applyMatrix4(seat);
    }
    return { head, fwd: f.t, up: f.up };
  }

  private drawParkedTrain(): void {
    if (!this.path || this.path.pts.length < 2) return;
    const lead = parkS(this.path, this.board);
    const u0 = this.path.range(this.path.indexOf(this.board.station.x + 1, this.board.station.y))[0];
    const fit = Math.max(1, Math.floor((lead - u0 - 0.1) / CAR_GAP) + 1);
    const n = Math.max(2, Math.min(fit, Math.max(3, this.game.queue.length), 5));
    for (let i = 0; i < n; i++) this.car(i === 0 ? 'lead' : i === n - 1 ? 'tail' : 'mid', lead - i * CAR_GAP);
  }

  private rebuildPuddles(): void {
    this.puddleDirty = false;
    if (this.puddleMesh) {
      this.dyn.remove(this.puddleMesh);
      this.puddleMesh.geometry.dispose();
      this.puddleMesh = null;
    }
    if (!this.puddles.length) return;
    this.puddleMesh = new Mesh(puddleGeo(this.puddles).build(), MATS.gloss);
    this.puddleMesh.receiveShadow = true;
    this.dyn.add(this.puddleMesh);
  }

  /**
   * Slow motion with a push-in on something, like a product video. `ms` is real
   * time; `slow` is the time scale at full effect; `zoom` scales the camera distance.
   */
  dramatic(at: () => Vector3, ms: number, zoom = 0.35, slow = 0.15): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (!this.shot) {
      sfx.slowIn();
      this.shotAt.copy(at());
    }
    this.shot = { at, start: this.now, until: this.now + ms, zoom, slow, yaw: (Math.random() < 0.5 ? -1 : 1) * (0.22 + Math.random() * 0.12) };
  }

  get inShot(): boolean {
    return !!this.shot;
  }

  /** Cinema bars over the canvas while a shot plays. */
  private drawBars(): void {
    const h = this.cssH * 0.085 * this.cine;
    this.bars.forEach((b, i) => {
      b.style.left = `${this.canvas.offsetLeft}px`;
      b.style.width = `${this.cssW}px`;
      b.style.height = `${h}px`;
      b.style.top = i === 0 ? `${this.canvas.offsetTop}px` : `${this.canvas.offsetTop + this.cssH - h}px`;
      b.style.display = h > 0.5 ? 'block' : 'none';
    });
  }

  /** Riders get off and line up in front of the station for the curtain call. */
  disembark(tickets: { rider: Rider; pukes: number }[]): void {
    const sc = this.stationCenter();
    const n = tickets.length;
    const perRow = Math.min(n, Math.max(4, Math.floor((this.n + 0.8) / 0.34)));
    this.lineup = [];
    tickets.forEach(({ rider, pukes }, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, n - row * perRow);
      const k = i % perRow;
      let tx = sc.x + (k - (inRow - 1) / 2) * 0.34 + row * 0.17;
      tx = Math.max(-0.35, Math.min(this.n + 0.35, tx));
      const w: Walker = {
        look: rider.look,
        x: sc.x,
        z: sc.z,
        tx,
        tz: this.board.station.y + 1.35 + row * 0.42,
        speed: 1.3,
        sick: pukes > 0,
        delay: i * 90,
        hold: true,
      };
      this.lineup.push(w);
      this.addWalker(w);
    });
  }

  /** Head of the i-th rider in the lineup. */
  lineupHead(i: number): Vector3 {
    const w = this.lineup[i];
    if (!w) return this.stationCenter().setY(0.5);
    const g = personGeo(w.look, 'sick');
    return v3(w.x, g.headY * g.scale * STAND_SCALE - 0.02, w.z + 0.08);
  }

  /** The i-th rider in the lineup doubles over and pukes. */
  lineupPuke(i: number, n: number): void {
    const w = this.lineup[i];
    if (!w) return;
    w.pukeUntil = this.gameNow + 700;
    w.sick = true;
    this.puke(this.lineupHead(i), n, undefined, v3(0, 0.1, 1));
  }

  /** The curtain call is over: everyone heads for the exits. */
  dismiss(): void {
    this.lineup.forEach((w, i) => {
      w.hold = false;
      const side = w.x < this.stationCenter().x ? -1 : 1;
      w.tx = w.x + side * (1.4 + Math.random() * 0.8);
      w.tz = w.z + 0.4 + Math.random() * 0.4;
      w.speed = 0.8 + Math.random() * 0.3;
      w.delay = i * 60;
      w.mood = w.sick ? (Math.random() < 0.5 ? 'sick' : 'happy') : 'meh';
    });
    this.lineup = [];
  }
}

// ---- Small builders ----------------------------------------------------------------

function paintSign(x: CanvasRenderingContext2D): void {
  x.clearRect(0, 0, 512, 156);
  x.fillStyle = '#ffd23f';
  x.beginPath();
  x.roundRect(6, 6, 500, 144, 30);
  x.fill();
  x.lineWidth = 10;
  x.strokeStyle = '#9a5a1c';
  x.stroke();
  x.fillStyle = '#f0584e';
  x.font = '400 78px Bungee, "Arial Black", Impact, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 14;
  x.strokeStyle = '#2b2140';
  x.lineJoin = 'round';
  x.strokeText('LOOPHOLE', 256, 84);
  x.fillText('LOOPHOLE', 256, 84);
}

function signTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 156;
  const x = c.getContext('2d')!;
  paintSign(x);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  // Repaint once the sign font arrives.
  document.fonts
    ?.load('78px Bungee')
    .then(() => {
      paintSign(x);
      t.needsUpdate = true;
    })
    .catch(() => {});
  return t;
}

function pennant(color: string): Group {
  const g = new Group();
  const pole = new Geo();
  pole.post(0, 0, 0, 0.012, 0.52, '#2b2140', 6);
  pole.sphere(v3(0, 0.53, 0), 0.02, PAL.gold, 1, 1, 1, 6, 4, true);
  g.add(new Mesh(pole.build(), MATS.matte));
  const flag = new Geo();
  flag.tri(v3(0, 0.5, 0), v3(0, 0.36, 0), v3(0.2, 0.43, 0), color, v3(0, 0.43, -1));
  flag.tri(v3(0, 0.5, 0), v3(0, 0.36, 0), v3(0.2, 0.43, 0), color, v3(0, 0.43, 1));
  g.add(new Mesh(flag.build(), MATS.cloth));
  g.traverse((o) => (o.castShadow = true));
  return g;
}

let mistTex: CanvasTexture | null = null;
function makeMist(): Sprite {
  if (!mistTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const r = rng(5);
    for (let k = 0; k < 7; k++) {
      const cx = 16 + r() * 32;
      const cy = 20 + r() * 24;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, 18);
      g.addColorStop(0, 'rgba(230,226,255,0.55)');
      g.addColorStop(1, 'rgba(230,226,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
    }
    mistTex = new CanvasTexture(c);
    mistTex.colorSpace = SRGBColorSpace;
  }
  const s = new Sprite(new SpriteMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.85 }));
  s.layers.set(GLOW_LAYER);
  s.renderOrder = 6;
  return s;
}

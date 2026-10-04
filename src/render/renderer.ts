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
import { music } from '../core/music';
import { sfx } from '../core/sfx';
import type { Game, GameEvent } from '../game';
import {
  type Board,
  type ChainStep,
  type Dir,
  type End,
  type SwipeResult as MoveResult,
  type Eaten,
  type Pt,
  DELTA,
  DIRS,
  buildTargets,
  bulgeFor,
  canConnect,
  head,
  idx,
  inBounds,
  isWall,
  rideOrder,
  samePt,
  step,
  trackAt,
} from '../puzzle/board';
import { type Mouth, makeBead, makeChevron, makeMouth, makeOutline } from '../render3d/mouths';
import { RideAnim, parkS } from '../ride/ride';
import type { Rider } from '../riders/riders';
import { Geo, rng, shade, v3 } from '../render3d/geo';
import { GLOW_MAT, GRASS_Y, type Island, WATER_Y, buildIsland } from '../render3d/island';
import { type CarKind, CRATE_H, FLAVOR_COLORS, FLAVOR_PIVOT, type Face, M, type Parts, carGeo, crateGeo, flavorAnimGeo, flavorBaseGeo, mysteryGeo, personGeo, rope } from '../render3d/models';
import { type Flavor, PIECES, SPECIALS } from '../puzzle/pieces';
import { Particles, Pool, bubbleMaterial, makeBubble, makeMarker, puddleGeo } from '../render3d/fx';
import { BLOOM_LAYER, GLOW_LAYER, Post } from '../render3d/post';
import { MATS, SHARED, toon } from '../render3d/toon';
import { FLAT, type Terrain, hillGeo, makeTerrain } from '../render3d/terrain';
import { attractionGroup, busGroup, upgradeGroup } from '../render3d/structures';
import { ATTRACTIONS } from '../run/attractions';
import { TrackPath, stationLayout } from '../render3d/track';
import { buildCellTrack } from '../render3d/trackmesh';
import { composeCard, photoStore } from '../ui/photo';
import { ScoreShow } from '../ui/scoreshow';
import { PAL, type ParkTheme, SHIRTS, THEMES, TIER_RAMPS } from './palette';
import { lineAntics, lineFace } from './moods';
import { lineThought, rideThought } from '../riders/thoughts';

// The park as a little 3D diorama: cel-shaded, ink-lined, procedurally built
// each day. It only presents: all rules live in the game.

const SLIDE_MS = 100;
/** An eaten tile squashes down into the track over this long, after its slide. */
const GULP_MS = 260;
/** After gridlock, the jam gets its moment before the ride rolls. */
const GRIDLOCK_MS = 1500;
const WAVE_MS = 170;
/** Pennant colors for the two track ends. */
const END_COLORS = ['#f0584e', '#45a8e0'];
const PITCH = (43 * Math.PI) / 180;
const FOV = 30;
export const CAR_GAP = 0.32;
/** One stop-motion frame (12 a second). */
const STOP_MS = 1000 / 12;
/** Cars (and their riders) are drawn this much larger than the model. */
const CAR_SCALE = 1.05;
/** Guests on foot are drawn a little larger than riders, so the crowd reads. */
const STAND_SCALE = 1.3;
/** The queue starts beside the station's sign, not in front of it. */
const QUEUE_START = 0.7;
/** Attraction landmarks are built at toy scale and shown bigger. */
const STRUCT_SCALE = 1.6;
/** Depth of the stairs up to a raised station. */
const STAIRS = 0.42;
/** How far below the rail a hanging car rides. */
const HANG_DROP = 0.44;
/**
 * A suspended car's hanger, in the car's frame: unit height, from the car (y = 0)
 * up to the rail (y = 1); the car's matrix scales it to the real drop.
 */
function hangerGeo(): ReturnType<Geo['build']> {
  const g = new Geo();
  const iron = '#3c3550';
  // A post up the back of the car (clear of the rider's head), then a yoke over to the rail's bogie.
  g.beam(v3(0, 0.22, -0.15), v3(0, 1.0, -0.15), 0.034, iron, 0.03);
  g.beam(v3(0, 0.98, -0.15), v3(0, 0.98, 0.04), 0.04, iron, 0.034);
  g.beam(v3(0, 0.24, -0.15), v3(0, 0.2, -0.1), 0.03, iron, 0.03);
  g.beam(v3(0, 1.0, -0.06), v3(0, 1.0, 0.06), 0.07, '#2b2140', 0.05);
  return g.build();
}

/** Flume water on the track: glossy, a touch see-through. */
const FLUME_MAT = toon({ gloss: 1, rim: 0.7, transparent: true, opacity: 0.88, lump: 0.004 });

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
  /** Who it is and how the ride went (the curtain call). */
  rider?: Rider;
  pukes?: number;
  /** How they leave: queue for the porta-potty, run back for another go, or float off (ghosts). */
  exit?: 'potty' | 'again' | 'float';
  /** Height floated so far (ghosts). */
  fly?: number;
  /** Gone into the porta-potty. */
  gone?: boolean;
}

/** A slow-motion camera shot on something (a rider, the lead car). */
interface Shot {
  at: () => Vector3;
  /** A big shout stretched across the shot. */
  caption?: string;
  start: number;
  until: number;
  zoom: number;
  slow: number;
  yaw: number;
}

interface Word {
  base?: string;
  count?: number;
  el: HTMLElement;
  at: Vector3;
  born: number;
  max: number;
}

/** A guest's rig: body, two arms and two legs, sharing cached geometry. */
class Rig extends Group {
  body = new Mesh(undefined, MATS.figure);
  armL = new Mesh(undefined, MATS.figure);
  armR = new Mesh(undefined, MATS.figure);
  legL = new Mesh(undefined, MATS.figure);
  legR = new Mesh(undefined, MATS.figure);
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
  /** The OPEN ME tag between the two ends was clicked. */
  onOpenMe: () => void = () => {};
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
  /** The on-ride camera's flash: always in the scene (so no shader recompiles), lit only for the photo. */
  private rush = 0;
  /** What you've bought, standing in the park: attraction landmarks, upgrade props, tour buses. */
  private structures = new Group();
  private structKey = '';
  private attrLots: Group[] = [];
  private attrPulse: number[] = [];
  private stationGroup: Group | null = null;
  /** A new thing unlocked (the page shows a toast). */
  onUnlock: (id: string) => void = () => {};
  /** Hills on the board and the station's height (later parks). */
  terrain: Terrain = FLAT;
  private flashLight = new PointLight('#fff6ea', 0, 4, 2);
  private trackKey = '';
  private cellGroups = new Map<string, Group>();
  private riseAt = new Map<string, number>();
  private crates: Pool<Mesh>;
  /** The arms suspended cars hang from. */
  private hangers: Pool<Mesh>;
  /** Chain cells of the track that are flumes (their water foams along). */
  private flumes: number[] = [];
  /** Park-piece badges on flavored crates: a static part and a moving part. */
  private decos: Pool<Group>;
  private people: Pool<Rig>;
  private cars: Pool<Mesh>;
  private markers: Pool<Mesh>;
  private bubbles: Pool<Sprite>;
  private mists: Pool<Sprite>;
  /** The two open ends of the track: hungry clay mouths (red end 0, blue end 1). */
  private mouths: (Mouth & { from: Vector3; to: Vector3; hopAt: number; hold: number; yaw: number; open: number; chompAt: number; ready: boolean })[] = [];
  private chevrons: Pool<Mesh>;
  private outlines: Pool<Mesh>;
  private beads: Pool<Mesh>;
  /** What the swipe being dragged would feed into the track. */
  private preview: { dir: Dir; eats: Eaten[]; at: number } | null = null;
  private previewTags: HTMLElement[] = [];
  /** Eaten tiles squashing into the track. */
  private gulps: { tier: number; flavor: Flavor | null; at: Pt; end: End; start: number }[] = [];
  /** Track cells that wait for their tile to arrive before they rise ("x,y" to time). */
  private eatHold = new Map<string, number>();
  private eatenCells = new WeakSet<object>();
  private gridlockAt = -1e9;
  private wobbleUntil = 0;
  /** The ride opened by gridlock: it waits a beat before rolling. */
  private ridePending = false;
  /** A mouth is mid-hop or mid-gulp (the OPEN ME tag waits for them). */
  private mouthsBusy = false;
  private goSince = -1;
  readonly particles: Particles;
  private sparks: Particles;
  private later: { at: number; fn: () => void }[] = [];
  private compact = false;
  private puddles: { x: number; y: number; z: number; r: number; seed: number }[] = [];
  private puddleMesh: Mesh | null = null;
  private puddleDirty = false;
  private tileAnim: { start: number; move: MoveResult; fired: number } | null = null;
  /** Ivy's waves play after the swipe that set them off. */
  private waveQueue: { move: MoveResult; dir: Dir }[] = [];
  private waveNext: Dir | null = null;
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
  /** The HOME tag over the blue pad, where the red mouth has to come back to. */
  private homeEl: HTMLDivElement;
  private hover: Pt | null = null;
  private base = { target: new Vector3(), dist: 12 };
  /** The screen area the HUD leaves free (CSS pixels in the canvas). */
  private safe = { x0: 0, x1: 1, y0: 0, y1: 1 };
  private cssW = 1;
  private cssH = 1;
  private follow = { w: 0, at: new Vector3() };
  private flash = 0;
  private dusk = 0;
  private stationSign: Mesh | null = null;
  /** Stop-motion stepping is opt-in (?stopmotion); by default every frame renders. */
  private smooth = !new URLSearchParams(location.search).has('stopmotion');
  private lastShot = -1e9;
  /** How far away the camera is focused. */
  private focusD = 12;
  /** The game clock: runs slower during slow motion (the ride, particles, walkers). */
  gameNow = 0;
  private shot: Shot | null = null;
  private shotAt = new Vector3();
  private shotYaw = 0;
  private shotZoom = 0.4;
  private cine = 0;
  /** After a shot, time runs fast for a moment (the speed ramp snapping back). */
  private snapUntil = 0;
  private caption: HTMLDivElement;
  private beat = 0;
  private photoReq: { due: number; pose: () => { eye: Vector3; look: Vector3; up: Vector3; splat?: boolean } } | null = null;
  private polaroid: HTMLDivElement | null = null;
  private bars: HTMLDivElement[] = [];
  /** Riders lined up after the ride, by car index. */
  private lineup: Walker[] = [];
  /** The always-running ride (v0.23): the parked train's position in stops (0 = the station), and the stops' cells. */
  private loopTrain = { shown: 0, keys: [] as string[] };
  /** Laps waiting for the train to come round, then paying out (riders stay seated until they get off). */
  private laps: { e: Extract<GameEvent, { type: 'lap' }>; riders: Rider[]; at: number; paying: boolean }[] = [];
  /** Who sits in the parked train's cars right now, and where their heads are. */
  private seatRiders: Rider[] = [];
  private seatPts: { head: Vector3; mouth: Vector3; fwd: Vector3; carry: Vector3 }[] = [];
  /** Close the park: the train rolls home to the station first, then this starts the ride. */
  private homeRun: (() => void) | null = null;
  /** A lap paid out (the HUD ticks its bank up). */
  onLap: (lap: number, total: number, bossHits: number) => void = () => {};
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
    this.show.onAttraction = (slot) => this.pulseAttraction(slot);
    this.scene.add(this.world, this.dyn, this.trackGroup);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.015;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.add(this.flashLight);
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
    this.decos = new Pool(this.dyn, () => {
      const grp = new Group();
      for (let k = 0; k < 2; k++) {
        const m = new Mesh(undefined, MATS.gloss);
        m.castShadow = true;
        grp.add(m);
      }
      return grp;
    });
    this.people = new Pool(this.dyn, () => new Rig());
    this.cars = new Pool(this.dyn, () => {
      const m = new Mesh(undefined, MATS.gloss);
      m.castShadow = true;
      m.matrixAutoUpdate = false;
      return m;
    });
    this.hangers = new Pool(this.dyn, () => {
      const m = new Mesh(hangerGeo(), MATS.gloss);
      m.castShadow = true;
      m.matrixAutoUpdate = false;
      return m;
    });
    this.markers = new Pool(this.dyn, makeMarker);
    this.bubbles = new Pool(this.dyn, makeBubble);
    this.mists = new Pool(this.dyn, makeMist);
    for (const end of [0, 1]) {
      const m = makeMouth(END_COLORS[end]);
      this.dyn.add(m.group);
      m.group.visible = false;
      this.mouths.push({ ...m, from: new Vector3(), to: new Vector3(), hopAt: 0, hold: 0, yaw: 0, open: 0, chompAt: -1e9, ready: false });
    }
    this.chevrons = new Pool(this.dyn, makeChevron);
    this.outlines = new Pool(this.dyn, makeOutline);
    this.beads = new Pool(this.dyn, makeBead);
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
    this.goEl.textContent = 'OPEN ME!';
    this.goEl.title = 'The ends meet: open the full circuit';
    this.goEl.addEventListener('click', () => this.onOpenMe());
    this.wordLayer.append(this.goEl);
    this.homeEl = document.createElement('div');
    this.homeEl.className = 'home3d';
    this.homeEl.textContent = 'HOME';
    this.wordLayer.append(this.homeEl);
    for (let k = 0; k < 2; k++) {
      const t = document.createElement('div');
      t.className = 'eat-tag';
      t.hidden = true;
      this.wordLayer.append(t);
      this.previewTags.push(t);
    }
    this.caption = document.createElement('div');
    this.caption.className = 'slowcap';
    this.wordLayer.append(this.caption);
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
    return x >= 0 && x <= this.n && z >= 0 && z <= this.n ? GRASS_Y + this.terrain.height(x, z) : this.floorY(x, z);
  }

  /** Floor height off the board: the plaza, or the raised station deck and its stairs. */
  floorY(x: number, z: number): number {
    const lift = this.terrain.lift;
    if (!lift) return 0;
    const L = stationLayout(this.board.station.x, this.n);
    if (x < L.xL - L.R - 0.2 || x > L.xR + L.R + 0.2) return 0;
    const deck = L.zD + 0.2;
    const foot = deck + STAIRS;
    if (z < this.board.station.y || z > foot) return 0;
    return z <= deck ? lift : lift * ((foot - z) / STAIRS);
  }

  /** Where riders stand to board: the platform inside the station U. */
  stationCenter(): Vector3 {
    const L = stationLayout(this.board.station.x, this.n);
    return v3((L.xL + L.xR) / 2, 0.1 + this.terrain.lift, (L.zU + L.zD) / 2);
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
    return v3(sc.x + dir * (QUEUE_START + along * spacing), 0, this.board.station.y + 1.9 + Math.min(row, 2) * 0.4);
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
    // A crate's lid or the ground, at each height the board has (hills lift some cells);
    // the nearest hit along the ray wins.
    const hit = new Vector3();
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < this.n && y < this.n;
    const levels = [0, ...this.terrain.hills.map((h) => h.h)];
    let best: Pt | null = null;
    let bestD = Infinity;
    for (const lv of levels)
      for (const lid of [true, false]) {
        if (!ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -(GRASS_Y + lv + (lid ? CRATE_H : 0))), hit)) continue;
        const x = Math.floor(hit.x);
        const y = Math.floor(hit.z);
        if (!inside(x, y) || Math.abs(this.terrain.cell(x, y) - lv) > 0.02) continue;
        if (lid && !this.board.tiles[idx(this.board, x, y)]) continue;
        const d = hit.distanceTo(ray.ray.origin);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    return best;
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
    this.terrain = makeTerrain(b, park, seed);
    // Test hook: ?hill=x,y,w,d,h forces a hill (to see track built over one).
    const forced = new URLSearchParams(location.search).get('hill')?.split(',').map(Number);
    if (forced?.length === 5) this.terrain.hills.push({ x0: forced[0], y0: forced[1], x1: forced[0] + forced[2] - 1, y1: forced[1] + forced[3] - 1, h: forced[4] });
    this.island = buildIsland(b, park, seed);
    this.world.add(this.island.group);
    if (this.terrain.hills.length) {
      const th = this.theme;
      const hills = new Mesh(hillGeo(this.terrain, GRASS_Y, [th.grass[1], th.grass[2]], PAL.dirt[1], seed).build(0.9), MATS.ground);
      hills.castShadow = true;
      hills.receiveShadow = true;
      this.world.add(hills);
    }
    this.stationGroup = this.buildStation();
    this.world.add(this.stationGroup);
    this.island.lamps.forEach((p, i) => this.lampLights[i].position.copy(p));
    this.scene.background = new Color(this.island.look.horizon);
    this.trackKey = '';
    for (const g of this.cellGroups.values()) this.trackGroup.remove(g);
    this.cellGroups.clear();
    this.riseAt.clear();
    this.eatHold.clear();
    this.gulps = [];
    this.preview = null;
    this.ridePending = false;
    this.loopTrain = { shown: this.game.trainPos, keys: [] };
    this.laps = [];
    this.seatRiders = [];
    this.seatPts = [];
    this.homeRun = null;
    for (const m of this.mouths) m.ready = false;
    this.syncTrack(true);
    this.tileAnim = null;
    this.combo = null;
    this.ride = null;
    this.show.end();
    this.walkers = [];
    this.lineup = [];
    this.potties = [];
    this.waveQueue = [];
    this.waveNext = null;
    this.streams = [];
    this.polaroid?.remove();
    this.polaroid = null;
    this.photoReq = null;
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
    const z = s.y;
    const L = stationLayout(s.x, this.n);
    const xc = (L.xL + L.xR) / 2;
    const parts: Parts = { matte: new Geo(), gloss: new Geo(), cloth: new Geo(), glow: new Geo(), ground: new Geo() };
    const m = parts.matte!;
    const gd = parts.ground!;
    // A long deck under the whole station loop.
    const dx0 = L.xL - L.R - 0.14;
    const dx1 = L.xR + L.R + 0.14;
    const dz0 = z + 0.04;
    const dz1 = L.zD + 0.2;
    gd.cube((dx0 + dx1) / 2, 0.03, (dz0 + dz1) / 2, dx1 - dx0, 0.06, dz1 - dz0, '#8f96ae', 0.02, '#a9adc0');
    for (let x = dx0 + 0.25; x < dx1 - 0.1; x += 0.25) gd.cube(x, 0.061, (dz0 + dz1) / 2, 0.012, 0.004, dz1 - dz0 - 0.04, '#7a7f99');
    // The island platform between the lanes, where riders board.
    const pz0 = L.zU + 0.1;
    const pz1 = L.zD - 0.1;
    m.cube(xc, 0.08, (pz0 + pz1) / 2, L.xR - L.xL, 0.05, pz1 - pz0, '#e8e4f4', 0.015, '#f1eefa');
    for (let x = L.xL + 0.1; x < L.xR - 0.05; x += 0.18) {
      m.cube(x, 0.106, pz0 + 0.02, 0.09, 0.006, 0.025, PAL.gold);
      m.cube(x, 0.106, pz1 - 0.02, 0.09, 0.006, 0.025, PAL.gold);
    }
    // A long striped canopy on posts down the middle of the platform (paint job from unlocks).
    const paint = this.game.record.station;
    const stripe = paint === 'candy' ? ['#ff8fb8', '#b8f0d8'] : paint === 'gold' ? [PAL.gold, PAL.white] : [PAL.red, PAL.white];
    const cloth = parts.cloth!;
    const cw = L.xR - L.xL - 0.1;
    const stripes = Math.max(6, Math.round(cw / 0.14));
    const sw = cw / stripes;
    for (let i = 0; i < stripes; i++) {
      const x0 = L.xL + 0.05 + i * sw;
      cloth.box(new Matrix4().makeRotationX(0.28).setPosition(x0 + sw / 2, 0.46, (pz0 + pz1) / 2 - 0.02), sw, 0.014, 0.2, stripe[i % 2]);
      cloth.sphere(v3(x0 + sw / 2, 0.42, (pz0 + pz1) / 2 + 0.08), sw * 0.5, stripe[i % 2], 1, 0.55, 0.35, 8, 4);
    }
    for (let x = L.xL + 0.25; x < L.xR - 0.1; x += Math.max(0.6, (L.xR - L.xL - 0.5) / Math.max(1, Math.round((L.xR - L.xL) / 0.9)))) m.post(x, 0.1, (pz0 + pz1) / 2 - 0.04, 0.018, 0.34, '#2b2140', 6);
    m.cube(xc, 0.5, (pz0 + pz1) / 2 - 0.12, cw + 0.04, 0.035, 0.04, '#b83344', 0.012);
    // A raised station: the whole deck stands on a base (pier stilts, a rocky crag, gold
    // scaffolding), with a wide flight of stairs down to the plaza.
    const lift = this.terrain.lift;
    const low: Parts = { matte: new Geo(), ground: new Geo(), gloss: new Geo() };
    if (lift > 0) {
      const park = this.game.cfg.park.id;
      const lm = low.matte!;
      const body = park === 'boardwalk' ? '#b98552' : park === 'hollow' ? '#6e6886' : '#e0962a';
      const edge = park === 'boardwalk' ? '#8a5a2e' : park === 'hollow' ? '#4e4866' : '#b86f14';
      if (park === 'boardwalk') {
        // Pier stilts under planks.
        for (let x = dx0 + 0.12; x < dx1; x += 0.45)
          for (const zz of [dz0 + 0.08, (dz0 + dz1) / 2, dz1 - 0.08]) lm.post(x, 0, zz, 0.045, lift, edge, 7, 0.04, body);
        lm.cube((dx0 + dx1) / 2, lift - 0.04, (dz0 + dz1) / 2, dx1 - dx0 + 0.04, 0.06, dz1 - dz0 + 0.04, body, 0.015);
      } else {
        // A solid clay block with a lumpy front.
        low.ground!.cube((dx0 + dx1) / 2, lift / 2, (dz0 + dz1) / 2, dx1 - dx0 + 0.06, lift, dz1 - dz0 + 0.02, body, 0.03, shade(body, 0.1));
        const rr = rng(this.game.dayNum * 31 + 7);
        for (let x = dx0 + 0.1; x < dx1; x += 0.22 + rr() * 0.12)
          low.ground!.blob(v3(x, lift * (0.3 + rr() * 0.45), dz1 + 0.02), 0.08 + rr() * 0.06, shade(body, (rr() - 0.5) * 0.12), Math.round(rr() * 999), 0.25, 1.2, 0.8, 0.5);
        lm.cube((dx0 + dx1) / 2, lift - 0.02, dz1 + 0.01, dx1 - dx0 + 0.08, 0.04, 0.05, edge, 0.012);
      }
      // Stairs down to the plaza: wide steps with a gold nosing.
      const steps = Math.max(3, Math.round(lift / 0.07));
      for (let k = 0; k < steps; k++) {
        const top = lift * (1 - k / steps);
        const z0s = dz1 + (k * STAIRS) / steps;
        const z1s = dz1 + ((k + 1) * STAIRS) / steps;
        const tread = park === 'boardwalk' ? ['#b98552', '#d3a36c'] : park === 'hollow' ? ['#7c7694', '#948eab'] : ['#e2dccb', '#f3eee0'];
        lm.cube((dx0 + dx1) / 2, top / 2, (z0s + z1s) / 2, dx1 - dx0 - 0.1, top, z1s - z0s + 0.004, tread[0], 0.008, tread[1]);
        lm.cube((dx0 + dx1) / 2, top - 0.004, z0s + 0.012, dx1 - dx0 - 0.1, 0.012, 0.022, PAL.gold, 0.004);
      }
      // Handrails at both ends.
      for (const x of [dx0 + 0.02, dx1 - 0.02]) low.gloss!.pipe([v3(x, lift + 0.12, dz1 - 0.05), v3(x, 0.12, dz1 + STAIRS + 0.02)], 0.012, '#e7e9f2', 6);
    }
    // The marquee in front of the lower lane (at the foot of the stairs when the station is up high).
    const signZ = lift > 0 ? L.zD + 0.2 + STAIRS + 0.1 : L.zD + 0.34;
    const sign = new Mesh(new PlaneGeometry(0.98, 0.3), new BasicMat({ map: signTexture(), transparent: true }));
    const tilt = new Matrix4().makeRotationX(-0.55);
    sign.position.set(xc, 0.165, signZ + 0.03);
    sign.rotation.x = -0.55;
    sign.layers.set(GLOW_LAYER);
    this.stationSign = sign;
    g.add(sign);
    low.matte!.box(new Matrix4().copy(tilt).setPosition(xc, 0.155, signZ - 0.01), 1.02, 0.33, 0.03, '#9a5a1c', 0.01);
    for (const sx of [-0.4, 0.4]) low.matte!.post(xc + sx, 0, signZ + 0.02, 0.018, 0.12, '#2b2140', 6);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const lp = v3(Math.cos(a) * 0.52, Math.sin(a) * 0.17, 0.02).applyMatrix4(tilt);
      parts.glow!.sphere(v3(xc + lp.x, 0.16 + lp.y, signZ + lp.z), 0.018, '#fff1b0', 1, 1, 1, 6, 4);
    }
    // Queue barriers (on the plaza, not the raised deck).
    const up = { matte: parts.matte, cloth: parts.cloth, glow: parts.glow, ground: parts.ground, gloss: parts.gloss };
    parts.matte = low.matte!;
    const sc = this.stationCenter();
    const dir = this.queueDir();
    const far = dir > 0 ? this.n + 0.5 : -0.5;
    const zr = s.y + 1.9;
    const ropeCol = '#e8484f';
    for (let r2 = 0; r2 < 2; r2++) {
      const zz = zr + 0.2 + r2 * 0.4;
      const a = r2 % 2 === 0 ? v3(sc.x + dir * (QUEUE_START - 0.2), 0, zz) : v3(sc.x + dir * (QUEUE_START + 0.3), 0, zz);
      const b = r2 % 2 === 0 ? v3(far - dir * 0.35, 0, zz) : v3(far + dir * 0.1, 0, zz);
      const steps = Math.max(1, Math.round(Math.abs(b.x - a.x) / 0.7));
      for (let k = 0; k < steps; k++) rope(parts, a.clone().lerp(b, k / steps), a.clone().lerp(b, (k + 1) / steps), ropeCol);
    }
    // Everything on the deck rides up with it; the base, stairs, ropes and sign stay on the plaza.
    for (const [set, y] of [
      [{ ...up, glow: undefined }, lift],
      [low, 0],
    ] as [Parts, number][])
      for (const [key, mat] of Object.entries(MATS) as [keyof typeof MATS, (typeof MATS)[keyof typeof MATS]][]) {
        const geo = set[key];
        if (!geo || geo.empty) continue;
        const mesh = new Mesh(geo.build(), mat);
        mesh.position.y = y;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        g.add(mesh);
      }
    const glow = new Mesh(up.glow!.build(), GLOW_MAT);
    glow.layers.set(GLOW_LAYER);
    glow.layers.enable(BLOOM_LAYER);
    g.add(glow);
    return g;
  }

  // ---- Camera framing ------------------------------------------------------------

  private framePoints(): Vector3[] {
    // The board, the station and the queue fill the free screen; the island's verge,
    // the water and the scenery around it run off the edges.
    const n = this.n;
    const pad = this.compact ? 0.05 : 0.25;
    const pts: Vector3[] = [];
    for (const x of [-pad, n + pad])
      for (const z of [-0.15, n + 2.75]) {
        pts.push(v3(x, 0, z));
        pts.push(v3(x, 0.45, z));
      }
    // Room above the back row for tall loops.
    pts.push(v3(n / 2, 1.85, 0.2));
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
    // The part of the screen the HUD leaves free, in NDC.
    const W = this.cssW;
    const H = this.cssH;
    const sx0 = (this.safe.x0 / W) * 2 - 1;
    const sx1 = (this.safe.x1 / W) * 2 - 1;
    const sy0 = 1 - (this.safe.y1 / H) * 2;
    const sy1 = 1 - (this.safe.y0 / H) * 2;
    const scx = (sx0 + sx1) / 2;
    const scy = (sy0 + sy1) / 2;
    for (let it = 0; it < 18; it++) {
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
      target.x += ((x0 + x1) / 2 - scx) * halfW * 0.9;
      target.addScaledVector(up, ((y0 + y1) / 2 - scy) * halfH * 0.9);
      const need = Math.max(ext.x / (sx1 - sx0), ext.y / (sy1 - sy0)) / 0.99;
      dist *= 0.4 + 0.6 * need;
    }
    return { target, dist, ext };
  }

  /** The canvas fills its box (the whole window); the park is framed between the HUD bars. */
  fit(): void {
    const area = this.canvas.parentElement!;
    const W = Math.max(200, area.clientWidth);
    const H = Math.max(200, area.clientHeight);
    this.compact = W < 620;
    this.cssW = W;
    this.cssH = H;
    // The ink and bloom passes cost per pixel; cap the resolution a little on phones and big screens.
    const dpr = Math.min(this.compact ? 1.6 : W * H > 2.2e6 ? 1.25 : 1.75, window.devicePixelRatio || 1);
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(W, H, false);
    this.post.setSize(Math.round(W * dpr), Math.round(H * dpr), dpr);
    this.reframe();
    if (this.show?.active) this.show.layout();
  }

  /** Re-solves the framing when the HUD around the park changes size (no GL resize). */
  reframe(): void {
    const W = this.cssW;
    const H = this.cssH;
    const box = this.canvas.getBoundingClientRect();
    const rectOf = (id: string) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return r.height > 0 ? r : null;
    };
    let top = 0;
    for (const id of ['hudTop', 'dayBanner', 'attractions']) {
      const r = rectOf(id);
      if (r) top = Math.max(top, r.bottom - box.top);
    }
    const bar = document.querySelector('.hud-bar')?.getBoundingClientRect();
    const bottom = bar && bar.height > 0 ? bar.top - box.top : H;
    const pad = this.compact ? 4 : 10;
    this.safe = {
      x0: pad,
      x1: W - pad,
      y0: Math.min(H * 0.4, top + pad),
      y1: Math.max(H * 0.6, bottom - pad),
    };
    const f = this.solveFrame(W / H);
    this.base = { target: f.target, dist: f.dist };
  }

  // ---- Events --------------------------------------------------------------------

  handleEvents(): void {
    for (const e of this.game.events.splice(0)) {
      switch (e.type) {
        case 'day':
          this.setupDay();
          break;
        case 'special': {
          const c = this.cell(e.at).setY(0.3);
          this.burst(c, 22, e.special === 'launch' ? ['#7ff2ff', PAL.gold, PAL.white] : e.special === 'splash' ? ['#8fdcf6', PAL.white] : [PAL.red, PAL.gold]);
          sfx.lay();
          this.kick(2, 200);
          break;
        }
        case 'unlock':
          this.onUnlock(e.id);
          break;
        case 'combo':
          this.comboPrizePop(e.merges, e.special);
          break;
        case 'boss':
          if (e.what === 'wave') this.waveNext = e.dir!;
          else if (e.what === 'spin') {
            this.word('SPIN!', this.stationCenter().setY(1.4), '#c58cff', 1.3);
            this.kick(2, 260);
            sfx.slowOut();
          } else {
            const boss = this.game.queue.find((r) => r.boss);
            const at = boss ? this.riderPos.get(boss.id) : null;
            this.word('*MUNCH* +1 STOMACH', at ? v3(at.x, 1.2, at.z) : this.stationCenter().setY(1.2), PAL.gold, 0.9);
            sfx.lay();
          }
          break;
        case 'swipe':
          if (this.waveNext) {
            const dir = this.waveNext;
            this.waveNext = null;
            if (this.tileAnim) this.waveQueue.push({ move: e.result, dir });
            else this.startWave(e.result, dir);
            break;
          }
          this.tileAnim = { start: this.now, move: e.result, fired: -1 };
          if (e.result.chain.waves.length) music.combo(e.result.mergeCount);
          this.combo = null;
          this.startGulps(e.result);
          // The board is nearly full: the park holds its breath.
          if (this.game.phase === 'build' && this.game.room <= 3) this.after(SLIDE_MS + 120, () => sfx.heartbeat());
          break;
        case 'build': {
          // Eaten tiles get their own gulp (see startGulps).
          if (this.eatenCells.has(e.laid)) break;
          if (this.board.loop) {
            this.growFx(e.laid);
            break;
          }
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
        case 'lap':
          this.laps.push({ e, riders: e.tickets.map((t) => t.rider), at: this.now, paying: false });
          break;
        case 'undo':
          // Undo puts the train back where it was, at once; laps it undid never pay.
          this.laps = this.laps.filter((l) => l.paying);
          this.syncTrack();
          this.loopTrain.shown = this.game.trainPos;
          this.tileAnim = null;
          this.gulps = [];
          this.eatHold.clear();
          break;
        case 'open': {
          // The always-running ride: the train rolls home to the station before the last ride.
          const go = () => {
            if (!this.board.loop) {
              this.ridePending = false;
              sfx.open();
              this.startRide();
              return;
            }
            this.ridePending = true;
            this.homeRun = () => {
              this.homeRun = null;
              this.ridePending = false;
              this.laps = [];
              this.seatRiders = [];
              sfx.open();
              this.startRide();
            };
          };
          if (this.now - this.gridlockAt < 1) {
            // Gridlock opened it: let the jam land first.
            this.ridePending = true;
            this.after(GRIDLOCK_MS, go);
          } else go();
          break;
        }
        case 'gridlock':
          this.gridlockAt = this.now;
          {
            const boxed = !!e.boxed;
            this.after(this.gulps.length ? SLIDE_MS + GULP_MS : SLIDE_MS + 40, () => this.gridlockShow(boxed));
          }
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
          } else if (e.tool === 'crew') {
            this.word('TRACK CREW', at.clone().setY(1), PAL.gold);
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
    this.syncTrack();
    // Each rider walks to their own car's side of the platform and hops in; the train
    // only leaves once the last one is seated.
    const park = this.path.parkAt;
    const boardAt = result.tickets.map(() => this.gameNow + 300);
    const WALK = 1.6;
    this.game.queue.forEach((r, i) => {
      const p = this.riderPos.get(r.id);
      if (!p) return;
      const seat = result.tickets.findIndex((t) => t.rider.id === r.id);
      const at = seat >= 0 ? this.path.sample(park - seat * CAR_GAP).p : sc;
      const tx = at.x;
      const tz = seat >= 0 ? at.z - 0.2 : sc.z;
      const delay = i * 90;
      this.walkers.push({ look: r.look, x: p.x, z: p.z, tx, tz, speed: WALK, delay });
      if (seat >= 0) boardAt[seat] = this.gameNow + delay + (Math.hypot(tx - p.x, tz - p.z) / WALK) * 1000 + 40;
    });
    this.riderPos.clear();
    photoStore.url = null;
    photoStore.card = null;
    this.polaroid?.remove();
    this.polaroid = null;
    const go = Math.max(this.gameNow + 600, ...boardAt) + 450;
    this.ride = new RideAnim(this, rideOrder(this.board, result.kind), result, this.show, go, boardAt);
  }

  // ---- Effects ---------------------------------------------------------------------

  dust(at: Vector3, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 0.5;
      this.particles.add({ p: at.clone(), v: v3(Math.cos(a) * s, 0.3 + Math.random() * 0.4, Math.sin(a) * s), g: 1.5, max: 0.45 + Math.random() * 0.2, color, size: 0.03 + Math.random() * 0.03, drag: 3 });
    }
  }

  /** A Water Splash: a crown of spray and droplets. */
  splash(at: Vector3): void {
    for (let k = 0; k < 26; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 1.1;
      this.particles.add({ p: at.clone(), v: v3(Math.cos(a) * sp, 1.2 + Math.random() * 1.6, Math.sin(a) * sp), g: 5, max: 0.8 + Math.random() * 0.4, color: k % 3 ? '#8fdcf6' : '#fbf6ec', size: 0.025 + Math.random() * 0.02 });
    }
  }

  /** A flume wake: spray thrown off both sides of a car ploughing through the water. */
  flumeSpray(at: Vector3, t: Vector3, right: Vector3, speed: number): void {
    for (const side of [-1, 1]) {
      const v = right.clone().multiplyScalar(side * (0.5 + Math.random() * 0.5)).addScaledVector(t, speed * 0.4).add(v3(0, 0.9 + Math.random() * 0.8, 0));
      this.particles.add({ p: at.clone().addScaledVector(right, side * 0.13).setY(at.y + 0.02), v, g: 5, max: 0.5 + Math.random() * 0.3, color: Math.random() < 0.4 ? '#fbf6ec' : '#8fdcf6', size: 0.02 + Math.random() * 0.018 });
    }
  }

  /** Brake sparks. */
  sparkBurst(at: Vector3, n: number): void {
    for (let k = 0; k < n; k++)
      this.sparks.add({ p: at.clone(), v: v3((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 0.9, (Math.random() - 0.5) * 1.6), g: 3, max: 0.35 + Math.random() * 0.25, color: k % 2 ? '#ffd23f' : '#ff9a3c', size: 0.02, drag: 0.5 });
  }

  burst(at: Vector3, n: number, ramp: readonly string[]): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const s = 1 + Math.random() * 1.4;
      this.particles.add({ p: at.clone(), v: v3(Math.cos(a) * s, 1.2 + Math.random() * 1.6, Math.sin(a) * s * 0.7), g: 5, max: 0.6 + Math.random() * 0.4, color: ramp[i % ramp.length], size: i % 4 === 0 ? 0.05 : 0.032 });
    }
  }

  /** A green spray from `at` along `dir`, carried along by `carry` (the car's velocity). */
  /** Puke streams: emitted from a (moving) mouth over time, so it gushes instead of popping. */
  private streams: { src: () => { p: Vector3; dir: Vector3; carry?: Vector3 } | null; until: number; start: number; rate: number; big: boolean }[] = [];

  /**
   * A proper puke: a gush from the mouth for `ms`, following the head as it moves.
   * `dir` is where the face points; gravity arcs it down, chunks and all.
   */
  pukeStream(src: () => { p: Vector3; dir: Vector3; carry?: Vector3 } | null, ms: number, big = false): void {
    this.streams.push({ src, start: this.gameNow, until: this.gameNow + ms, rate: big ? 220 : 130, big });
  }

  private updateStreams(dt: number): void {
    const ramp = ['#a6e05a', '#8cc23e', '#c8e86a', '#6fae2e', '#b6d84a'];
    this.streams = this.streams.filter((st) => {
      if (this.gameNow > st.until) return false;
      const s = st.src();
      if (!s) return false;
      // Hardest at the start, sputtering out at the end.
      const life = (this.gameNow - st.start) / Math.max(1, st.until - st.start);
      const surge = 1 - life * 0.75;
      const n = Math.max(0, Math.round(st.rate * dt * surge + Math.random() * 0.6));
      const dir = s.dir.clone().normalize();
      for (let k = 0; k < n; k++) {
        const chunk = Math.random() < 0.08;
        const v = dir.clone().multiplyScalar((st.big ? 1.9 : 1.45) * (0.75 + Math.random() * 0.45) * surge + 0.25);
        v.x += (Math.random() - 0.5) * 0.35;
        v.y += (Math.random() - 0.5) * 0.25;
        v.z += (Math.random() - 0.5) * 0.35;
        if (s.carry) v.addScaledVector(s.carry, 0.85);
        const p = s.p.clone().addScaledVector(dir, 0.015);
        this.particles.add({
          p,
          v,
          g: 5.5,
          max: 1.8,
          color: chunk ? (Math.random() < 0.5 ? '#e8a33a' : '#f3e7a0') : ramp[Math.floor(Math.random() * ramp.length)],
          size: chunk ? 0.022 : (st.big ? 0.02 : 0.014) + Math.random() * 0.016,
          puke: Math.random() < 0.3,
          drag: 0.2,
        });
      }
      return true;
    });
  }

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

  word(text: string, at: Vector3, color: string, big = 1, ms = 1100, solo = false): HTMLElement {
    // The same shout again nearby just counts up ("OOH ×3").
    const same = solo ? null : this.words.find((w) => w.base === text && this.now - w.born < 900 && Math.hypot(w.at.x - at.x, w.at.z - at.z) < 1.6);
    if (same) {
      same.count = (same.count ?? 1) + 1;
      same.el.textContent = `${text} ×${same.count}`;
      same.born = this.now;
      same.el.style.animation = 'none';
      void same.el.offsetWidth;
      same.el.style.animation = '';
      return same.el;
    }
    // Stack different shouts that land on the same spot instead of piling them up.
    const near = solo ? 0 : this.words.filter((w) => this.now - w.born < 700 && Math.hypot(w.at.x - at.x, w.at.z - at.z) < 0.9).length;
    at = at.clone().setY(at.y + near * 0.22);
    const el = document.createElement('span');
    el.className = 'w3d';
    el.textContent = text;
    el.style.color = color;
    el.style.setProperty('--s', String(big));
    this.wordLayer.append(el);
    this.words.push({ el, at: at.clone(), born: this.now, max: ms, base: text });
    return el;
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
      this.snapUntil = now + 320;
      sfx.slowOut();
      music.slowmo(false);
      this.caption.classList.remove('on');
    }
    this.cine += ((this.shot ? 1 : 0) - this.cine) * Math.min(1, dt * (this.shot ? 7 : 4));
    if (this.cine < 0.002) this.cine = 0;
    let scale = 1 - this.cine * (1 - (this.shot?.slow ?? 0.2));
    if (this.shot) {
      // Hit-stop: the world freezes for a beat before the slow motion rolls.
      const age = now - this.shot.start;
      if (age < 130) scale = 0.015;
      // A heartbeat thumps through it.
      if (now > this.beat) {
        this.beat = now + 620;
        sfx.heartbeat();
      }
    } else if (now < this.snapUntil) scale = 1.6;
    const gdt = dt * scale;
    this.gameNow += gdt * 1000;
    this.handleEvents();
    SHARED.uTime.value = now / 1000;
    SHARED.uBoil.value = this.smooth ? 0 : Math.floor(now / STOP_MS) * 1.37;
    this.fireTileEffects();
    this.updateFog();
    this.syncTrack();
    this.syncStructures();
    this.animateStructures();
    this.updateLight(dt);
    this.drawTrackRise();
    this.foamFlumes(gdt);
    this.drawCrates();
    this.drawTargets();
    this.drawGrow();
    this.drawMouths();
    this.drawPreview();
    this.drawQueue(dt);
    this.updateThoughts();
    this.updateWalkers(gdt);
    this.updateStreams(gdt);
    this.updatePotties();
    if (this.ride) {
      this.ride.update(this.gameNow, gdt);
      this.ride.draw(this.gameNow);
      if (this.ride.finished(this.gameNow)) {
        this.ride = null;
        this.onRideDone();
      }
    } else if (this.board.loop && (this.game.phase === 'build' || this.ridePending)) this.drawLoopTrain(gdt);
    else if (this.game.phase !== 'ride' || this.ridePending) this.drawParkedTrain();
    this.show.tick(dt, now);
    const due = this.later.filter((l) => l.at <= now);
    this.later = this.later.filter((l) => l.at > now);
    for (const l of due) l.fn();
    this.particles.update(gdt);
    this.sparks.update(gdt);
    if (this.puddleDirty) this.rebuildPuddles();
    this.animateScenery(now);
    this.crates.end();
    this.decos.end();
    this.people.end();
    this.cars.end();
    this.hangers.end();
    this.markers.end();
    this.chevrons.end();
    this.outlines.end();
    this.beads.end();
    this.bubbles.end();
    this.mists.end();
    this.updateCamera(dt);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.post.mat.uniforms.uFlash.value = this.flash * 0.5;
    this.post.mat.uniforms.uCine.value = this.cine;
    if (this.cine > 0) {
      const f = this.shotAt.clone().project(this.camera);
      this.post.mat.uniforms.uFocus.value.set((f.x + 1) / 2, (f.y + 1) / 2);
      const p = this.local(this.shotAt);
      this.caption.style.transform = `translate(${this.canvas.offsetLeft + p.x}px, ${this.canvas.offsetTop + p.y - this.cssH * 0.18}px) translate(-50%, -50%)`;
    }
    this.drawBars();
    // Stop motion: the set is photographed 12 times a second ("on twos").
    if (this.smooth || now - this.lastShot >= STOP_MS - 1) {
      this.lastShot = this.smooth ? now : now - ((now - this.lastShot) % STOP_MS);
      this.post.mat.uniforms.uFocusD.value = this.focusD;
      this.post.render(this.gl, this.scene, this.camera, now / 1000);
    }
    if (this.photoReq && now >= this.photoReq.due) this.capturePhoto();
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
    const target = this.base.target.clone().lerp(f.at, f.w * 0.5);
    let dist = this.base.dist * (1 - f.w * 0.3);
    let pitch = PITCH;
    let yaw = 0;
    let roll = 0;
    // Speed: the lens widens and the camera leans in a touch as the train rips through the dips.
    this.rush += ((this.ride?.rush() ?? 0) - this.rush) * Math.min(1, dt * 3);
    let fov = FOV + this.rush * 4;
    dist *= 1 - this.rush * 0.06;
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
      pitch += (0.5 - PITCH) * e;
      yaw = this.shotYaw * e;
      // In your face: a wide-angle lens right up close, and a tilted horizon.
      fov += (62 - FOV) * e;
      dist *= 1 - 0.5 * e;
      roll = Math.sign(this.shotYaw || 1) * 0.2 * e;
    }
    const dir = v3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    cam.position.copy(target).addScaledVector(dir, dist);
    if (this.now < this.shake.until) {
      const m = this.shake.mag * 0.018;
      cam.position.x += (Math.random() - 0.5) * 2 * m;
      cam.position.y += (Math.random() - 0.5) * 2 * m;
    }
    cam.lookAt(target);
    this.focusD = cam.position.distanceTo(target);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** Late in the day the light turns golden, then dusk comes and the lamps light up. */
  private updateLight(dt: number): void {
    // The evening comes as the park fills up: the fuller the board, the later it gets.
    const frac = Math.min(1, (2.2 * this.game.room) / (this.n * this.n));
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
    // Count Queasy's Lights Out: the fog closes in to one cell, in any park.
    const radius = this.game.bossRule === 'blackout' ? 1 : this.game.cfg.park.fog ? 2 : 0;
    if (!radius || this.game.phase === 'ride' || this.game.phase === 'results') return;
    const seen = [{ x: b.station.x, y: b.station.y }, { x: b.station.x + 1, y: b.station.y }, ...b.ends[0], ...b.ends[1]];
    const t = this.now / 1000;
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        if (seen.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) <= radius)) continue;
        this.fogged.add(idx(b, x, y));
        const s = this.mists.get();
        s.position.set(x + 0.5 + Math.sin(t * 0.4 + x * 1.3) * 0.12, 0.42 + Math.sin(t * 0.7 + y) * 0.04, y + 0.5 + Math.cos(t * 0.3 + y * 1.7) * 0.1);
        const k = 1.25 + Math.sin(t * 0.5 + x + y) * 0.1;
        s.scale.set(k, k * 0.7, 1);
      }
  }

  // ---- Track -----------------------------------------------------------------------

  /** Repaints the station (after picking a new paint job). */
  restyleStation(): void {
    if (!this.stationGroup) return;
    this.world.remove(this.stationGroup);
    this.stationGroup.traverse((o) => (o as Mesh).geometry?.dispose());
    this.stationGroup = this.buildStation();
    this.world.add(this.stationGroup);
  }

  /** Rebuilds the park's bought structures when the set changes. */
  private syncStructures(): void {
    const g = this.game;
    const up = new Map<string, number>();
    for (const u of g.upgrades) up.set(u, (up.get(u) ?? 0) + 1);
    const tours = [...new Set(g.crowd)];
    const key = [g.attractions.map((a) => a.id).join(','), [...up].map(([u, n]) => `${u}${n}`).join(','), tours.join(','), this.n, this.board.station.x, this.terrain.lift].join('|');
    if (key === this.structKey) return;
    this.structKey = key;
    this.structures.traverse((o) => (o as Mesh).geometry?.dispose());
    this.structures.clear();
    if (!this.structures.parent) this.scene.add(this.structures);
    const n = this.n;
    // Attraction lots around the board: down both side strips, along the back,
    // and beside the station. Commons fill them in card order (left front, left
    // back, behind the board, right back, right front, then the rest);
    // legendaries stand bigger and claim the showiest spots first, behind the board.
    const lotAt: Record<string, { x: number; z: number; back?: boolean }> = {
      LF: { x: -0.4, z: n * 0.8 }, LM: { x: -0.4, z: n * 0.5 }, LB: { x: -0.4, z: n * 0.2 },
      RF: { x: n + 0.4, z: n * 0.8 }, RM: { x: n + 0.4, z: n * 0.5 }, RB: { x: n + 0.4, z: n * 0.2 },
      B0: { x: n / 2, z: -0.42, back: true }, B1: { x: n / 2 - n * 0.36, z: -0.42, back: true }, B2: { x: n / 2 + n * 0.36, z: -0.42, back: true },
      SL: { x: -0.4, z: n + 0.75 }, SR: { x: n + 0.4, z: n + 0.75 },
    };
    const commonOrder = ['LF', 'LB', 'B0', 'RB', 'RF', 'LM', 'RM', 'B1', 'B2', 'SL', 'SR'];
    const legendOrder = ['B0', 'B1', 'B2', 'LM', 'RM', 'LB', 'RB', 'LF', 'RF', 'SL', 'SR'];
    const taken = new Set<string>();
    const lotOf = new Map<number, string>();
    const legendary = (i: number) => ATTRACTIONS[g.attractions[i].id].rarity === 'legendary';
    for (const pass of [true, false])
      g.attractions.forEach((_, i) => {
        if (legendary(i) !== pass) return;
        const lot = (pass ? legendOrder : commonOrder).find((l) => !taken.has(l));
        if (!lot) return;
        taken.add(lot);
        lotOf.set(i, lot);
      });
    const had = this.attrLots.length;
    // One group per attraction, index for index (pulseAttraction relies on it); any
    // past the last lot get an empty stand-in that never joins the scene.
    this.attrLots = g.attractions.map((a, i) => {
      const lot = lotOf.get(i);
      if (!lot) {
        const ghost = new Group();
        ghost.position.set(n / 2, 0, -0.42);
        return ghost;
      }
      const big = legendary(i);
      const at = lotAt[lot];
      // Push the bigger legendaries out a touch, so they clear the board's edge.
      const out = big ? 0.22 : 0;
      const x = at.back ? at.x : at.x < 0 ? at.x - out : at.x + out;
      const grp = attractionGroup(a.id, ATTRACTIONS[a.id].rarity);
      grp.position.set(x, 0, at.back ? at.z - out : at.z);
      grp.userData.s = STRUCT_SCALE;
      grp.scale.setScalar(STRUCT_SCALE);
      this.structures.add(grp);
      return grp;
    });
    const backLots = [...lotOf].filter(([, l]) => lotAt[l].back).map(([i, l]) => ({ x: lotAt[l].x, r: legendary(i) ? 0.7 : 0.45 }));
    // A fresh attraction pops in.
    this.attrPulse = this.attrLots.map((_, i) => (i >= had && had + 1 === this.attrLots.length ? this.now : this.attrPulse[i] ?? -1e9));
    // Upgrades on the free side of the front plaza (the queue has the other side).
    const sc = this.stationCenter();
    const side = -this.queueDir();
    let k = 0;
    for (const [u, count] of up) {
      const row = k % 2;
      const x = sc.x + side * (0.8 + Math.floor(k / 2) * 0.6 + row * 0.3);
      const grp = upgradeGroup(u as Parameters<typeof upgradeGroup>[0], count);
      grp.scale.setScalar(1.5);
      grp.position.set(Math.min(n + 0.3, Math.max(-0.3, x)), 0, this.board.station.y + 2.2 + row * 0.45);
      this.structures.add(grp);
      k++;
    }
    // Tour buses parked behind the board.
    const busX = [0.6, n - 0.6, 1.5, n - 1.5].filter((x) => backLots.every((l) => Math.abs(x - l.x) > l.r + 0.42));
    tours.slice(0, busX.length).forEach((t, i) => {
      const grp = busGroup(SHIRTS[(t.length * 5 + t.charCodeAt(0)) % SHIRTS.length]);
      grp.scale.setScalar(1.25);
      grp.position.set(busX[i], 0, -0.4);
      this.structures.add(grp);
    });
  }

  /** An attraction scores (or its card is hovered): its landmark bounces. */
  pulseAttraction(slot: number): void {
    if (slot < 0 || slot >= this.attrLots.length) return;
    this.attrPulse[slot] = this.now;
    const at = this.attrLots[slot].position.clone().setY(0.35);
    this.burst(at, 10, [PAL.gold, PAL.white]);
  }

  private animateStructures(): void {
    // Rides on the plaza that turn (the teacups).
    const t = this.now / 1000;
    for (const grp of this.structures.children)
      for (const c of grp.children) if (c.userData.spin) c.rotation.y = t * c.userData.spin;
    this.attrLots.forEach((grp, i) => {
      const t = (this.now - (this.attrPulse[i] ?? -1e9)) / 1000;
      const k = t >= 0 && t < 0.7 ? Math.sin(t * 18) * Math.exp(-t * 5) : 0;
      grp.scale.set(STRUCT_SCALE * (1 - k * 0.18), STRUCT_SCALE * (1 + k * 0.3), STRUCT_SCALE * (1 - k * 0.18));
    });
  }

  private syncTrack(force = false): void {
    const b = this.board;
    const key = JSON.stringify([b.ends, b.opened === 'circuit', !!b.loop]);
    if (!force && key === this.trackKey) return;
    const had = new Set(this.cellGroups.keys());
    const fresh = this.trackKey !== '' && !force;
    this.trackKey = key;
    this.path = TrackPath.fromBoard(b, this.terrain.cell, this.terrain.lift);
    this.remapTrain();
    for (const g of this.cellGroups.values()) {
      this.trackGroup.remove(g);
      g.traverse((o) => (o as Mesh).geometry?.dispose());
    }
    this.cellGroups.clear();
    this.flumes = [];
    const look = this.island!.look;
    this.path.cells.forEach((c, i) => {
      const parts = buildCellTrack(this.path, i, { support: look.support, tie: look.tie });
      const g = new Group();
      for (const [k, mat] of [['gloss', MATS.rail], ['matte', MATS.steel]] as const) {
        const geo = parts[k];
        if (!geo || geo.empty) continue;
        const m = new Mesh(geo.build(), mat);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      }
      if (parts.water && !parts.water.empty) {
        const m = new Mesh(parts.water.build(), FLUME_MAT);
        m.receiveShadow = true;
        g.add(m);
      }
      if (parts.glow && !parts.glow.empty) {
        const m = new Mesh(parts.glow.build(), GLOW_MAT);
        m.layers.set(GLOW_LAYER);
        m.layers.enable(BLOOM_LAYER);
        g.add(m);
      }
      // A crossing pass shares its cell with the track it crosses: key it apart.
      const k = `${c.x},${c.y}${c.cross ? ',x' : ''}${c.special ? `,${c.special}` : ''}${c.flavor && !c.station ? `,${c.flavor}` : ''}`;
      if (fresh && !had.has(k)) {
        // An eaten tile's track waits for the tile to slide in and get gulped.
        const hold = c.cross ? undefined : this.eatHold.get(`${c.x},${c.y}`);
        this.riseAt.set(k, hold ?? this.now);
      }
      if (c.flavor === 'water' && !c.station) this.flumes.push(i);
      this.cellGroups.set(k, g);
      this.trackGroup.add(g);
    });
  }

  /** Foam flecks drift down each flume, so the water reads as running. */
  private foamFlumes(dt: number): void {
    if (!this.path || !dt) return;
    for (const i of this.flumes) {
      const [a, b] = this.path.range(i);
      if (Math.random() > dt * 9 * (b - a)) continue;
      const s = a + Math.random() * (b - a);
      const f = this.path.sample(s);
      if (f.up.y < 0.35) continue;
      const p = f.p.clone().addScaledVector(f.up, -0.012).addScaledVector(f.right, (Math.random() - 0.5) * 0.24);
      this.particles.add({ p, v: f.t.clone().multiplyScalar(0.45), g: 0, max: 0.7, color: Math.random() < 0.6 ? '#fbf6ec' : '#bff0ff', size: 0.018 + Math.random() * 0.012, drag: 0 });
    }
  }

  private drawTrackRise(): void {
    for (const [k, t0] of this.riseAt) {
      const g = this.cellGroups.get(k);
      const t = Math.min(1, (this.now - t0) / 420);
      if (g) g.visible = t >= 0;
      if (t < 0) continue;
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

  private crate(tier: number, x: number, z: number, cellI: number, flash = 0, lift = 0, squash = 0, flavor: Flavor | null = null): Mesh {
    const m = this.crates.get();
    // Gridlock: everything on the board shudders.
    if (this.now < this.wobbleUntil) squash += Math.sin(this.now / 35 + cellI * 1.7) * 0.1 * Math.min(1, (this.wobbleUntil - this.now) / 400);
    const fog = this.fogged.has(cellI);
    m.geometry = fog ? mysteryGeo() : crateGeo(tier);
    const pop = 1 + flash * 0.22;
    m.position.set(x + 0.5, GRASS_Y + this.terrain.height(x + 0.5, z + 0.5) + lift, z + 0.5);
    m.scale.set(pop * (1 + squash), pop * (1 - squash * 1.5), pop * (1 + squash));
    const mat = m.material as ReturnType<typeof toon>;
    mat.emissive.setScalar(flash * 0.9);
    // The fog keeps a park piece's secret.
    if (flavor && !fog) this.flavorBadge(flavor, m.position, m.scale, cellI);
    return m;
  }

  /** A flavored crate's badge: the lollipop whirls, the droplet bobs, the bat swings. */
  private flavorBadge(f: Flavor, at: Vector3, scale: Vector3, seed: number): void {
    const d = this.decos.get();
    d.position.copy(at);
    d.scale.copy(scale);
    const [base, anim] = d.children as Mesh[];
    base.geometry = flavorBaseGeo(f);
    anim.geometry = flavorAnimGeo(f);
    anim.position.copy(FLAVOR_PIVOT[f]);
    const t = this.now / 1000 + seed * 0.37;
    if (f === 'spin') anim.rotation.set(-0.45, 0, -t * 2.6);
    else if (f === 'water') {
      anim.position.y += Math.abs(Math.sin(t * 2.4)) * 0.035;
      anim.rotation.set(0, Math.sin(t * 0.9) * 0.6, 0);
      const k = 1 + Math.max(0, Math.cos(t * 2.4 * 2)) * 0.06;
      anim.scale.set(k, 2 - k, k);
    } else anim.rotation.set(Math.sin(t * 1.7) * 0.12, Math.sin(t * 0.6) * 0.3, Math.sin(t * 2.2) * 0.32);
    if (f !== 'water') anim.scale.setScalar(f === 'hang' ? 1.5 : 1.25);
    else anim.scale.multiplyScalar(1.4);
  }

  private drawCrates(): void {
    this.drawGulps();
    const b = this.board;
    const a = this.tileAnim;
    if (!a) {
      // Tiles the dragged swipe would feed glow in their mouth's color and lean toward it.
      const fed = new Map<number, End>();
      for (const e of this.preview?.eats ?? []) fed.set(idx(b, e.from.x, e.from.y), e.end);
      const glow = 0.3 + 0.2 * Math.sin(this.now / 110);
      // The always-running loop: tiles you can tap to grow it hop now and then, and glow.
      const grow = this.growable();
      for (let y = 0; y < b.size; y++)
        for (let x = 0; x < b.size; x++) {
          const i = idx(b, x, y);
          const t = b.tiles[i];
          if (!t) continue;
          const end = fed.get(i);
          const m = this.crate(t, x, y, i, this.flashAt(i), end !== undefined ? 0.04 + Math.abs(Math.sin(this.now / 120)) * 0.04 : 0, 0, b.flav?.[i] ?? null);
          if (end !== undefined) (m.material as ReturnType<typeof toon>).emissive.set(END_COLORS[end]).multiplyScalar(glow);
          const gk = grow.get(i);
          if (gk) {
            m.position.y += gk.lift;
            (m.material as ReturnType<typeof toon>).emissive.set(TIER_RAMPS[t][1]).multiplyScalar(gk.glow);
          }
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
        // Tiles hop over the track on their way (only the mouth is solid): a little arc over the rails.
        const hops = s.hops ?? (s.hops = this.trackBetween(s.from, s.to));
        const lift = hops ? Math.sin(e * Math.PI) * (0.42 + 0.08 * hops) : 0;
        this.crate(s.tier, x, y, idx(b, s.to.x, s.to.y), 0, lift, hops ? 0 : Math.sin(e * Math.PI) * 0.06, s.flavor ?? null);
      }
      return;
    }
    const k = Math.floor((el - SLIDE_MS) / WAVE_MS);
    const e = ease(((el - SLIDE_MS) % WAVE_MS) / (WAVE_MS * 0.6));
    const base = k === 0 ? mv.slid : mv.chain.frames[k - 1];
    // Flavors as they stood at this stage (older events may lack them: fall back to the board's).
    const flav = (k === 0 ? mv.slidFlav : mv.chain.flavFrames?.[k - 1]) ?? b.flav ?? [];
    const wave: ChainStep[] = mv.chain.waves[k] ?? [];
    const busy = new Set(wave.flatMap((w) => [idx(b, w.from.x, w.from.y), idx(b, w.to.x, w.to.y)]));
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        const i = idx(b, x, y);
        if (base[i] && !busy.has(i)) this.crate(base[i], x, y, i, this.flashAt(i), 0, 0, flav[i] ?? null);
      }
    for (const w of wave) {
      const ti = idx(b, w.to.x, w.to.y);
      this.crate(w.tier - 1, w.to.x, w.to.y, ti, 0, 0, 0, w.toFlavor ?? flav[ti] ?? null);
      const t = Math.min(1, e);
      const x = w.from.x + (w.to.x - w.from.x) * t;
      const y = w.from.y + (w.to.y - w.from.y) * t;
      // The grabbed tile hops over into the merged one.
      this.crate(w.tier - 1, x, y, ti, 0, Math.sin(t * Math.PI) * 0.45, 0, w.fromFlavor ?? null);
    }
  }

  /** Track cells strictly between two cells in a line (the rails a sliding tile hops over). */
  private trackBetween(a: Pt, c: Pt): number {
    const dx = Math.sign(c.x - a.x);
    const dy = Math.sign(c.y - a.y);
    let n = 0;
    for (let x = a.x + dx, y = a.y + dy; x !== c.x || y !== c.y; x += dx, y += dy) if (trackAt(this.board, x, y) && !(x === c.x && y === c.y)) n++;
    return n;
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
          if (w.fresh && w.flavor) this.parkPiecePop(w.flavor, w.to);
        }
        this.word(`CHAIN ${link + 1}`, this.cell(wave[0].to).setY(0.9), PAL.gold, 1 + link * 0.12);
        this.kick(Math.min(3, link), 140 + link * 40);
        sfx.chain(m.merges.length + link);
        this.bumpCombo((this.combo?.value ?? m.merges.length) + wave.length);
        if (a.fired === m.chain.waves.length) this.finishMove(m);
      }
    }
    if (done) {
      this.tileAnim = null;
      const next = this.waveQueue.shift();
      if (next) this.startWave(next.move, next.dir);
    }
  }

  /** A big combo paid out a free special piece: a gold shout over the board and a gift box that pops. */
  private comboPrizePop(merges: number, special: keyof typeof SPECIALS): void {
    const n = this.n;
    // Let the chain's own shouts land first.
    const delay = this.tileAnim ? Math.max(0, SLIDE_MS + this.tileAnim.move.chain.waves.length * WAVE_MS - (this.now - this.tileAnim.start)) + 120 : 0;
    this.after(delay, () => {
      const top = v3(n / 2, 1.7, n / 2 - 0.3);
      const loud = (el: HTMLElement) => {
        el.style.webkitTextStroke = '3px var(--ink)';
        el.style.textShadow = '0 5px 0 var(--ink)';
      };
      loud(this.word(`COMBO ×${merges}!`, top, PAL.gold, 2));
      this.after(260, () => loud(this.word(`+${SPECIALS[special].name.toUpperCase()}`, top.clone().setY(1.25), special === 'launch' ? '#7ff2ff' : special === 'splash' ? '#8fdcf6' : '#ff8a7a', 1.4)));
      this.burst(v3(n / 2, 0.9, n / 2), 46, [PAL.gold, PAL.white, PAL.heart, '#7ff2ff']);
      this.kick(3, 280);
      this.flash = Math.max(this.flash, 0.25);
      sfx.chain(Math.min(8, merges));
      sfx.hype();
      this.giftBox(v3(n / 2, 0.5, n / 2 + 0.2));
    });
  }

  /** A clay gift box that hops up, wobbles and bursts open in ribbons and confetti. */
  private giftBox(at: Vector3): void {
    const box = new Group();
    const body = new Geo();
    body.cube(0, 0.1, 0, 0.26, 0.2, 0.26, '#f0584e', 0.03);
    body.cube(0, 0.1, 0, 0.27, 0.205, 0.06, PAL.gold, 0.01);
    body.cube(0, 0.1, 0, 0.06, 0.205, 0.27, PAL.gold, 0.01);
    const lid = new Geo();
    lid.cube(0, 0.025, 0, 0.3, 0.05, 0.3, '#ff7a6e', 0.02);
    lid.cube(0, 0.025, 0, 0.31, 0.055, 0.065, PAL.gold, 0.01);
    lid.cube(0, 0.025, 0, 0.065, 0.055, 0.31, PAL.gold, 0.01);
    for (const sx of [-1, 1]) lid.sphere(v3(sx * 0.05, 0.08, 0), 0.045, PAL.gold, 1.2, 0.8, 0.6, 8, 5, true);
    const bm = new Mesh(body.build(), MATS.gloss);
    const lm = new Mesh(lid.build(), MATS.gloss);
    lm.position.y = 0.2;
    box.add(bm, lm);
    box.position.copy(at);
    this.dyn.add(box);
    const t0 = this.now;
    const step = () => {
      const t = (this.now - t0) / 1000;
      if (t > 1.5) {
        this.dyn.remove(box);
        bm.geometry.dispose();
        lm.geometry.dispose();
        return;
      }
      const hop = Math.min(1, t / 0.35);
      box.position.y = at.y + Math.sin(hop * Math.PI * 0.5) * 0.5;
      const pop = Math.min(1, t / 0.2);
      box.scale.setScalar(1.6 * (t < 0.9 ? pop * (1 + Math.sin(t * 30) * 0.06 * (t > 0.4 ? 1 : 0)) : Math.max(0.01, 1 - (t - 0.9) * 2.4)));
      box.rotation.y = t * 2.2;
      if (t > 0.75) {
        lm.position.y = 0.2 + (t - 0.75) * 1.6;
        lm.rotation.z = (t - 0.75) * 5;
      }
      this.after(0, step);
    };
    this.after(0, step);
    this.after(760, () => {
      this.burst(box.position.clone().setY(box.position.y + 0.25), 40, [PAL.gold, PAL.heart, '#7ff2ff', PAL.white, '#a6e05a']);
      this.sparkle(box.position.clone().setY(box.position.y + 0.3), 18, PAL.gold);
      sfx.pop();
    });
  }

  /** A chain just made a brand-new park piece: a burst in its colors and a shout. */
  private parkPiecePop(f: Flavor, at: Pt): void {
    const c = this.cell(at);
    const C = FLAVOR_COLORS[f];
    this.after(90, () => {
      this.burst(c.clone().setY(0.55), 22, f === 'hang' ? [C[1], C[3], C[2], '#7a7f99'] : [C[0], C[1], C[2], PAL.white]);
      if (f === 'water') this.splash(c.clone().setY(0.4));
      if (f === 'hang')
        // A little flock of bats flaps off.
        for (let k = 0; k < 5; k++)
          this.particles.add({ p: c.clone().setY(0.5), v: v3((Math.random() - 0.5) * 1.6, 1 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8), g: -0.4, max: 1.2, color: '#2b2140', size: 0.06, flat: true, spin: v3(0, 0, 18 + Math.random() * 8), drag: 0.4 });
      this.word(f === 'spin' ? 'SPIN!' : f === 'water' ? 'SPLASH!' : 'BATS!', c.clone().setY(1.05), f === 'hang' ? '#c49dff' : C[0], 1.15);
      if (f === 'water') sfx.splash();
      else sfx.merge(5);
    });
  }

  /** Iron-Gut Ivy's Rough Seas: a wave sloshes every loose tile one way. */
  private startWave(move: MoveResult, dir: Dir): void {
    this.tileAnim = { start: this.now, move, fired: -1 };
    const n = this.n;
    const from = { up: v3(n / 2, 0.3, n + 0.5), down: v3(n / 2, 0.3, -0.5), left: v3(n + 0.5, 0.3, n / 2), right: v3(-0.5, 0.3, n / 2) }[dir];
    this.burst(from, 40, ['#8fdcf6', '#ffffff', '#45a8e0']);
    this.word('SPLOOSH!', v3(n / 2, 1.3, n / 2), '#8fdcf6', 1.4);
    this.kick(3, 300);
    sfx.splash();
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
    el.style.fontSize = `${Math.round(Math.min(this.safe.x1 - this.safe.x0, (this.safe.y1 - this.safe.y0) * 1.3) * 0.62 * k)}px`;
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
    const meet = this.game.phase === 'build' && !b.loop && canConnect(b) && this.mouths.every((m) => m.ready) && !this.mouthsBusy;
    if (!meet) this.goSince = -1;
    else if (this.goSince < 0) this.goSince = this.now;
    // It pops up once the gulps' shouts have had their moment.
    const showGo = meet && this.now - this.goSince > 350;
    this.goEl.hidden = !showGo;
    // HOME floats over the blue pad while you build (until OPEN ME takes over).
    const home = this.game.phase === 'build' && !b.opened && !b.loop && !showGo && this.mouths[1]?.ready;
    this.homeEl.hidden = !home;
    if (home) {
      const h = this.local(this.mouths[1].group.position.clone().setY(this.mouths[1].group.position.y + 0.55));
      this.homeEl.style.transform = `translate(${off.x + h.x}px, ${off.y + h.y + Math.sin(this.now / 260) * 2}px) translate(-50%, -100%)`;
    }
    if (showGo) {
      const a = this.mouths[0].group.position;
      const c = this.mouths[1].group.position;
      const p = this.local(a.clone().add(c).multiplyScalar(0.5).setY(Math.max(a.y, c.y) + 0.95 + (a.distanceTo(c) + 0.64) * 0.1));
      const bob = Math.sin(this.now / 180) * 3;
      this.goEl.style.transform = `translate(${off.x + p.x}px, ${off.y + p.y + bob}px) translate(-50%, -100%) rotate(${Math.sin(this.now / 260) * 3}deg)`;
    }
  }

  // ---- Tool targets ------------------------------------------------------------

  /** Tools that aim (paint, crane, dynamite, the track crew, special pieces) light up the cells they can use. */
  private drawTargets(): void {
    const aim = this.game.aiming;
    if (this.game.phase !== 'build' || !aim) return;
    const b = this.board;
    const blink = Math.floor(this.now / 300) % 2 === 0;
    const pulse = 0.55 + Math.sin(this.now / 160) * 0.25;
    const mark = (x: number, y: number, color: string) => {
      const m = this.markers.get();
      const i = idx(b, x, y);
      const top = b.tiles[i] ? CRATE_H + 0.012 : 0.012;
      const hov = !!this.hover && this.hover.x === x && this.hover.y === y;
      m.position.set(x + 0.5, GRASS_Y + this.terrain.cell(x, y) + top, y + 0.5);
      const s = (hov ? 1.06 : 1) * (b.tiles[i] ? 0.98 : 1);
      m.scale.set(s, 1, s);
      const mat = m.material as MeshBasicMaterial;
      mat.color.set(color);
      mat.opacity = hov ? 1 : pulse + 0.2;
    };
    if (aim.tool === 'crew' && b.loop) {
      // The crew swells the loop out by hand: into any free cell beside it, tile or not.
      for (let y = 0; y < b.size; y++) for (let x = 0; x < b.size; x++) if (bulgeFor(b, x, y, true)) mark(x, y, blink ? PAL.gold : PAL.white);
      return;
    }
    if (aim.tool === 'crew') {
      // The crew lays one piece by hand, right next to an end: in that end's color.
      for (const t of buildTargets(b, 0)) if (!trackAt(b, t.x, t.y)) mark(t.x, t.y, blink ? END_COLORS[t.end] : PAL.white);
      return;
    }
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        const i = idx(b, x, y);
        const tile = b.tiles[i];
        const wall = isWall(b, x, y);
        const special = aim.tool === 'launch' || aim.tool === 'splash' || aim.tool === 'brakes';
        const ok = special
          ? b.ends.some((e) => e.some((c) => c.x === x && c.y === y && !c.cross && !c.special))
          : aim.tool === 'dynamite'
            ? !!b.obstacles[i]
            : aim.tool === 'paint'
              ? !!tile && tile < 7 && !wall
              : aim.first
                ? !wall
                : !!tile && !wall;
        if (ok) mark(x, y, blink ? PAL.heart : PAL.white);
      }
    if (aim.first) mark(aim.first.x, aim.first.y, PAL.gold);
  }

  // ---- The mouths: the two open ends eat tiles ------------------------------------

  /** Where an end's mouth sits: on the platform's edge, or on its head cell's deck. */
  private mouthPos(end: End): Vector3 {
    const b = this.board;
    const pts = this.path.pts;
    if (!b.ends[end].length || pts.length < 2) {
      const q = end === 0 ? pts[pts.length - 1] : pts[0];
      return q ? q.p.clone().setY(q.p.y + 0.02) : this.stationCenter();
    }
    const h = head(b, end);
    const ci = end === 0 ? this.path.cells.length - 1 : 0;
    return v3(h.x + 0.5, this.path.deck(ci) + 0.02, h.y + 0.5);
  }

  /** The directions an end can eat from: open neighbors a tile can stop in. */
  private mouthDirs(end: End): Dir[] {
    const b = this.board;
    const e = b.ends[end];
    if (e[e.length - 1]?.cross) return [];
    const h = head(b, end);
    return DIRS.filter((d) => {
      const t = step(h, d);
      return inBounds(b, t.x, t.y) && !isWall(b, t.x, t.y);
    });
  }

  /** The drag being made: show what this swipe would feed into the track (null clears it). */
  setPreview(dir: Dir | null): void {
    if (!dir || this.game.phase !== 'build' || this.game.aiming || this.board.loop) {
      this.preview = null;
      return;
    }
    if (this.preview?.dir === dir) return;
    const eats = this.game.previewEat(dir);
    if (eats.length) sfx.peek();
    this.preview = { dir, eats, at: this.now };
  }

  private drawMouths(): void {
    const b = this.board;
    // The always-running loop has no mouths: it grows by tapping (kept for the old eat mode).
    const show = this.game.phase === 'build' && !b.opened && !b.loop;
    const connect = show && canConnect(b);
    const pos: Vector3[] = [];
    const t = this.now / 1000;
    this.mouthsBusy = this.gulps.length > 0;
    for (const end of [0, 1] as End[]) {
      const m = this.mouths[end];
      m.group.visible = show;
      // Only the red end eats; blue is home, a glowing pad where the loop closes.
      m.body.visible = end === 0;
      if (!show) {
        m.ready = false;
        continue;
      }
      // Hop to the new head once the tile it ate has been gulped.
      const want = this.mouthPos(end);
      if (!m.ready) {
        m.from.copy(want);
        m.to.copy(want);
        m.hopAt = -1e9;
        m.ready = true;
      } else if (m.to.distanceToSquared(want) > 1e-4) {
        m.from.copy(m.group.position);
        m.to.copy(want);
        m.hopAt = Math.max(this.now, m.hold);
      }
      const k = Math.min(1, Math.max(0, (this.now - m.hopAt) / 300));
      const e = k * k * (3 - 2 * k);
      const p = m.from.clone().lerp(m.to, e);
      p.y += Math.sin(k * Math.PI) * Math.min(0.4, m.from.distanceTo(m.to) * 0.5);
      // On a board cell it waddles round the cell's edge to face where it's looking (clear of tall pieces).
      const lean = b.ends[end].length ? 0.3 : 0;
      p.x += Math.sin(m.yaw) * lean;
      p.z += Math.cos(m.yaw) * lean;
      m.group.position.copy(p);
      pos.push(p);
      if (k < 1) this.mouthsBusy = true;
      // Where to look and how wide to open.
      const dirs = this.mouthDirs(end);
      const fed = this.preview?.eats.find((x) => x.end === end);
      let face: Pt | null = null;
      let open: number;
      let tremble = 0;
      if (fed) {
        // About to eat: turns to the tile and opens wide, quivering.
        const h = head(b, end);
        face = { x: fed.cell.x - h.x, y: fed.cell.y - h.y };
        open = 1;
        tremble = 1;
      } else if (connect) {
        const o = this.mouthPos(end === 0 ? 1 : 0);
        face = { x: o.x - want.x, y: o.z - want.z };
        open = 0.15 + Math.abs(Math.sin(t * 3 + end)) * 0.25;
      } else if (dirs.length) {
        // Hungry: looks around its open sides and chomps at the air.
        const d = dirs[Math.floor(t / 1.7 + end * 0.85) % dirs.length];
        face = DELTA[d];
        const bite = (t * 1.25 + end * 0.4) % 1;
        open = bite < 0.32 ? Math.sin((bite / 0.32) * Math.PI) * 0.75 : 0.12;
      } else {
        // Boxed in: nothing to eat.
        face = { x: 0, y: 1 };
        open = 0.02;
      }
      if (this.preview && !fed) open *= 0.3;
      // Chomp: snaps shut on the tile, then a satisfied bounce.
      const ca = this.now - m.chompAt;
      let squash = 0;
      if (ca > -120 && ca < 0) open = 1.15;
      else if (ca >= 0 && ca < 420) {
        open = ca < 90 ? 0 : Math.min(open, 0.3);
        squash = Math.sin(Math.min(1, ca / 420) * Math.PI * 2) * 0.22 * (1 - ca / 420);
      }
      m.open += (open - m.open) * (ca >= 0 && ca < 90 ? 1 : 0.3);
      const gape = m.open * 0.72 + (tremble ? Math.sin(this.now / 28) * 0.06 : 0);
      m.jaws[0].rotation.y = gape;
      m.jaws[1].rotation.y = -gape;
      const yaw = face ? Math.atan2(face.x, face.y) : 0;
      let dy = yaw - m.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      m.yaw += dy * 0.18;
      m.body.rotation.y = m.yaw;
      const bob = Math.sin(t * 4 + end * 2) * 0.012;
      m.body.position.set(tremble ? Math.sin(this.now / 21) * 0.008 : 0, bob, 0);
      const sc = (fed ? 1.2 : 1.05) * (1 + (connect ? Math.sin(t * 6) * 0.04 : 0));
      m.body.scale.set(sc * (1 + squash), sc * (1 - squash * 1.4), sc * (1 + squash));
      // The glow pad sits on the ground under it.
      m.halo.position.y = this.groundAt(p.x, p.z) - p.y + 0.012;
      const hp = 0.5 + Math.sin(t * 5 + end * 1.3) * 0.5;
      m.haloMat.opacity = fed ? 0.75 : 0.32 + hp * 0.2;
      m.halo.scale.setScalar((fed ? 1.25 : 1) * (0.9 + hp * 0.14));
      if (end === 1) {
        // Home: a big, bright landing pad, lifted clear of the canopy's shade, beckoning when the loop can close.
        m.haloMat.opacity = connect ? 0.95 : 0.6 + hp * 0.35;
        m.halo.scale.setScalar((connect ? 2.1 : 1.7) * (0.92 + hp * 0.12));
        m.halo.position.y += 0.03;
      }
      // "Feed me" chevrons slide into the mouth from each side it can eat from.
      if (!this.preview && !connect && !this.game.aiming)
        for (const d of dirs) {
          const dl = DELTA[d];
          for (let c = 0; c < 2; c++) {
            const ph = (t * 0.9 + c * 0.5 + end * 0.3) % 1;
            const along = 0.78 - ph * 0.5;
            const ch = this.chevrons.get();
            const cx = want.x + dl.x * along;
            const cz = want.z + dl.y * along;
            const lid = this.chevronY(cx, cz);
            ch.position.set(cx, lid, cz);
            ch.rotation.set(0, Math.atan2(-dl.x, -dl.y), 0);
            ch.scale.setScalar(1.3 + (1 - ph) * 0.4);
            const mat = ch.material as MeshBasicMaterial;
            mat.color.set(END_COLORS[end]);
            mat.opacity = Math.sin(ph * Math.PI) * 0.95;
          }
        }
    }
    // The ends meet: a sparkly link between the two mouths, and the OPEN ME tag.
    if (connect && pos.length === 2) {
      // A rainbow of beads arching over both of them.
      const span = pos[1].clone().sub(pos[0]).setY(0).normalize().multiplyScalar(0.32);
      const a = pos[0].clone().sub(span);
      const c = pos[1].clone().add(span);
      const lift = 0.62 + a.distanceTo(c) * 0.1;
      const N = 13;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const bead = this.beads.get();
        const q = a.clone().lerp(c, u);
        q.y += Math.sin(u * Math.PI) * lift + 0.12;
        bead.position.copy(q);
        bead.quaternion.copy(this.camera.quaternion);
        const tw = 0.5 + 0.5 * Math.sin(this.now / 90 - i * 0.9);
        bead.scale.setScalar(0.9 + tw * 0.9);
        const mat = bead.material as MeshBasicMaterial;
        mat.color.set(u < 0.34 ? END_COLORS[0] : u > 0.66 ? END_COLORS[1] : PAL.gold).lerp(new Color('#ffffff'), tw * 0.5);
        mat.opacity = 0.65 + tw * 0.35;
      }
      if (Math.random() < 0.35) {
        const u = Math.random();
        const q = a.clone().lerp(c, u);
        q.y += Math.sin(u * Math.PI) * lift + 0.12;
        this.sparks.add({ p: q, v: v3((Math.random() - 0.5) * 0.5, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5), g: 0.6, max: 0.6, color: Math.random() < 0.5 ? PAL.gold : '#fff6c8', size: 0.028, drag: 0.5 });
      }
    }
  }

  /** Height for a floating arrow: just over whatever stands there (a crate lid, the track, or the ground). */
  private chevronY(x: number, z: number): number {
    const b = this.board;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const g = this.groundAt(x, z);
    if (!inBounds(b, cx, cz)) return g + 0.03;
    return g + (b.tiles[idx(b, cx, cz)] ? CRATE_H + 0.05 : trackAt(b, cx, cz) ? 0.32 : 0.03);
  }

  /** While dragging: the tiles this swipe would feed glow in their mouth's color, with arrows into it. */
  private drawPreview(): void {
    const pv = this.preview;
    const b = this.board;
    const eats = pv && this.game.phase === 'build' && !this.tileAnim ? pv.eats : [];
    this.previewTags.forEach((tag, i) => {
      const e = eats[i];
      tag.hidden = !e;
      if (!e) return;
      const tier = b.tiles[idx(b, e.from.x, e.from.y)] || e.cell.tier;
      const txt = `+${PIECES[tier].name.toUpperCase()}`;
      if (tag.textContent !== txt) tag.textContent = txt;
      tag.style.setProperty('--c', END_COLORS[e.end]);
      const p = this.local(this.cell(e.from).setY(CRATE_H + 0.55));
      const bob = Math.sin(this.now / 140 + i) * 2;
      tag.style.transform = `translate(${this.canvas.offsetLeft + p.x}px, ${this.canvas.offsetTop + p.y + bob}px) translate(-50%, -100%)`;
    });
    if (!eats.length) return;
    const t = this.now / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(this.now / 110);
    for (const e of eats) {
      const color = END_COLORS[e.end];
      // A glowing outline around the tile...
      const o = this.outlines.get();
      const top = GRASS_Y + this.terrain.cell(e.from.x, e.from.y) + CRATE_H + 0.02;
      o.position.set(e.from.x + 0.5, top, e.from.y + 0.5);
      o.scale.setScalar(1.02 + pulse * 0.08);
      const om = o.material as MeshBasicMaterial;
      om.color.set(color).lerp(new Color('#ffffff'), pulse * 0.3);
      om.opacity = 0.85;
      // ...a ghost where it stops (if it travels)...
      if (e.from.x !== e.cell.x || e.from.y !== e.cell.y) {
        const g = this.outlines.get();
        g.position.set(e.cell.x + 0.5, GRASS_Y + this.terrain.cell(e.cell.x, e.cell.y) + 0.02, e.cell.y + 0.5);
        g.scale.setScalar(0.9);
        const gm = g.material as MeshBasicMaterial;
        gm.color.set(color);
        gm.opacity = 0.35 + pulse * 0.25;
      }
      // ...and arrows marching from it into the mouth.
      const mouth = this.mouths[e.end].group.position;
      const from = v3(e.from.x + 0.5, 0, e.from.y + 0.5);
      const to = v3(mouth.x, 0, mouth.z);
      const len = from.distanceTo(to);
      const dir = to.clone().sub(from).normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      const n = Math.max(2, Math.round(len / 0.28));
      for (let k = 0; k < n; k++) {
        const u = ((k + (t * 2.2) % 1) / n) * Math.min(1, (len - 0.15) / len);
        const q = from.clone().lerp(to, u);
        const ch = this.chevrons.get();
        ch.position.set(q.x, Math.max(this.chevronY(q.x, q.z), top + 0.03), q.z);
        ch.rotation.set(0, yaw, 0);
        ch.scale.setScalar(0.9);
        const mat = ch.material as MeshBasicMaterial;
        mat.color.set(color).lerp(new Color('#ffffff'), 0.25);
        mat.opacity = Math.min(1, Math.sin(u * Math.PI) * 1.6);
      }
    }
  }

  /** A swipe fed tiles to the track: they slide in, get gulped, and the track rises in their place. */
  private startGulps(m: MoveResult): void {
    const eaten = m.eaten ?? [];
    if (!eaten.length) return;
    for (const e of eaten) {
      this.eatenCells.add(e.cell);
      this.gulps.push({ tier: e.cell.tier, flavor: e.cell.flavor ?? null, at: { x: e.cell.x, y: e.cell.y }, end: e.end, start: this.now });
      this.eatHold.set(`${e.cell.x},${e.cell.y}`, this.now + SLIDE_MS + GULP_MS * 0.4);
      const mouth = this.mouths[e.end];
      mouth.chompAt = this.now + SLIDE_MS;
      mouth.hold = this.now + SLIDE_MS + GULP_MS * 0.8;
    }
    this.after(SLIDE_MS, () => {
      eaten.forEach((e, i) => this.after(i * 70, () => this.gulpFx(e.cell.tier, e.cell, e.end)));
      if (eaten.length > 1) {
        this.after(240, () => {
          const a = this.cell(eaten[0].cell);
          const c = this.cell(eaten[1].cell);
          const el = this.word('DOUBLE!', a.add(c).multiplyScalar(0.5).setY(1.75), PAL.gold, 1.7);
          el.style.webkitTextStroke = '3px var(--ink)';
          el.style.textShadow = '0 4px 0 var(--ink)';
          this.kick(1.6, 160);
          sfx.hype();
          sfx.chain(2);
        });
      }
    });
  }

  private gulpFx(tier: number, at: Pt, end: End): void {
    const c = this.cell(at);
    const ramp = TIER_RAMPS[Math.max(1, tier)];
    this.burst(c.clone().setY(0.3), 10 + tier * 5, [...ramp.slice(0, 3), END_COLORS[end]]);
    this.dust(c.clone().setY(0.08), 8 + tier * 2, PAL.plaza[2]);
    const el = this.word(`+${PIECES[tier].name.toUpperCase()}!`, c.clone().setY(0.95 + tier * 0.04), ramp[0], 0.85 + tier * 0.14);
    if (tier >= 4) {
      el.style.webkitTextStroke = '2.5px var(--ink)';
      el.style.textShadow = '0 4px 0 var(--ink)';
    }
    this.kick(0.4 + tier * 0.3, 90 + tier * 20);
    sfx.chomp(tier);
  }

  /** Eaten crates squash flat into the track as it rises under them. */
  private drawGulps(): void {
    const b = this.board;
    this.gulps = this.gulps.filter((g) => {
      const el = this.now - g.start;
      if (el < SLIDE_MS) return true;
      const k = (el - SLIDE_MS) / GULP_MS;
      if (k >= 1) return false;
      // A quick bite (squash), then it's swallowed into the ground.
      const bite = Math.min(1, k / 0.3);
      const squash = Math.sin(bite * Math.PI * 0.5) * 0.45;
      const m = this.crate(g.tier, g.at.x, g.at.y, idx(b, g.at.x, g.at.y), 0, -k * k * CRATE_H * 0.8, squash, g.flavor);
      const shrink = 1 - Math.max(0, k - 0.3) / 0.7;
      m.scale.multiplyScalar(Math.max(0.02, shrink));
      (m.material as ReturnType<typeof toon>).emissive.set(END_COLORS[g.end]).multiplyScalar(0.55 * (1 - k));
      return true;
    });
  }

  /** Gridlock: a honk, the whole board shudders, then the ride opens by itself. */
  private gridlockShow(boxed = false): void {
    const n = this.n;
    const top = v3(n / 2, 1.6, n / 2 - 0.2);
    const el = this.word(boxed ? 'BOXED IN!' : 'GRIDLOCK!', top, PAL.gold, 2.3);
    el.style.webkitTextStroke = '3px var(--ink)';
    el.style.textShadow = '0 5px 0 var(--ink)';
    this.after(420, () => {
      const sub = this.word(this.board.loop ? 'Closing the park: last ride!' : this.board.opened === 'circuit' ? 'The ride opens!' : 'Opening as a shuttle', top.clone().setY(1.15), PAL.white, 0.9);
      sub.style.fontFamily = 'var(--font-body)';
    });
    sfx.horn();
    this.kick(4, 520);
    this.wobbleUntil = this.now + 1000;
    this.flash = Math.max(this.flash, 0.22);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      this.dust(v3(n / 2 + Math.cos(a) * n * 0.45, 0.1, n / 2 + Math.sin(a) * n * 0.45), 5, PAL.plaza[2]);
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

  /** The guest under a page point (hovered or tapped), with where their head is on screen. */
  guestAt(clientX: number, clientY: number): { rider: Rider; x: number; y: number } | null {
    if (this.game.phase !== 'build' && this.game.phase !== 'intro') return null;
    let best: { rider: Rider; x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const r of this.game.queue) {
      const p = this.riderPos.get(r.id);
      if (!p) continue;
      const g = personGeo(r.look, 'smile');
      const h = g.headY * g.scale * STAND_SCALE;
      const mid = this.project(v3(p.x, h * 0.55, p.z));
      const top = this.project(v3(p.x, h + 0.06, p.z));
      const foot = this.project(v3(p.x, 0, p.z));
      const r0 = Math.max(10, (foot.y - top.y) * 0.45);
      const d = Math.hypot(clientX - mid.x, (clientY - mid.y) * 0.7);
      if (d < r0 && d < bestD) {
        bestD = d;
        best = { rider: r, x: top.x, y: top.y };
      }
    }
    return best;
  }

  /** Screen points of the guests in line (for tests and tooling). */
  guestScreenPoints(): { id: number; x: number; y: number }[] {
    return this.game.queue.flatMap((r) => {
      const p = this.riderPos.get(r.id);
      if (!p) return [];
      const g = personGeo(r.look, 'smile');
      const q = this.project(v3(p.x, g.headY * g.scale * STAND_SCALE * 0.55, p.z));
      return [{ id: r.id, x: q.x, y: q.y }];
    });
  }

  /** Thought bubbles over guests' heads (one at a time, now and then). */
  private thoughts: { el: HTMLElement; at: () => Vector3 | null; until: number }[] = [];
  private nextThought = 0;

  private updateThoughts(): void {
    const g = this.game;
    const now = this.now;
    // Bubbles follow their guest; old ones fade out.
    this.thoughts = this.thoughts.filter((t) => {
      const at = t.at();
      if (!at || now > t.until) {
        t.el.classList.add('out');
        setTimeout(() => t.el.remove(), 300);
        return false;
      }
      const p = this.local(at);
      t.el.style.transform = `translate(${this.canvas.offsetLeft + p.x}px, ${this.canvas.offsetTop + p.y}px) translate(-20%, -100%)`;
      return true;
    });
    if (now < this.nextThought || this.thoughts.length || this.inShot) return;
    this.nextThought = now + 2600 + Math.random() * 2400;
    if (g.phase === 'build' || g.phase === 'intro') {
      const standing = g.queue.filter((r) => this.riderPos.get(r.id) && !this.riderPos.get(r.id)!.moving && r.id !== this.hoverId);
      if (!standing.length) return;
      const r = standing[Math.floor(Math.random() * standing.length)];
      const stats = g.stats;
      const built = g.board.ends[0].length + g.board.ends[1].length;
      const text = lineThought(r, {
        pukes: built ? g.pukes(r) : 0,
        length: built,
        inversions: stats.inversions,
        thrill: stats.thrill,
        ready: g.openKind === 'circuit',
        dark: g.room <= 3,
      });
      const geo = personGeo(r.look, 'smile');
      this.think(text, () => {
        const p = this.riderPos.get(r.id);
        return p && g.queue.includes(r) ? v3(p.x, geo.headY * geo.scale * STAND_SCALE + 0.08, p.z) : null;
      });
    } else if (g.phase === 'results' && this.lineup.length) {
      const w = this.lineup[Math.floor(Math.random() * this.lineup.length)];
      if (!w.rider || w.x !== w.tx) return;
      const geo = personGeo(w.look, 'smile');
      this.think(rideThought(w.rider, w.pukes ?? 0), () => (this.lineup.includes(w) ? v3(w.x, this.floorY(w.x, w.z) + geo.headY * geo.scale * STAND_SCALE + 0.08, w.z) : null));
    }
  }

  private think(text: string, at: () => Vector3 | null): void {
    const el = document.createElement('div');
    el.className = 'thought';
    el.textContent = text;
    this.canvas.parentElement!.append(el);
    this.thoughts.push({ el, at, until: this.now + 2600 + text.length * 45 });
  }

  /** The guest the pointer is on: they wave back. */
  hoverId: number | null = null;

  private drawQueue(dt: number): void {
    if (this.game.phase !== 'build' && this.game.phase !== 'intro' && !this.ridePending) return;
    const queue = this.game.queue;
    // The always-running ride: riders sitting in the parked train aren't in the line.
    const seated = new Set(this.board.loop ? this.seatRiders.map((r) => r.id) : []);
    let li = 0;
    queue.forEach((r) => {
      if (seated.has(r.id)) return;
      const i = li++;
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
      const hovered = this.hoverId === r.id;
      // Everyone has a personality: fidgets, fist pumps, selfies, nervous glances.
      const a = p.moving ? { arms: 0, hop: 0, wobble: 0, yaw: 0 } : lineAntics(r, this.now / 1000);
      const rig = this.person(r.look, v3(p.x, 0, p.z), {
        walk: p.moving ? p.ph : undefined,
        yaw: p.moving ? yaw : a.yaw,
        face: hovered ? 'grin' : lineFace(r, sick),
        arms: hovered ? 0.8 : a.arms,
        wobble: hovered ? 0 : a.wobble,
      });
      // The hovered guest bounces and waves.
      if (!p.moving) rig.position.y = hovered ? Math.abs(Math.sin(this.now / 150)) * 0.06 : a.hop;
      // Only the ones this ride will make puke get a (green) thought bubble; hover for the rest.
      if (this.game.phase === 'build' && !p.moving && sick) {
        const g = personGeo(r.look, 'smile');
        this.bubble('sick', v3(p.x, g.headY * g.scale * STAND_SCALE + 0.1, p.z));
      }
    });
  }

  private updateWalkers(dt: number): void {
    for (const w of this.walkers) {
      if (w.delay > 0) {
        w.delay -= dt * 1000;
        this.person(w.look, v3(w.x, this.floorY(w.x, w.z), w.z), { face: walkerFace(w) });
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
      const rig = this.person(w.look, v3(w.x, this.floorY(w.x, w.z), w.z), {
        walk: arrived ? undefined : w.ph,
        yaw: arrived ? 0 : Math.atan2(dx, dz),
        face: walkerFace(w),
        wobble: w.sick && !puking ? 0.12 : 0,
        arms: puking ? 0.35 : 0,
      });
      if (puking) rig.rotation.x = 0.45;
      if (w.exit === 'float') {
        // Ghosts drift up and fade into the sky.
        w.fly = (w.fly ?? 0) + dt * 0.5;
        rig.position.y += w.fly;
        rig.scale.multiplyScalar(Math.max(0.05, 1 - w.fly * 0.45));
        rig.rotation.y = w.fly * 3;
        if (w.fly > 2) w.hold = false;
      }
      if (w.mood) {
        const g = personGeo(w.look, 'smile');
        this.bubble(w.mood, v3(w.x, this.floorY(w.x, w.z) + g.headY * g.scale * STAND_SCALE + 0.05, w.z));
      }
    }
    this.walkers = this.walkers.filter((w) => !w.gone && (w.hold || !(w.x === w.tx && w.z === w.tz)));
  }

  // ---- Train -------------------------------------------------------------------------

  /** Places one car on the track at arc length s, with its rider (if any). */
  car(
    kind: CarKind,
    s: number,
    rider?: { look: Rider['look']; face: Face; arms: number },
    pose?: { spin?: number; hang?: number; sway?: number },
  ): { head: Vector3; mouth: Vector3; fwd: Vector3; up: Vector3; t: Vector3 } {
    const f = this.path.sample(s);
    const m = new Matrix4().makeBasis(f.right, f.up, f.t).setPosition(f.p.clone().addScaledVector(f.up, 0.025));
    const hang = pose?.hang ?? 0;
    if (hang > 0) {
      // A suspended car: it swings round the rail like a gondola and hangs below it,
      // staying upright (in the track's frame) and swaying like a pendulum.
      const th = hang * Math.PI;
      const r = 0.025 + HANG_DROP * Math.sin(th / 2) ** 2;
      // The arm swings round the rail (plus the pendulum sway); the car keeps upright with it.
      const phi = th + (pose?.sway ?? 0) * hang;
      m.multiply(new Matrix4().makeRotationZ(phi)).multiply(M(0, r, 0)).multiply(new Matrix4().makeRotationZ(-th));
      this.hanger(m, th, r);
    }
    if (pose?.spin) m.multiply(new Matrix4().makeRotationY(pose.spin));
    m.multiply(new Matrix4().makeScale(CAR_SCALE, CAR_SCALE, CAR_SCALE));
    const c = this.cars.get();
    c.geometry = carGeo(kind);
    c.matrix.copy(m);
    c.matrixWorldNeedsUpdate = true;
    let head = f.p.clone().addScaledVector(f.up, 0.3);
    let mouth = head.clone();
    if (rider) {
      const seat = new Matrix4().copy(m).multiply(M(0, 0.075, -0.025)).multiply(new Matrix4().makeScale(0.76, 0.76, 0.76));
      this.person(rider.look, null, { seated: true, matrix: seat, face: rider.face, arms: rider.arms });
      const g = personGeo(rider.look, rider.face, true);
      head = v3(0, (g.headY - 0.03) * g.scale, 0.09 * g.scale).applyMatrix4(seat);
      mouth = g.mouth.clone().multiplyScalar(g.scale).applyMatrix4(seat);
    }
    if (!pose?.spin && !hang) return { head, mouth, fwd: f.t, up: f.up, t: f.t };
    // Spinning or hanging: the riders face (and puke) wherever the car points now.
    const e = m.elements;
    const fwd = v3(e[8], e[9], e[10]).normalize();
    const up = v3(e[4], e[5], e[6]).normalize();
    if (!rider) head = v3(0, 0.3, 0).applyMatrix4(m);
    return { head, mouth: rider ? mouth : head.clone(), fwd, up, t: f.t };
  }

  /** The arm a suspended car hangs from: from the rail's underside down to the car's roof bar. */
  private hanger(carM: Matrix4, th: number, r: number): void {
    const h = this.hangers.get();
    h.matrix.copy(carM).multiply(new Matrix4().makeRotationZ(th + Math.PI)).multiply(new Matrix4().makeScale(1, Math.max(0.01, r), 1));
    h.matrixWorldNeedsUpdate = true;
  }

  // ---- The always-running ride (v0.23) ------------------------------------------------

  /** After the track changed: keep the parked train on the same piece (the loop may have grown behind it). */
  private remapTrain(): void {
    const b = this.board;
    const T = this.loopTrain;
    const keys = b.loop ? ['st', ...b.ends[0].map((c) => `${c.x},${c.y}`)] : [];
    if (T.keys.length && keys.length) {
      const i = Math.floor(T.shown);
      const j = keys.indexOf(T.keys[i] ?? '');
      if (j >= 0) T.shown = j + (T.shown - i);
      else T.shown = this.game.trainPos;
    }
    T.keys = keys;
    if (T.shown >= keys.length) T.shown = 0;
  }

  /** Arc length of stop k (0 = the station; past the last stop it wraps round to the station again). */
  private stopS(k: number): number {
    const L = this.loopTrain.keys.length;
    const lap = Math.floor(k / L);
    const i = k - lap * L;
    let s = this.path.parkAt;
    if (i > 0) {
      // Stop i is board piece ends[0][i - 1]: chain cell i + 1 (after the two station cells).
      const r = this.path.range(i + 1);
      s = r ? (r[0] + r[1]) / 2 : s;
    }
    return s + lap * this.path.length;
  }

  /**
   * The train on the always-running loop: it glides one stop on with every move,
   * swooshes through the station when a lap comes round (and the lap pays out there),
   * and carries the first few riders in line.
   */
  private drawLoopTrain(dt: number): void {
    const path = this.path;
    const T = this.loopTrain;
    const L = T.keys.length;
    if (!path || path.pts.length < 2 || !L || !path.closed) return;
    const target = this.homeRun ? 0 : Math.min(L - 1, this.game.trainPos);
    let d = (((target - T.shown) % L) + L) % L;
    if (d > L - 1e-4) d = 0;
    const lap = this.laps[0];
    let speed = 0;
    if (d > 1e-4) {
      // Quick off the mark, easing into the stop; the long run round the station is a swoosh.
      const v = Math.max(2.4, d * 5.5);
      const step = d - v * dt < 1e-3 ? d : v * dt;
      const before = T.shown;
      T.shown += step;
      speed = step / Math.max(1e-4, dt);
      if (Math.floor(before) < L - 1 && T.shown >= L - 1 && T.shown < L - 1e-6) sfx.swoosh();
      if (T.shown >= L - 1e-6) {
        T.shown = Math.max(0, T.shown - L);
        // Home through the station: that's a lap.
        const sc = this.stationCenter();
        this.dust(sc.clone().setY(sc.y + 0.05), 10, PAL.plaza[2]);
        if (lap && !lap.paying) this.payLap(lap);
      }
    }
    // A lap that never saw the train come round (undo, a new day...) still pays out.
    if (lap && !lap.paying && this.now - lap.at > 1600) this.payLap(lap);
    if (this.homeRun && d <= 1e-4 && !this.laps.some((l) => l.paying)) {
      this.homeRun();
      return;
    }
    const i0 = Math.floor(T.shown);
    const a = this.stopS(i0);
    const lead = a + (this.stopS(i0 + 1) - a) * (T.shown - i0);
    const riders = this.laps[0]?.riders ?? this.game.queue;
    const n = Math.min(6, Math.max(3, riders.length));
    this.seatRiders = riders.slice(0, n);
    this.seatPts = [];
    const moving = speed > 0.3;
    const paying = this.laps[0]?.paying ? this.laps[0] : null;
    for (let i = 0; i < n; i++) {
      const r = this.seatRiders[i];
      const willPuke = !!r && this.game.phase === 'build' && this.game.pukes(r) > 0;
      const puked = !!r && !!paying && (paying.e.tickets.find((t) => t.rider.id === r.id)?.pukes ?? 0) > 0;
      const face = puked ? 'puke' : moving ? 'joy' : r ? lineFace(r, willPuke) : 'smile';
      const q = this.car(i === 0 ? 'lead' : i === n - 1 ? 'tail' : 'mid', lead - i * CAR_GAP, r ? { look: r.look, face, arms: puked ? 0.35 : moving ? 0.9 : 0.15 } : undefined);
      this.seatPts.push({ head: q.head, mouth: q.mouth, fwd: q.fwd, carry: q.t.clone().multiplyScalar(moving ? 1 : 0) });
      // Seated guests can still be hovered (and think out loud) where they sit.
      if (r && this.game.queue.includes(r)) this.riderPos.set(r.id, { x: q.head.x, z: q.head.z, moving: false, ph: 0 });
    }
  }

  /** The train came round: pukers puke, each pops their tickets, and the lap's total lands over the station. */
  private payLap(l: (typeof this.laps)[number]): void {
    l.paying = true;
    const e = l.e;
    const sc = this.stationCenter();
    const pukers = e.tickets.filter((t) => t.pukes > 0);
    const GAP = Math.max(45, Math.min(120, 600 / Math.max(1, pukers.length)));
    pukers.forEach((t, j) => {
      const seat = this.seatRiders.findIndex((r) => r.id === t.rider.id);
      const src = () => {
        const q = seat >= 0 ? this.seatPts[seat] : null;
        if (q) return { p: q.mouth.clone(), dir: q.fwd.clone().multiplyScalar(0.5).add(v3(0, 0.55, 0.45)) };
        const p = this.riderPos.get(t.rider.id);
        return p ? { p: v3(p.x, 0.4, p.z + 0.06), dir: v3(0, -0.3, 1) } : null;
      };
      this.after(j * GAP, () => {
        const s0 = src();
        if (!s0) return;
        this.pukeStream(src, 380 + Math.min(500, t.pukes * 90), t.pukes >= 4 || !!t.rider.boss);
        // Over each rider's own head (staggered so neighbours don't collide).
        const el = this.word(`+${t.paid.toLocaleString()}`, s0.p.clone().setY(s0.p.y + 0.32 + (j % 2) * 0.2), PAL.gold, 0.7 + Math.min(0.4, t.pukes * 0.07), 1300, true);
        el.classList.add('w3d-pay');
        sfx.puke(j);
        if (t.rider.boss) {
          this.flashScreen(0.7);
          sfx.bossPuke();
          this.kick(2.6, 280);
        }
      });
    });
    const end = pukers.length * GAP + 260;
    this.after(end, () => {
      const top = sc.clone().setY(sc.y + 1.05);
      if (e.total > 0) {
        const el = this.word(`LAP ${e.lap} · +${e.total.toLocaleString()}`, top, PAL.gold, Math.min(2.8, 1.9 + e.lap * 0.1) * (this.compact ? 0.5 : 1), 2000, true);
        el.classList.add('w3d-lap');
        sfx.register(e.lap);
        this.kick(1 + Math.min(2, e.lap * 0.15), 220);
        this.burst(sc.clone().setY(sc.y + 0.5), Math.min(70, 24 + e.lap * 4), [PAL.gold, '#fff6c8', PAL.heart, PAL.gold]);
        this.sparkle(top.clone().setY(top.y - 0.2), 16, PAL.gold);
        if (e.bossHits) {
          const c = this.word(`CRACK${e.bossHits > 1 ? ` ×${e.bossHits}` : ''}!`, top.clone().setY(top.y + 0.5), PAL.heart, this.compact ? 1 : 1.6, 1700, true);
          c.classList.add('w3d-lap');
        }
      } else {
        const el = this.word(`LAP ${e.lap} · nobody puked`, top, '#d5d0e2', 1.1, 1900, true);
        el.classList.add('w3d-dud');
        sfx.dud();
      }
      this.onLap(e.lap, e.total, e.bossHits);
    });
    this.after(end + 650, () => this.lapOff(l));
  }

  /** After a lap the riders get off and wander away (an unbroken boss stays in line). */
  private lapOff(l: (typeof this.laps)[number]): void {
    const i = this.laps.indexOf(l);
    if (i < 0) return;
    const st = this.board.station;
    l.riders.forEach((r, k) => {
      if (this.game.queue.some((q) => q.id === r.id)) return;
      const seat = this.seatRiders.findIndex((x) => x.id === r.id);
      const sp = seat >= 0 ? this.seatPts[seat]?.head : null;
      const lp = this.riderPos.get(r.id);
      this.riderPos.delete(r.id);
      const from = sp ? v3(sp.x, 0, sp.z + 0.25) : lp ? v3(lp.x, 0, lp.z) : null;
      if (!from) return;
      const pukes = l.e.tickets.find((t) => t.rider.id === r.id)?.pukes ?? 0;
      const side = from.x < this.n / 2 ? -1 : 1;
      this.addWalker({
        look: r.look,
        x: from.x,
        z: from.z,
        tx: side > 0 ? this.n + 1.1 : -1.1,
        tz: st.y + 1.6 + Math.random() * 0.9,
        speed: pukes ? 1.15 : 1.7,
        delay: k * 50,
        sick: pukes > 0,
        mood: pukes ? 'sick' : 'meh',
        rider: r,
        pukes,
      });
    });
    this.laps.splice(i, 1);
  }

  /** A new piece of the loop: it swells up out of the ground with a burst and its name. */
  private lastGrow = -1e9;
  private growFx(laid: { x: number; y: number; tier: number }): void {
    const c = this.cell(laid);
    const tier = laid.tier;
    const ramp = TIER_RAMPS[Math.max(1, tier)];
    this.burst(c.clone().setY(0.3), 12 + tier * 5, [...ramp.slice(0, 3), PAL.gold]);
    this.dust(c.clone().setY(0.08), 10 + tier * 2, PAL.plaza[2]);
    this.flashes.set(idx(this.board, laid.x, laid.y), this.now + 150);
    const el = this.word(tier ? `+${PIECES[tier].name.toUpperCase()}!` : '+TRACK', c.clone().setY(0.95 + tier * 0.04), tier ? ramp[0] : PAL.white, tier ? 0.85 + tier * 0.14 : 0.7);
    if (tier >= 4) {
      el.style.webkitTextStroke = '2.5px var(--ink)';
      el.style.textShadow = '0 4px 0 var(--ink)';
    }
    this.kick(0.5 + tier * 0.3, 110 + tier * 20);
    if (this.now - this.lastGrow > 80) sfx.grow();
    this.lastGrow = this.now;
    if (tier) this.after(90, () => sfx.chomp(tier));
  }

  /** Growable tiles this frame (cell index to hop lift and glow), and the bulge the hovered one would make. */
  private growable(): Map<number, { lift: number; glow: number; on: boolean }> {
    const out = new Map<number, { lift: number; glow: number; on: boolean }>();
    const g = this.game;
    const b = this.board;
    if (!b.loop || g.phase !== 'build' || g.aiming || this.ride || this.tileAnim) return out;
    const hv = this.hover;
    const cells = g.growCells;
    const hov = hv && cells.some((c) => c.x === hv.x && c.y === hv.y) ? bulgeFor(b, hv.x, hv.y) : null;
    cells.forEach((c, k) => {
      const on = !!hov && (samePt(hov.c, c) || samePt(hov.d, c));
      // A little hop every couple of seconds, rippling across the growable tiles.
      const ph = ((this.now / 1000 - k * 0.12) % 1.8) / 0.32;
      const hop = ph < 1 ? Math.sin(ph * Math.PI) * 0.09 : 0;
      const pulse = 0.5 + 0.5 * Math.sin(this.now / 230 - k * 0.8);
      out.set(idx(b, c.x, c.y), { lift: on ? 0.1 + Math.abs(Math.sin(this.now / 140)) * 0.04 : hop, glow: on ? 0.6 : 0.22 + pulse * 0.28, on });
    });
    return out;
  }

  /** Tiles you can tap to grow the loop glow in their own track color; hovering shows both cells the bulge takes. */
  private drawGrow(): void {
    const g = this.game;
    const b = this.board;
    if (!b.loop || g.phase !== 'build' || g.aiming || this.ride || this.tileAnim) return;
    const cells = g.growCells;
    if (!cells.length) return;
    const hv = this.hover;
    const hov = hv && cells.some((c) => c.x === hv.x && c.y === hv.y) ? bulgeFor(b, hv.x, hv.y) : null;
    const white = new Color('#ffffff');
    const lifts = this.growable();
    const onLoop = new Set([...b.ends[0], { x: b.station.x, y: b.station.y }, { x: b.station.x + 1, y: b.station.y }].map((c) => `${c.x},${c.y}`));
    const t = this.now / 1000;
    const ring = (x: number, y: number, on: boolean, k: number) => {
      const i = idx(b, x, y);
      const tile = b.tiles[i];
      const ground = GRASS_Y + this.terrain.cell(x, y);
      const lid = ground + (tile ? CRATE_H + 0.02 + (lifts.get(i)?.lift ?? 0) : 0.02);
      const pulse = 0.5 + 0.5 * Math.sin(this.now / 230 - k * 0.8);
      const color = TIER_RAMPS[Math.max(1, tile)][1];
      // A bright pad on the ground, wider than the crate...
      const pad = this.outlines.get();
      pad.position.set(x + 0.5, ground + 0.015, y + 0.5);
      pad.scale.setScalar(on ? 1.42 : 1.22 + pulse * 0.1);
      const pm = pad.material as MeshBasicMaterial;
      pm.color.set(PAL.gold).lerp(white, on ? 0.6 : pulse * 0.35);
      pm.opacity = on ? 1 : 0.55 + pulse * 0.4;
      // ...a ring round the lid in the piece's own track color...
      const o = this.outlines.get();
      o.position.set(x + 0.5, lid, y + 0.5);
      o.scale.setScalar(on ? 1.1 : 0.98 + pulse * 0.06);
      const mat = o.material as MeshBasicMaterial;
      mat.color.set(color).lerp(white, on ? 0.6 : 0.2 + pulse * 0.3);
      mat.opacity = on ? 1 : 0.65 + pulse * 0.35;
      // ...and arrows marching over it into the ride.
      const to = DIRS.map((d) => DELTA[d]).find((dl) => onLoop.has(`${x + dl.x},${y + dl.y}`));
      if (!to) return;
      for (let c = 0; c < 2; c++) {
        const ph = (t * 1.1 + c * 0.5 + k * 0.17) % 1;
        const along = -0.3 + ph * 0.75;
        const ch = this.chevrons.get();
        ch.position.set(x + 0.5 + to.x * along, lid + 0.02, y + 0.5 + to.y * along);
        ch.rotation.set(0, Math.atan2(to.x, to.y), 0);
        ch.scale.setScalar(on ? 1.25 : 1.05);
        const cm = ch.material as MeshBasicMaterial;
        cm.color.set(on ? PAL.white : PAL.gold);
        cm.opacity = Math.sin(ph * Math.PI) * 0.95;
      }
    };
    cells.forEach((c, k) => {
      const on = !!hov && (samePt(hov.c, c) || samePt(hov.d, c));
      ring(c.x, c.y, on, k);
    });
    // The partner cell the bulge takes along (flat track if it's empty).
    if (hov) for (const p of [hov.c, hov.d]) if (!cells.some((c) => samePt(c, p))) ring(p.x, p.y, true, 0);
  }

  private drawParkedTrain(): void {
    if (!this.path || this.path.pts.length < 2) return;
    const lead = parkS(this.path, this.board);
    const u0 = this.path.range(this.path.indexOf(this.board.station.x + 1, this.board.station.y))[0];
    const fit = Math.max(1, Math.floor((lead - u0 - 0.6) / CAR_GAP) + 1);
    const n = Math.max(2, Math.min(fit, Math.max(3, this.game.queue.length), 16));
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
  dramatic(at: () => Vector3, ms: number, zoom = 0.35, slow = 0.15, caption?: string): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (!this.shot) {
      sfx.slowIn();
      music.slowmo(true);
      this.shotAt.copy(at());
      this.flash = Math.max(this.flash, 0.35);
      this.beat = this.now + 140;
    }
    this.shot = { at, caption, start: this.now, until: this.now + ms, zoom, slow, yaw: (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.2) };
    if (caption) {
      this.caption.textContent = caption;
      this.caption.style.setProperty('--ms', `${ms}ms`);
      this.caption.classList.remove('on');
      void this.caption.offsetWidth;
      this.caption.classList.add('on');
    }
  }

  /** Take the on-ride photo shortly, from a camera mounted on the track. */
  requestPhoto(pose: () => { eye: Vector3; look: Vector3; up: Vector3; splat?: boolean }, delay = 60): void {
    if (photoStore.url || this.photoReq) return;
    this.photoReq = { due: this.now + delay, pose };
  }

  /** Renders the photo view, keeps it, and puts the park view back before anyone sees. */
  private capturePhoto(): void {
    const req = this.photoReq!;
    this.photoReq = null;
    const cam = this.camera;
    const saved = { pos: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov };
    const u = this.post.mat.uniforms;
    const cine = u.uCine.value;
    const fl = u.uFlash.value;
    u.uCine.value = 0;
    u.uFlash.value = 0;
    const pose = req.pose();
    cam.up.copy(pose.up);
    cam.position.copy(pose.eye);
    cam.fov = 50;
    cam.updateProjectionMatrix();
    cam.lookAt(pose.look);
    cam.rotateZ((Math.random() < 0.5 ? -1 : 1) * 0.05);
    cam.updateMatrixWorld();
    // Flash! A bright light right at the lens, a hair above it.
    this.flashLight.position.copy(pose.eye).add(new Vector3(0, 0.05, 0));
    this.flashLight.intensity = 1.6;
    const sun = this.sun.intensity;
    this.sun.intensity = sun * 0.9;
    this.post.render(this.gl, this.scene, cam, this.now / 1000);
    this.flashLight.intensity = 0;
    this.sun.intensity = sun;
    const src = this.gl.domElement;
    const out = document.createElement('canvas');
    out.width = 640;
    out.height = 480;
    const sw = Math.min(src.width, (src.height * 4) / 3);
    const sh = (sw * 3) / 4;
    const o = out.getContext('2d')!;
    o.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, 640, 480);
    // Flash falloff: a warm, bright middle and corners that drop off.
    const g = o.createRadialGradient(320, 250, 60, 320, 250, 430);
    g.addColorStop(0, 'rgba(255,248,236,0.16)');
    g.addColorStop(0.55, 'rgba(255,248,236,0)');
    g.addColorStop(1, 'rgba(20,12,30,0.4)');
    o.fillStyle = g;
    o.fillRect(0, 0, 640, 480);
    // Sometimes the puke cam gets hit.
    if (pose.splat) {
      const sx = Math.random() < 0.5 ? 80 : 560;
      const sy = 90 + Math.random() * 260;
      o.fillStyle = 'rgba(150, 200, 70, 0.78)';
      for (let k = 0; k < 9; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = k === 0 ? 0 : 20 + Math.random() * 45;
        o.beginPath();
        o.arc(sx + Math.cos(a) * d, sy + Math.sin(a) * d, k === 0 ? 34 : 6 + Math.random() * 12, 0, Math.PI * 2);
        o.fill();
      }
      o.fillStyle = 'rgba(230, 250, 180, 0.5)';
      o.beginPath();
      o.arc(sx - 10, sy - 12, 9, 0, Math.PI * 2);
      o.fill();
    }
    // The disposable camera's date stamp.
    const d = new Date();
    const stamp = `'${String(d.getFullYear()).slice(2)} ${d.getMonth() + 1} ${d.getDate()}`;
    o.font = '600 22px "Courier New", monospace';
    o.textAlign = 'right';
    o.textBaseline = 'alphabetic';
    o.shadowColor = 'rgba(255,120,30,0.9)';
    o.shadowBlur = 6;
    o.fillStyle = '#ffa23a';
    o.fillText(stamp, 612, 456);
    o.shadowBlur = 0;
    const url = out.toDataURL('image/jpeg', 0.9);
    cam.up.set(0, 1, 0);
    cam.position.copy(saved.pos);
    cam.quaternion.copy(saved.q);
    cam.fov = saved.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    u.uCine.value = cine;
    u.uFlash.value = fl;
    this.post.render(this.gl, this.scene, cam, this.now / 1000);
    this.flash = 1.6;
    sfx.shutter();
    photoStore.url = url;
    this.showPolaroid(url);
    const r = this.game.result;
    if (r) {
      const pukes = r.tickets.reduce((a, t) => a + t.pukes, 0);
      const green = r.tickets.filter((t) => t.pukes > 0).length;
      composeCard(url, {
        title: 'LOOPHOLE',
        sub: `${this.game.cfg.park.name} · day ${this.game.dayNum}`,
        lines: [
          `${r.stats.length} pieces · ${r.stats.inversions} upside down`,
          `${green} of ${r.tickets.length} riders went green · ${pukes} pukes`,
          `${r.total.toLocaleString()} tickets${r.passed ? ' · target smashed' : ''}`,
        ],
        stamp: 'ON-RIDE PHOTO',
      })
        .then((card) => (photoStore.card = card))
        .catch(() => {});
    }
  }

  private showPolaroid(url: string): void {
    this.polaroid?.remove();
    const p = document.createElement('div');
    p.className = 'polaroid';
    p.innerHTML = `<img alt="On-ride photo" src="${url}"><span>ON-RIDE PHOTO</span>`;
    p.style.left = `${this.canvas.offsetLeft + this.safe.x1 - 12}px`;
    p.style.top = `${this.canvas.offsetTop + this.safe.y1 - 12}px`;
    this.canvas.parentElement!.append(p);
    this.polaroid = p;
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
        tz: this.board.station.y + 1.62 + row * 0.4,
        speed: 1.3,
        sick: pukes > 0,
        delay: i * 90,
        hold: true,
        rider,
        pukes,
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
    w.pukeUntil = this.gameNow + 900;
    w.sick = true;
    // Doubled over: out of the mouth, forward and down.
    this.pukeStream(() => (this.lineup.includes(w) ? { p: this.lineupHead(i).add(v3(0, -0.06, 0.06)), dir: v3(0, -0.35, 1) } : null), 500 + Math.min(700, n * 25), n > 40);
  }

  /** The curtain call is over: everyone heads for the exits. */
  /**
   * The curtain call is over. Everyone leaves in character: pukers wobble off to
   * queue for the porta-potties, happy riders run back to the line for another go,
   * and ghosts float away.
   */
  dismiss(): void {
    const n = this.n;
    const z = this.board.station.y + 2.02;
    this.potties = [
      { x: -0.28, z, dir: 1 },
      { x: n + 0.28, z, dir: -1 },
    ].map((p) => ({ ...p, ...this.buildPotty(p.x, p.z), line: [] as Walker[], entering: null as Walker | null, busyUntil: 0, shakeUntil: 0, doorUntil: 0 }));
    this.lineup.forEach((w, i) => {
      w.delay = i * 70;
      w.mood = undefined;
      if (w.rider?.kind === 'ghost') {
        w.exit = 'float';
        w.fly = 0;
        w.hold = true;
      } else if ((w.pukes ?? 0) > 0) {
        const pot = this.potties[w.x < n / 2 ? 0 : 1];
        w.exit = 'potty';
        w.hold = true;
        w.speed = 0.5 + Math.random() * 0.15;
        w.sick = true;
        pot.line.push(w);
        this.linePotty(pot);
      } else {
        w.exit = 'again';
        w.hold = false;
        const q = this.slot(Math.max(0, this.game.queue.length - 1));
        w.tx = q.x + (Math.random() - 0.5) * 0.3;
        w.tz = q.z;
        w.speed = 1.5 + Math.random() * 0.4;
        if (Math.random() < 0.5) this.after(i * 70 + 200, () => this.word('AGAIN!', v3(w.x, 0.7, w.z), PAL.gold, 0.8));
      }
    });
    this.lineup = [];
  }

  /** Porta-potties at the front corners of the plaza while the park empties. */
  private potties: {
    x: number;
    z: number;
    dir: number;
    group: Group;
    door: Group;
    line: Walker[];
    entering: Walker | null;
    busyUntil: number;
    shakeUntil: number;
    doorUntil: number;
  }[] = [];

  /** Queue spots: a line running in toward the middle of the plaza. */
  private linePotty(p: (typeof this.potties)[number]): void {
    p.line.forEach((w, k) => {
      w.tx = p.x + p.dir * (0.3 + k * 0.24);
      w.tz = p.z + 0.08;
    });
  }

  private buildPotty(x: number, z: number): { group: Group; door: Group } {
    const g = new Geo();
    const body = '#45a8e0';
    g.box(M(0, 0.26, 0), 0.26, 0.5, 0.26, body, 0.03, shade(body, 0.12));
    g.box(M(0, 0.53, 0), 0.3, 0.05, 0.3, shade(body, -0.2), 0.02);
    g.cube(0, 0.012, 0, 0.3, 0.024, 0.3, '#d9dbe6', 0.006);
    const group = new Group();
    const mesh = new Mesh(g.build(), MATS.matte);
    mesh.castShadow = true;
    group.add(mesh);
    // The door, hinged on its left edge, with a crescent moon.
    const d = new Geo();
    d.box(M(0.11, 0.24, 0), 0.22, 0.42, 0.02, '#2f86c8', 0.008);
    d.sphere(v3(0.11, 0.4, 0.012), 0.03, '#ffd23f', 1, 1, 0.3, 10, 6, true);
    d.sphere(v3(0.122, 0.405, 0.016), 0.026, '#2f86c8', 1, 1, 0.3, 10, 6, true);
    const door = new Group();
    door.add(new Mesh(d.build(), MATS.matte));
    door.position.set(-0.11, 0.02, 0.135);
    group.add(door);
    group.position.set(x, 0, z);
    group.scale.setScalar(1.15);
    this.world.add(group);
    return { group, door };
  }

  /** The front of each potty line goes in; the potty rocks and puffs; the line shuffles up. */
  private updatePotties(): void {
    const now = this.gameNow;
    for (const p of this.potties) {
      p.line = p.line.filter((w) => !w.gone);
      const front = p.line[0];
      if (!p.entering && front && now > p.busyUntil && front.delay <= 0 && front.x === front.tx && front.z === front.tz) {
        p.entering = front;
        p.doorUntil = now + 900;
        front.tx = p.x;
        front.tz = p.z;
        front.speed = 0.6;
      }
      const e = p.entering;
      if (e && e.x === e.tx && e.z === e.tz) {
        e.gone = true;
        e.hold = false;
        this.walkers = this.walkers.filter((w) => w !== e);
        p.entering = null;
        p.busyUntil = now + 1300;
        p.shakeUntil = now + 1100;
        this.after(250, () => {
          this.puke(v3(p.x, 0.62, p.z), 10, undefined, v3(0, 1, 0));
          sfx.sick();
        });
        p.line = p.line.filter((w) => w !== e);
        this.linePotty(p);
      }
      // Door swings open for whoever's going in; the whole potty rocks after.
      const open = now < p.doorUntil ? Math.min(1, (p.doorUntil - now) / 250, (now - (p.doorUntil - 900)) / 200) : 0;
      p.door.rotation.y = -1.7 * Math.max(0, open);
      const shake = now < p.shakeUntil ? Math.sin(now / 35) * 0.06 * ((p.shakeUntil - now) / 1100) : 0;
      p.group.rotation.z = shake;
    }
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

/** Walkers: excited on the way to the train, and after it, how the ride went. */
function walkerFace(w: Walker): Face {
  if (w.sick) return 'sick';
  if (w.mood === 'happy') return 'joy';
  if (w.mood === 'meh' || w.mood === 'angry') return 'meh';
  return 'grin';
}

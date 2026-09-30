import {
  Color,
  DepthTexture,
  HalfFloatType,
  Mesh,
  MeshNormalMaterial,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

// The camera pass for a stop-motion set: the scene renders to a multisampled
// color target, then again as normals plus depth (layer 0 only). A full-screen
// shader adds contact shadows (screen-space ambient occlusion), a tilt-shift
// depth of field focused on the action, bloom, a film curve, grain and a
// vignette, and a pop-art mode for slow motion.

export const INK_LAYER = 0;
/** Objects on this layer render in color but draw no ink lines. */
export const GLOW_LAYER = 1;
/** Objects on this layer also bleed light (bulbs, lanterns). */
export const BLOOM_LAYER = 2;

const BLUR = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tSrc, vUv) * 0.227;
  c += (texture2D(tSrc, vUv + uDir * 1.38) + texture2D(tSrc, vUv - uDir * 1.38)) * 0.316;
  c += (texture2D(tSrc, vUv + uDir * 3.23) + texture2D(tSrc, vUv - uDir * 3.23)) * 0.07;
  gl_FragColor = c;
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform float uBloom;
uniform vec2 uPx;
uniform float uLine;
uniform float uNear;
uniform float uFar;
uniform float uInk;
uniform vec3 uInkColor;
uniform float uSat;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uVignette;
uniform float uTime;
uniform float uFlash;
uniform float uDebug;
uniform float uCine;
uniform float uProj;
uniform float uAORadius;
uniform float uAO;
uniform float uFocusD;
uniform float uAperture;
uniform float uDof;
uniform vec2 uFocus;
varying vec2 vUv;

float lin(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// Screen-space ambient occlusion: clay pressed together gets dark in the
// creases and where it sits on the ground, which sells the miniature.
float occlusion(float dc) {
  float rad = uAORadius * uProj / dc;
  float occ = 0.0;
  // Interleaved gradient noise: a much calmer rotation pattern than white noise.
  vec2 fp = floor(vUv / uPx);
  float rot = fract(52.9829189 * fract(dot(fp, vec2(0.06711056, 0.00583715)))) * 6.2831;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float a = fi * 2.39996 + rot;
    float r = rad * sqrt((fi + 0.5) / 12.0);
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uPx;
    float ds = lin(texture2D(tDepth, uv).r);
    float diff = dc - ds;
    occ += smoothstep(0.004, 0.03, diff) * (1.0 - smoothstep(uAORadius * 1.2, uAORadius * 3.0, diff));
  }
  return 1.0 - occ / 12.0 * uAO;
}

// Tilt-shift: a shallow depth of field around the focus distance, like a
// macro lens on a model set.
vec3 dof(float dc) {
  float coc = clamp(abs(dc - uFocusD) / dc * uAperture, 0.0, 9.0);
  vec3 c = texture2D(tColor, vUv).rgb;
  if (coc < 0.6) return c;
  vec3 acc = c;
  float wsum = 1.0;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float a = fi * 2.39996;
    float r = coc * sqrt((fi + 0.5) / 16.0);
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uPx;
    float ds = lin(texture2D(tDepth, uv).r);
    // Sharp things in front don't smear into a blurred background.
    float w = ds < dc - 0.3 && abs(ds - uFocusD) / ds * uAperture < 0.6 ? 0.0 : 1.0;
    acc += texture2D(tColor, uv).rgb * w;
    wsum += w;
  }
  return acc / wsum;
}

void main() {
  vec4 nc = texture2D(tNormal, vUv);
  float dc = lin(texture2D(tDepth, vUv).r);
  if (uDebug > 0.5) { float o = occlusion(dc); gl_FragColor = vec4(vec3(o), 1.0); return; }
  vec3 c = uDof > 0.5 ? dof(dc) : texture2D(tColor, vUv).rgb;
  if (nc.a > 0.5) c *= occlusion(dc);

  c += texture2D(tBloom, vUv).rgb * uBloom;
  vec3 s = toSRGB(c);
  float l = dot(s, vec3(0.299, 0.587, 0.114));
  s = mix(vec3(l), s, uSat);
  s *= mix(uCool, uWarm, smoothstep(0.18, 0.75, l));
  vec2 px = vUv / uPx;
  // A gentle S-curve, like film.
  s = mix(s, s * s * (3.0 - 2.0 * s), 0.2);
  vec2 q = vUv - 0.5;
  s *= 1.0 - (uVignette + uCine * 0.35) * smoothstep(0.35, 0.95, length(q * vec2(1.1, 1.0)) * 1.25);
  s = mix(s, vec3(dot(s, vec3(0.3, 0.55, 0.15))) * vec3(1.02, 0.98, 0.94), uCine * 0.15);
  // Slow motion goes pop art: punchier color and contrast, halftone dots in the shade.
  if (uCine > 0.01) {
    float lum = dot(s, vec3(0.299, 0.587, 0.114));
    s = mix(vec3(lum), s, 1.0 + uCine * 0.45);
    s = (s - 0.5) * (1.0 + uCine * 0.3) + 0.5;
    vec2 hp = px * 0.7071;
    vec2 cell = vec2(hp.x + hp.y, hp.y - hp.x) / 7.0;
    float dotR = length(fract(cell) - 0.5);
    float dots = 1.0 - smoothstep(0.0, 0.08, dotR - (1.0 - lum) * 0.5);
    s *= 1.0 - dots * uCine * 0.35;
  }
  // Slow motion: manga speed lines streaming out from the subject.
  if (uCine > 0.01) {
    vec2 d = (vUv - uFocus) * vec2(uPx.y / uPx.x, 1.0);
    float ang = atan(d.y, d.x);
    float r = length(d);
    float lines = step(0.7, vnoise(vec2(ang * 34.0, floor(uTime * 14.0) * 3.1)));
    float mask = smoothstep(0.22, 0.7, r);
    s = mix(s, vec3(1.0, 0.99, 0.95), lines * mask * uCine * 0.55);
  }
  // Film grain, new every stop-motion frame.
  s += (hash(floor(px / 1.5) + fract(uTime * 0.173) * 97.0) - 0.5) * 0.018;
  s = mix(s, vec3(1.0, 0.98, 0.9), uFlash);
  gl_FragColor = vec4(s, 1.0);
}`;

export class Post {
  readonly color: WebGLRenderTarget;
  readonly nd: WebGLRenderTarget;
  private normalMat = new MeshNormalMaterial();
  private quadScene = new Scene();
  private quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly mat: ShaderMaterial;
  enabled = true;
  /** Bloom strength (0 turns the bloom passes off). */
  bloom = 0;
  private bloomA = new WebGLRenderTarget(4, 4, { type: HalfFloatType });
  private bloomB = new WebGLRenderTarget(4, 4, { type: HalfFloatType });
  private blurMat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: BLUR,
    depthTest: false,
    depthWrite: false,
    uniforms: { tSrc: { value: null }, uDir: { value: new Vector2() } },
  });
  private blurScene = new Scene();
  private black = new Color(0, 0, 0);

  constructor() {
    this.color = new WebGLRenderTarget(4, 4, { type: HalfFloatType, samples: 4 });
    this.nd = new WebGLRenderTarget(4, 4, { depthTexture: new DepthTexture(4, 4), minFilter: NearestFilter, magFilter: NearestFilter });
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.color.texture },
        tNormal: { value: this.nd.texture },
        tDepth: { value: this.nd.depthTexture },
        tBloom: { value: this.bloomA.texture },
        uBloom: { value: 0 },
        uPx: { value: new Vector2(1 / 4, 1 / 4) },
        uLine: { value: 1.2 },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uInk: { value: 1 },
        uInkColor: { value: new Color('#1d1433') },
        uSat: { value: 1.32 },
        uWarm: { value: new Color(1.03, 1.0, 0.94) },
        uCool: { value: new Color(0.9, 0.93, 1.06) },
        uVignette: { value: 0.28 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uDebug: { value: 0 },
        uProj: { value: 500 },
        uAORadius: { value: 0.07 },
        uAO: { value: 0.85 },
        uFocusD: { value: 12 },
        uAperture: { value: 16 },
        uDof: { value: 0 },
        uCine: { value: 0 },
        uFocus: { value: new Vector2(0.5, 0.5) },
      },
    });
    this.quadScene.add(new Mesh(new PlaneGeometry(2, 2), this.mat));
    this.blurScene.add(new Mesh(new PlaneGeometry(2, 2), this.blurMat));
  }

  setSize(w: number, h: number, dpr: number): void {
    this.color.setSize(w, h);
    this.nd.setSize(w, h);
    this.mat.uniforms.uPx.value.set(1 / w, 1 / h);
    this.mat.uniforms.uLine.value = Math.max(1, dpr * 0.85);
    this.bloomA.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.bloomB.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
  }

  private blur(r: WebGLRenderer, from: WebGLRenderTarget, to: WebGLRenderTarget, dx: number, dy: number): void {
    this.blurMat.uniforms.tSrc.value = from.texture;
    this.blurMat.uniforms.uDir.value.set(dx / from.width, dy / from.height);
    r.setRenderTarget(to);
    r.render(this.blurScene, this.quadCam);
  }

  render(r: WebGLRenderer, scene: Scene, cam: PerspectiveCamera, time: number): void {
    const u = this.mat.uniforms;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uTime.value = time;
    u.uProj.value = this.nd.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    if (!this.enabled) {
      cam.layers.enableAll();
      r.setRenderTarget(null);
      r.render(scene, cam);
      return;
    }
    // Color, everything.
    cam.layers.enableAll();
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.color);
    r.render(scene, cam);
    // Normals and depth, ink layer only.
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = this.normalMat;
    cam.layers.set(INK_LAYER);
    r.setRenderTarget(this.nd);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    scene.overrideMaterial = null;
    scene.background = bg;
    scene.fog = fog;
    // Bloom: the glowing things alone, blurred at quarter size.
    u.uBloom.value = this.bloom;
    if (this.bloom > 0.01) {
      scene.background = this.black;
      scene.fog = null;
      cam.layers.set(BLOOM_LAYER);
      r.setRenderTarget(this.bloomA);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(scene, cam);
      scene.background = bg;
      scene.fog = fog;
      this.blur(r, this.bloomA, this.bloomB, 1, 0);
      this.blur(r, this.bloomB, this.bloomA, 0, 1);
      this.blur(r, this.bloomA, this.bloomB, 2.2, 0);
      this.blur(r, this.bloomB, this.bloomA, 0, 2.2);
    }
    cam.layers.enableAll();
    // Composite.
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}

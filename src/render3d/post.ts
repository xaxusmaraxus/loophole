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

// The ink pass: the scene renders to a multisampled color target, then again as
// view-space normals plus depth (layer 0 only, so particles and glows get no
// lines). A full-screen shader draws ink where depth creases or normals turn
// sharply, then grades the frame: saturation, warm lights, cool shade, vignette
// and a touch of paper grain.

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

void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  vec4 nc = texture2D(tNormal, vUv);
  float dc = lin(texture2D(tDepth, vUv).r);
  vec3 n0 = nc.rgb * 2.0 - 1.0;
  float edgeN = 0.0;
  float edgeD = 0.0;
  vec2 offs[8];
  offs[0] = vec2(1.0, 0.0); offs[1] = vec2(-1.0, 0.0); offs[2] = vec2(0.0, 1.0); offs[3] = vec2(0.0, -1.0);
  offs[4] = vec2(0.7, 0.7); offs[5] = vec2(-0.7, 0.7); offs[6] = vec2(0.7, -0.7); offs[7] = vec2(-0.7, -0.7);
  for (int i = 0; i < 8; i++) {
    vec2 uv = vUv + offs[i] * uPx * uLine;
    vec4 ni = texture2D(tNormal, uv);
    float di = lin(texture2D(tDepth, uv).r);
    // Depth: only the near side of a crease gets the line.
    float rel = (di - dc) / dc;
    edgeD = max(edgeD, smoothstep(0.018, 0.045, rel));
    if (ni.a > 0.5 && nc.a > 0.5) {
      float nd = 1.0 - dot(n0, ni.rgb * 2.0 - 1.0);
      edgeN = max(edgeN, smoothstep(0.32, 0.55, nd) * step(-0.004, rel));
    }
  }
  float fade = 1.0 - smoothstep(uFar * 0.28, uFar * 0.55, dc);
  float ink = max(edgeD, edgeN) * uInk * fade * nc.a;
  if (uDebug > 0.5) { gl_FragColor = vec4(edgeD, edgeN, 0.0, 1.0); return; }
  vec3 inkCol = mix(uInkColor, c * 0.28, 0.35);
  c = mix(c, inkCol, clamp(ink, 0.0, 1.0));

  c += texture2D(tBloom, vUv).rgb * uBloom;
  vec3 s = toSRGB(c);
  float l = dot(s, vec3(0.299, 0.587, 0.114));
  s = mix(vec3(l), s, uSat);
  s *= mix(uCool, uWarm, smoothstep(0.18, 0.75, l));
  vec2 q = vUv - 0.5;
  s *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(q * vec2(1.1, 1.0)) * 1.25);
  s += (hash(vUv * 931.7 + fract(uTime * 0.37)) - 0.5) * 0.025;
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
        uInk: { value: 0.92 },
        uInkColor: { value: new Color('#1d1433') },
        uSat: { value: 1.12 },
        uWarm: { value: new Color(1.03, 1.0, 0.94) },
        uCool: { value: new Color(0.9, 0.93, 1.06) },
        uVignette: { value: 0.28 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uDebug: { value: 0 },
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

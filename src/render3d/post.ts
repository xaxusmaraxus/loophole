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

// The paint pass: the scene renders to a multisampled color target, then again
// as view-space normals plus depth (layer 0 only). A full-screen shader turns
// the color into soft dabs (a Kuwahara filter), lets edges pool a little darker
// pigment of their own color, and grades the frame: saturation, warm lights,
// cool shade, vignette, a canvas weave, and a cinematic mode for slow motion.

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
uniform float uPaint;
uniform float uCine;
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

// Kuwahara filter: average the calmest of four quadrants, so flat areas turn
// into soft dabs of paint while edges stay put.
vec3 paint(vec2 uv) {
  float R = uPaint;
  vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
  vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
  float n0 = 0.0, n1 = 0.0, n2 = 0.0, n3 = 0.0;
  // A slight wobble in the sampling grid reads as brush direction.
  vec2 wob = (vec2(vnoise(uv * 180.0), vnoise(uv * 180.0 + 7.3)) - 0.5) * 0.9;
  for (int y = -3; y <= 3; y++) {
    for (int x = -3; x <= 3; x++) {
      if (abs(float(x)) > R || abs(float(y)) > R) continue;
      vec3 c = texture2D(tColor, uv + (vec2(float(x), float(y)) + wob) * uPx).rgb;
      vec3 c2 = c * c;
      if (x <= 0 && y <= 0) { m0 += c; s0 += c2; n0 += 1.0; }
      if (x >= 0 && y <= 0) { m1 += c; s1 += c2; n1 += 1.0; }
      if (x <= 0 && y >= 0) { m2 += c; s2 += c2; n2 += 1.0; }
      if (x >= 0 && y >= 0) { m3 += c; s3 += c2; n3 += 1.0; }
    }
  }
  m0 /= n0; m1 /= n1; m2 /= n2; m3 /= n3;
  vec3 v0 = s0 / n0 - m0 * m0; vec3 v1 = s1 / n1 - m1 * m1;
  vec3 v2 = s2 / n2 - m2 * m2; vec3 v3 = s3 / n3 - m3 * m3;
  float a0 = v0.r + v0.g + v0.b, a1 = v1.r + v1.g + v1.b, a2 = v2.r + v2.g + v2.b, a3 = v3.r + v3.g + v3.b;
  vec3 c = m0; float best = a0;
  if (a1 < best) { best = a1; c = m1; }
  if (a2 < best) { best = a2; c = m2; }
  if (a3 < best) { best = a3; c = m3; }
  return c;
}

void main() {
  vec3 c = uPaint > 0.5 ? paint(vUv) : texture2D(tColor, vUv).rgb;
  vec4 nc = texture2D(tNormal, vUv);
  float dc = lin(texture2D(tDepth, vUv).r);
  vec3 n0 = nc.rgb * 2.0 - 1.0;
  float edgeN = 0.0;
  float edgeD = 0.0;
  vec2 offs[4];
  offs[0] = vec2(1.0, 0.0); offs[1] = vec2(-1.0, 0.0); offs[2] = vec2(0.0, 1.0); offs[3] = vec2(0.0, -1.0);
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + offs[i] * uPx * uLine;
    vec4 ni = texture2D(tNormal, uv);
    float di = lin(texture2D(tDepth, uv).r);
    float rel = (di - dc) / dc;
    edgeD = max(edgeD, smoothstep(0.02, 0.08, rel));
    if (ni.a > 0.5 && nc.a > 0.5) edgeN = max(edgeN, smoothstep(0.35, 0.8, 1.0 - dot(n0, ni.rgb * 2.0 - 1.0)) * step(-0.004, rel));
  }
  float fade = 1.0 - smoothstep(uFar * 0.28, uFar * 0.55, dc);
  // No black ink: edges just pool a little darker pigment of their own color.
  float edge = max(edgeD, edgeN * 0.6) * uInk * fade * nc.a;
  if (uDebug > 0.5) { gl_FragColor = vec4(edgeD, edgeN, 0.0, 1.0); return; }
  c *= 1.0 - edge * 0.28;

  c += texture2D(tBloom, vUv).rgb * uBloom;
  vec3 s = toSRGB(c);
  float l = dot(s, vec3(0.299, 0.587, 0.114));
  s = mix(vec3(l), s, uSat);
  s *= mix(uCool, uWarm, smoothstep(0.18, 0.75, l));
  // Canvas: a fine weave and a slow mottle, like paint on paper.
  vec2 px = vUv / uPx;
  float weave = (sin(px.x * 1.9) * sin(px.y * 1.9)) * 0.012;
  float mottle = (vnoise(vUv * vec2(9.0, 7.0)) - 0.5) * 0.05 + (vnoise(vUv * 60.0) - 0.5) * 0.025;
  s *= 1.0 + weave + mottle;
  vec2 q = vUv - 0.5;
  s *= 1.0 - (uVignette + uCine * 0.35) * smoothstep(0.35, 0.95, length(q * vec2(1.1, 1.0)) * 1.25);
  s = mix(s, vec3(dot(s, vec3(0.3, 0.55, 0.15))) * vec3(1.02, 0.98, 0.94), uCine * 0.15);
  // Slow motion: manga speed lines streaming out from the subject.
  if (uCine > 0.01) {
    vec2 d = (vUv - uFocus) * vec2(uPx.y / uPx.x, 1.0);
    float ang = atan(d.y, d.x);
    float r = length(d);
    float lines = step(0.7, vnoise(vec2(ang * 34.0, floor(uTime * 14.0) * 3.1)));
    float mask = smoothstep(0.22, 0.7, r);
    s = mix(s, vec3(1.0, 0.99, 0.95), lines * mask * uCine * 0.55);
  }
  s += (hash(vUv * 931.7 + fract(uTime * 0.37)) - 0.5) * 0.02;
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
        uSat: { value: 1.12 },
        uWarm: { value: new Color(1.03, 1.0, 0.94) },
        uCool: { value: new Color(0.9, 0.93, 1.06) },
        uVignette: { value: 0.28 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uDebug: { value: 0 },
        uPaint: { value: 2 },
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
    this.mat.uniforms.uPaint.value = dpr > 1.3 ? 3 : 2;
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

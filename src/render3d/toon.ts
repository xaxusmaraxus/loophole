import { Color, DoubleSide, MeshToonMaterial, type Side } from 'three';
import { type Col, col } from './geo';

// Plasticine. Every surface is modelling clay on a stop-motion set:
//  - hand-molded lumps: vertices wander by a slow 3D noise, so nothing is
//    perfectly straight;
//  - boil: a second, finer wander changes on every stop-motion frame (12 a
//    second), the way real clay never sits quite the same between shots;
//  - thumbprints and tool marks pressed into the surface (a bump map made in
//    the shader: pits of concentric ridges in random cells, plus fine grain);
//  - colour mottling, a warm glow in the shade (light scattering in the clay)
//    and a broad waxy sheen instead of a hard highlight.

/** Uniforms shared by every clay material. */
export const SHARED = {
  uTime: { value: 0 },
  /** Changes once per stop-motion frame; seeds the boil. */
  uBoil: { value: 0 },
  uRimColor: { value: new Color('#fff1d6') },
  uShade: { value: 0.22 },
};

export interface ToonOpts {
  gloss?: number;
  rim?: number;
  emissive?: Col;
  emissiveIntensity?: number;
  /** Wind sway strength (world units per unit of height). */
  sway?: number;
  swayBase?: number;
  side?: Side;
  transparent?: boolean;
  opacity?: number;
  vertexColors?: boolean;
  color?: Col;
  /** How far vertices wander (object units); small for small, detailed things. */
  lump?: number;
  /** Thumbprint and grain depth. */
  bump?: number;
}

const NOISE = /* glsl */ `
float cl_h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cl_n3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cl_h3(i), cl_h3(i + vec3(1, 0, 0)), f.x), mix(cl_h3(i + vec3(0, 1, 0)), cl_h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(cl_h3(i + vec3(0, 0, 1)), cl_h3(i + vec3(1, 0, 1)), f.x), mix(cl_h3(i + vec3(0, 1, 1)), cl_h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

export function toon(o: ToonOpts = {}): MeshToonMaterial {
  const m = new MeshToonMaterial({
    vertexColors: o.vertexColors ?? true,
    color: o.color ? col(o.color).clone() : new Color(1, 1, 1),
    side: o.side,
    transparent: o.transparent,
    opacity: o.opacity ?? 1,
  });
  if (o.emissive) {
    m.emissive = col(o.emissive).clone();
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  const own = {
    uGloss: { value: o.gloss ?? 0 },
    uRim: { value: o.rim ?? 0.35 },
    uSway: { value: o.sway ?? 0 },
    uSwayBase: { value: o.swayBase ?? 0 },
    uLump: { value: o.lump ?? 0.012 },
    uBump: { value: o.bump ?? 1 },
  };
  m.userData.u = own;
  const sway = (o.sway ?? 0) > 0;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SHARED, own);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; uniform float uBoil; uniform float uSway; uniform float uSwayBase; uniform float uLump;
        varying vec3 vClay;
        ${NOISE}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 op = position;
          // Hand-molded: a slow wander that stays put...
          transformed += (vec3(cl_n3(op * 5.0), cl_n3(op * 5.0 + 17.1), cl_n3(op * 5.0 + 31.7)) - 0.5) * uLump;
          // ...and the boil, which changes every stop-motion frame.
          vec3 bp = op * 11.0 + vec3(uBoil);
          transformed += (vec3(cl_n3(bp), cl_n3(bp + 5.3), cl_n3(bp + 9.1)) - 0.5) * uLump * 0.3;
          ${
            sway
              ? `vec4 wp = modelMatrix * vec4(position, 1.0);
          float hgt = max(0.0, position.y - uSwayBase);
          float ph = uTime * 1.6 + wp.x * 1.7 + wp.z * 1.1;
          transformed.x += sin(ph) * uSway * hgt;
          transformed.z += cos(ph * 0.8) * uSway * hgt * 0.6;`
              : ''
          }
        }`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vClay = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uGloss; uniform float uRim; uniform vec3 uRimColor; uniform float uShade; uniform float uBump; uniform float uBoil;
        varying vec3 vClay;
        ${NOISE}
        // Thumbprints: in some cells of a 3D grid, a pit of concentric ridges.
        float clPrints(vec3 p) {
          // The 8 nearest cells are enough (prints are smaller than a cell).
          vec3 c = floor(p - 0.5);
          float h = 0.0;
          for (int z = 0; z <= 1; z++)
          for (int y = 0; y <= 1; y++)
          for (int x = 0; x <= 1; x++) {
            vec3 g = c + vec3(float(x), float(y), float(z));
            float r = cl_h3(g * 1.37 + 3.1);
            if (r < 0.55) continue;
            vec3 f = g + vec3(cl_h3(g + 1.3), cl_h3(g + 7.7), cl_h3(g + 4.1));
            float d = length(p - f);
            float w = smoothstep(0.5, 0.1, d);
            h += (sin(d * 34.0 + r * 40.0) * 0.5 - 0.5) * w;
          }
          return h;
        }
        float clHeight(vec3 p) {
          return clPrints(p * 3.4) * 0.009
            + (cl_n3(p * 11.0) - 0.5) * 0.016
            + (cl_n3(p * 42.0 + vec3(uBoil * 0.2)) - 0.5) * 0.0016;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= 1.0 + (cl_n3(vClay * 6.0) - 0.5) * 0.14 + (cl_n3(vClay * 23.0) - 0.5) * 0.05;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Bump from the clay height, by screen-space derivatives.
          float hgt = clHeight(vClay) * uBump;
          vec3 dpdx = dFdx(-vViewPosition);
          vec3 dpdy = dFdy(-vViewPosition);
          float dhx = dFdx(hgt);
          float dhy = dFdy(hgt);
          vec3 r1 = cross(dpdy, normal);
          vec3 r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad);
        }`,
      )
      .replace(
        '#include <gradientmap_pars_fragment>',
        `vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
          // Soft wrapped light, like a big studio softbox.
          float d = dot( normal, lightDirection );
          return vec3( mix( uShade, 1.0, smoothstep( -0.45, 1.0, d ) ) );
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 vdir = normalize( vViewPosition );
          float nv = max( dot( normal, vdir ), 0.0 );
          // Light scattering in the clay warms the shade a little.
          outgoingLight += diffuseColor.rgb * vec3( 0.07, 0.03, 0.02 );
          // A soft, fuzzy rim and a broad waxy sheen.
          outgoingLight += uRimColor * diffuseColor.rgb * pow( 1.0 - nv, 2.5 ) * uRim * 0.5;
          #if NUM_DIR_LIGHTS > 0
            vec3 hh = normalize( directionalLights[ 0 ].direction + vdir );
            float sh = pow( max( dot( normal, hh ), 0.0 ), 14.0 );
            outgoingLight += directionalLights[ 0 ].color * sh * ( 0.07 + uGloss * 0.12 );
          #endif
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `clay-${sway ? 's' : 'n'}`;
  return m;
}

/** The standard material set every batch picks from. */
export const MATS = {
  matte: toon({ rim: 0.3 }),
  gloss: toon({ gloss: 1, rim: 0.4 }),
  leaf: toon({ rim: 0.25, sway: 0.05 }),
  cloth: toon({ rim: 0.2, side: DoubleSide, lump: 0.006 }),
  /** Guests: small, so they wander less and keep their faces. */
  figure: toon({ rim: 0.35, lump: 0.0035, bump: 0.6 }),
  /** Track: sculpted clay, but smoothed out so rails run clean and round. */
  rail: toon({ gloss: 1, rim: 0.45, lump: 0.0035, bump: 0.45 }),
  steel: toon({ rim: 0.3, lump: 0.004, bump: 0.6 }),
  /** Flat ground: prints and mottling, but no wander. */
  ground: toon({ rim: 0.15, lump: 0, bump: 1.2 }),
};

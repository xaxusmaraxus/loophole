import { Color, DoubleSide, MeshToonMaterial, type Side } from 'three';
import { type Col, col } from './geo';

// Soft stylized lighting on top of three's toon material: a smooth wrapped
// falloff, a soft specular on glossy paint, a gentle rim, and an optional wind
// sway for foliage (by height above the object's base).

/** Uniforms shared by every toon material (time, rim color, shade depth). */
export const SHARED = {
  uTime: { value: 0 },
  uRimColor: { value: new Color('#fff1d6') },
  uShade: { value: 0.2 },
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
}

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
  };
  m.userData.u = own;
  const sway = (o.sway ?? 0) > 0;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SHARED, own);
    if (sway) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uSway; uniform float uSwayBase;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            float hgt = max(0.0, position.y - uSwayBase);
            float ph = uTime * 1.6 + wp.x * 1.7 + wp.z * 1.1;
            transformed.x += sin(ph) * uSway * hgt;
            transformed.z += cos(ph * 0.8) * uSway * hgt * 0.6;
          }`,
        );
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGloss; uniform float uRim; uniform vec3 uRimColor; uniform float uShade;')
      .replace(
        '#include <gradientmap_pars_fragment>',
        `vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
          // Soft wrapped light: a smooth falloff instead of cel bands.
          float d = dot( normal, lightDirection );
          return vec3( mix( uShade, 1.0, smoothstep( -0.35, 0.95, d ) ) );
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 vdir = normalize( vViewPosition );
          float rf = 1.0 - max( dot( normal, vdir ), 0.0 );
          outgoingLight += uRimColor * diffuseColor.rgb * pow( rf, 3.0 ) * uRim * 0.6;
          #if NUM_DIR_LIGHTS > 0
            vec3 hh = normalize( directionalLights[ 0 ].direction + vdir );
            outgoingLight += directionalLights[ 0 ].color * pow( max( dot( normal, hh ), 0.0 ), 40.0 ) * uGloss * 0.35;
          #endif
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `toon-${sway ? 's' : 'n'}`;
  return m;
}

/** The standard material set every batch picks from. */
export const MATS = {
  matte: toon({ rim: 0.3 }),
  gloss: toon({ gloss: 1, rim: 0.4 }),
  leaf: toon({ rim: 0.25, sway: 0.05 }),
  cloth: toon({ rim: 0.2, side: DoubleSide }),
};

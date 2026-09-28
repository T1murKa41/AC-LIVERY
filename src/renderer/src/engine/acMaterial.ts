// Approximation of Assetto Corsa's car shaders (ksPerPixel family) in three.js.
//
// Lighting is done in gamma space like the original DX11 shaders: textures are
// sampled without colour-space conversion and the result is written straight
// to the framebuffer. Coefficients follow the material properties stored in the
// kn5 (ksAmbient, ksDiffuse, ksSpecular, ksSpecularEXP, fresnel*). txMaps
// channels scale specular (R), glossiness (G) and reflection (B).
//
// This is a visual approximation for previewing liveries, calibrated by eye;
// it does not reproduce CSP's lighting.

import * as THREE from 'three'
import { getProperty, getTextureMapping, type Kn5Material } from '@shared/formats/kn5'

export const LIGHTING = {
  sunDir: new THREE.Vector3(0.45, 0.8, 0.35).normalize(),
  sunColor: new THREE.Vector3(1.22, 1.2, 1.15),
  ambientColor: new THREE.Vector3(0.9, 0.93, 0.97),
}

const SKY_GLSL = /* glsl */ `
uniform vec3 sunDir;
vec3 skyColor(vec3 d) {
  float y = d.y;
  vec3 zenith = vec3(0.30, 0.42, 0.62);
  vec3 horizon = vec3(0.80, 0.82, 0.85);
  vec3 ground = vec3(0.20, 0.19, 0.18);
  vec3 c = y > 0.0 ? mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.6))
                   : mix(horizon * 0.75, ground, pow(clamp(-y, 0.0, 1.0), 0.35));
  // studio softboxes give cars readable reflections
  c += vec3(0.45) * smoothstep(0.18, 0.24, y) * smoothstep(0.55, 0.47, y);
  c += vec3(2.5) * smoothstep(0.992, 0.999, dot(d, sunDir));
  return c;
}
`

const VERTEX = /* glsl */ `
attribute vec3 tangentU;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = mat3(modelMatrix) * normal;
  vTangent = mat3(modelMatrix) * tangentU;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D txDiffuse;
uniform sampler2D txMaps;
uniform sampler2D txNormal;
uniform sampler2D txDetail;
uniform bool hasDiffuse;
uniform bool hasMaps;
uniform bool hasNormal;
uniform bool useDetail;
uniform float detailUVMultiplier;
uniform float ksAmbient;
uniform float ksDiffuse;
uniform float ksSpecular;
uniform float ksSpecularEXP;
uniform vec3 ksEmissive;
uniform float ksAlphaRef;
uniform float fresnelC;
uniform float fresnelEXP;
uniform float fresnelMaxLevel;
uniform float isAdditive;
uniform float sunSpecular;
uniform float sunSpecularEXP;
uniform bool reflective;
uniform bool multimap;
uniform bool alphaTested;
uniform bool blended;
uniform vec3 sunColor;
uniform vec3 ambientColor;
uniform float highlight;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec2 vUv;
${SKY_GLSL}
void main() {
  vec4 diff = hasDiffuse ? texture2D(txDiffuse, vUv) : vec4(1.0);
  if (useDetail) {
    vec4 det = texture2D(txDetail, vUv * detailUVMultiplier);
    diff.rgb = mix(det.rgb, diff.rgb, diff.a);
  }
  if (alphaTested && diff.a < ksAlphaRef) discard;

  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  if (hasNormal) {
    vec3 T = vTangent - N * dot(N, vTangent);
    if (dot(T, T) > 1e-8) {
      T = normalize(T);
      vec3 B = cross(N, T);
      vec3 nm = texture2D(txNormal, vUv).xyz * 2.0 - 1.0;
      N = normalize(T * nm.x + B * nm.y + N * max(nm.z, 0.05));
    }
  }
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = sunDir;
  vec3 H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0);
  float NdH = max(dot(N, H), 0.0);
  vec3 maps = (multimap && hasMaps) ? texture2D(txMaps, vUv).rgb : vec3(1.0);

  vec3 color = diff.rgb * (ksAmbient * ambientColor + ksDiffuse * NdL * sunColor);
  float specExp = max(1.0, ksSpecularEXP * maps.g);
  color += sunColor * (ksSpecular * maps.r * pow(NdH, specExp) * step(0.0, NdL));
  if (sunSpecular > 0.0) {
    color += sunColor * (sunSpecular * maps.r * pow(NdH, max(1.0, sunSpecularEXP * maps.g)));
  }
  if (reflective) {
    float f = fresnelC + (1.0 - fresnelC) * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), fresnelEXP);
    f = min(f, fresnelMaxLevel) * maps.b;
    vec3 env = skyColor(reflect(-V, N));
    color = isAdditive > 0.5 ? color + env * f : mix(color, env, f);
  }
  color += ksEmissive * diff.rgb;
  color = mix(color, vec3(1.0, 0.55, 0.1), highlight * 0.45);
  gl_FragColor = vec4(color, blended ? diff.a : 1.0);
}
`

// kn5 enums (same numbering as Content Manager's Kn5Material)
const BLEND_ALPHA = 1
const BLEND_COVERAGE = 2
const DEPTH_NORMAL = 0
const DEPTH_OFF = 2

export type TextureResolver = (name: string) => THREE.Texture | null

function num(material: Kn5Material, name: string, fallback: number): number {
  return getProperty(material, name)?.a ?? fallback
}

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
WHITE.needsUpdate = true

/** Texture names a material samples, keyed by uniform. */
export function materialTextureNames(material: Kn5Material): Record<string, string | undefined> {
  return {
    txDiffuse: getTextureMapping(material, 'txDiffuse'),
    txMaps: getTextureMapping(material, 'txMaps'),
    txNormal: getTextureMapping(material, 'txNormal'),
    txDetail: getTextureMapping(material, 'txDetail'),
  }
}

export function createAcMaterial(
  material: Kn5Material,
  resolve: TextureResolver,
): THREE.ShaderMaterial {
  const shader = material.shader.toLowerCase()
  const multimap = shader.includes('multimap')
  const reflective = multimap || shader.includes('reflection') || shader.includes('carpaint')
  const names = materialTextureNames(material)
  const tex = (key: keyof typeof names) => (names[key] ? resolve(names[key]!) : null)
  const blended = material.blendMode === BLEND_ALPHA
  const alphaTested =
    material.alphaTested ||
    material.blendMode === BLEND_COVERAGE ||
    /(^|_|perpixel)at($|_)/.test(shader)
  const emissive = getProperty(material, 'ksEmissive')?.c ?? [0, 0, 0]
  // Decals and logos usually sit on (almost) the same surface as the body.
  // AC draws them after the body; here they are pulled slightly towards the
  // camera so they win the depth test instead of flickering or disappearing.
  const decalLike =
    blended ||
    alphaTested ||
    material.depthMode !== DEPTH_NORMAL ||
    /decal|logo|sticker|sponsor/i.test(material.name)

  const m = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      txDiffuse: { value: tex('txDiffuse') ?? WHITE },
      txMaps: { value: tex('txMaps') ?? WHITE },
      txNormal: { value: tex('txNormal') ?? WHITE },
      txDetail: { value: tex('txDetail') ?? WHITE },
      hasDiffuse: { value: !!names.txDiffuse },
      hasMaps: { value: !!names.txMaps },
      hasNormal: {
        value: !!names.txNormal && (shader.includes('nm') || shader.includes('normal')),
      },
      useDetail: { value: !!names.txDetail && num(material, 'useDetail', 0) > 0 },
      detailUVMultiplier: { value: num(material, 'detailUVMultiplier', 1) },
      ksAmbient: { value: num(material, 'ksAmbient', 0.4) },
      ksDiffuse: { value: num(material, 'ksDiffuse', 0.4) },
      ksSpecular: { value: num(material, 'ksSpecular', 0.3) },
      ksSpecularEXP: { value: num(material, 'ksSpecularEXP', 20) },
      ksEmissive: { value: new THREE.Vector3(...emissive) },
      ksAlphaRef: { value: num(material, 'ksAlphaRef', 0.5) },
      fresnelC: { value: num(material, 'fresnelC', 0.05) },
      fresnelEXP: { value: num(material, 'fresnelEXP', 3) },
      fresnelMaxLevel: { value: num(material, 'fresnelMaxLevel', 0.5) },
      isAdditive: { value: num(material, 'isAdditive', 0) },
      sunSpecular: { value: num(material, 'sunSpecular', 0) },
      sunSpecularEXP: { value: num(material, 'sunSpecularEXP', 100) },
      reflective: { value: reflective },
      multimap: { value: multimap },
      alphaTested: { value: alphaTested },
      blended: { value: blended },
      sunDir: { value: LIGHTING.sunDir },
      sunColor: { value: LIGHTING.sunColor },
      ambientColor: { value: LIGHTING.ambientColor },
      highlight: { value: 0 },
    },
    transparent: blended,
    depthWrite: !blended && material.depthMode === DEPTH_NORMAL,
    depthTest: material.depthMode !== DEPTH_OFF,
    side: THREE.DoubleSide,
    polygonOffset: decalLike,
    polygonOffsetFactor: decalLike ? -1 : 0,
    polygonOffsetUnits: decalLike ? -4 : 0,
  })
  m.name = material.name
  m.userData.decalLike = decalLike
  m.userData.textureNames = names
  return m
}

/** Re-resolves texture uniforms, e.g. after a skin or live livery override changed. */
export function refreshMaterialTextures(m: THREE.ShaderMaterial, resolve: TextureResolver): void {
  const names = m.userData.textureNames as Record<string, string | undefined>
  for (const [uniform, name] of Object.entries(names)) {
    if (!name) continue
    m.uniforms[uniform]!.value = resolve(name) ?? WHITE
  }
}

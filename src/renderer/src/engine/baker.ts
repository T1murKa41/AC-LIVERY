// Bakes the livery into the car's UV space on the GPU.
//
// 1. Design pass: every mesh that uses the livery texture is rasterized with
//    its UVs as screen positions, so each fragment is one texel of the output.
//    The fragment knows its world position and normal, which is what the
//    projected vinyls of stage 2 will use. Alpha marks covered texels.
// 2. Dilation: uncovered texels next to covered ones copy their neighbours,
//    a few texels deep, so mipmaps and filtering do not bleed seams.
// 3. Final pass: fills the rest with the base colour, multiplies the stock AO
//    detail and takes alpha from the original texture (shaders may use it).
//
// Output row 0 is v = 0, which is also the first row of the texture file, so
// pixels can be exported without flipping.

import * as THREE from 'three'

export interface BakeMesh {
  geometry: THREE.BufferGeometry
  /** Display-space world matrix, the space projectors are placed in. */
  world: THREE.Matrix4
}

/** One projector in display space (see @shared/design/placement). */
export interface BakeProjector {
  origin: [number, number, number]
  axisS: [number, number, number]
  axisT: [number, number, number]
  axisR: [number, number, number]
}

export interface BakeLayer {
  texture: THREE.Texture
  /** One projector, or two when the vinyl is mirrored to the other side. */
  projectors: BakeProjector[]
  opacity: number
  /** Draw this colour through the vinyl's alpha instead of its pixels (material maps). */
  flatColor?: [number, number, number]
}

export interface BakeSettings {
  width: number
  height: number
  baseColor: [number, number, number]
  ao: THREE.Texture | null
  aoStrength: number
  /** Original texture; its alpha channel is kept. */
  alphaSource: THREE.Texture | null
  /** Start from the original texture instead of the base colour. */
  baseFromSource?: boolean
  /** Texels no mesh covers keep the original texture instead of the base colour. */
  fillFromSource?: boolean
  /** Vinyls, bottom first. */
  layers?: BakeLayer[]
  /**
   * Surfaces that hide what is behind them from a projector; defaults to
   * `meshes`. Pass every repainted mesh so a thin fin painted from one side
   * does not show through on the other.
   */
  occluders?: BakeMesh[]
}

// uvOffset moves one UV tile into 0..1 (see uvTiles).
const UV_VERTEX = /* glsl */ `
uniform mat4 world;
uniform vec2 uvOffset;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vUv = uv + uvOffset;
  vWorldPos = (world * vec4(position, 1.0)).xyz;
  vWorldNormal = normalize(mat3(world) * normal);
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}
`

const DESIGN_FRAGMENT = /* glsl */ `
uniform vec3 baseColor;
uniform sampler2D source;
uniform bool useSource;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec3 original = texture2D(source, vUv).rgb;
  gl_FragColor = vec4(useSource ? original : baseColor, 1.0);
}
`

// Projects one vinyl onto the texels of the car. Surfaces seen at a grazing
// angle fade out so vinyls do not smear around sharp edges, and the depth
// limit keeps a sticker on the left door off the right door.
const LAYER_FRAGMENT = /* glsl */ `
uniform sampler2D vinyl;
uniform float opacity;
uniform bool useFlat;
uniform vec3 flatColor;
uniform int count;
uniform vec3 origin[2];
uniform vec3 axisS[2];
uniform vec3 axisT[2];
uniform vec3 axisR[2];
// Depth of the nearest repainted surface as seen by each projector.
uniform sampler2D depth0;
uniform sampler2D depth1;
uniform mat4 depthMatrix0;
uniform mat4 depthMatrix1;
// world size of a depth texel, projector depth (metres)
uniform vec2 depthScale0;
uniform vec2 depthScale1;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

// 1 if this point is the first surface the projector meets. Slanted surfaces
// get more slack: neighbouring depth texels differ more there.
float unoccluded(sampler2D map, mat4 m, vec2 scale, float facing) {
  vec4 c = m * vec4(vWorldPos, 1.0);
  vec2 uv = clamp(c.xy * 0.5 + 0.5, 0.0, 1.0);
  float z = c.z * 0.5 + 0.5;
  float nearest = texture2D(map, uv).r;
  float slope = sqrt(max(0.0, 1.0 - facing * facing)) / max(facing, 0.1);
  float bias = (0.004 + scale.x * 1.5 * slope) / scale.y;
  return step(z, nearest + bias);
}

// No early returns or dynamic array indexing around the texture fetches: the
// samples must happen in uniform control flow, otherwise some Direct3D
// translations of WebGL drop or miscompile them.
vec4 project(vec3 o, vec3 as, vec3 at, vec3 ar, sampler2D map, mat4 m, vec2 scale) {
  vec3 q = vWorldPos - o;
  vec2 st = vec2(dot(q, as), dot(q, at)) + 0.5;
  float r = dot(q, ar);
  vec2 in2 = step(vec2(0.0), st) * step(st, vec2(1.0));
  float inside = in2.x * in2.y * step(abs(r), 0.5);
  // abs(): normals may be flipped on some models; surfaces behind others are
  // rejected by the depth test instead
  float facing = abs(dot(normalize(vWorldNormal), normalize(ar)));
  vec4 c = texture2D(vinyl, clamp(st, 0.0, 1.0));
  c.a *= inside * smoothstep(0.1, 0.3, facing) * unoccluded(map, m, scale, facing);
  return c;
}

void main() {
  vec4 c = project(origin[0], axisS[0], axisT[0], axisR[0], depth0, depthMatrix0, depthScale0);
  vec4 m = project(origin[1], axisS[1], axisT[1], axisR[1], depth1, depthMatrix1, depthScale1);
  m.a *= step(1.5, float(count));
  c = m.a > c.a ? m : c;
  if (useFlat) c.rgb = flatColor;
  c.a *= opacity;
  if (c.a <= 0.0) discard;
  gl_FragColor = c;
}
`

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const DILATE_FRAGMENT = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(src, vUv);
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec4 s = texture2D(src, vUv + vec2(float(dx), float(dy)) * texel);
      float w = step(0.5, s.a);
      sum += s.rgb * w;
      n += w;
    }
  }
  vec4 grown = n > 0.0 ? vec4(sum / max(n, 1.0), 1.0) : vec4(0.0);
  gl_FragColor = c.a > 0.5 ? c : grown;
}
`

const FINAL_FRAGMENT = /* glsl */ `
uniform sampler2D src;
uniform sampler2D ao;
uniform sampler2D alphaSource;
uniform bool hasAo;
uniform bool hasAlpha;
uniform bool fillFromSource;
uniform float aoStrength;
uniform vec3 fillColor;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(src, vUv);
  vec4 original = texture2D(alphaSource, vUv);
  vec3 fill = fillFromSource && hasAlpha ? original.rgb : fillColor;
  vec3 color = c.a > 0.5 ? c.rgb : fill;
  if (hasAo) color *= mix(1.0, texture2D(ao, vUv).r, aoStrength);
  gl_FragColor = vec4(color, hasAlpha ? original.a : 1.0);
}
`

const DILATE_PASSES = 8

export const RECOLOR_MODES = ['tint', 'glass', 'maps'] as const

export interface RecolorSettings {
  width: number
  height: number
  /**
   * tint: `color` with the source's shading (its luminance relative to
   * `reference`); glass: tint plus less transparency (`darkness`); maps:
   * `color` holds finish values written where `mask` (the part's diffuse
   * texture) is repainted.
   */
  mode: (typeof RECOLOR_MODES)[number]
  color: [number, number, number]
  /** Source luminance that becomes exactly `color`. */
  reference: number
  /** Normalised RGB of the part's own paint; pixels of other hues are logos. */
  paintDirection?: [number, number, number]
  keepLogos: boolean
  darkness?: number
  mask?: THREE.Texture | null
}

// The paint of a part is its dominant hue in any shade; pixels of another hue
// (a red logo on a silver rim, white lettering on a yellow caliper) can be
// kept. Texture fetches stay outside the branches on purpose.
const RECOLOR_FRAGMENT = /* glsl */ `
uniform sampler2D src;
uniform sampler2D maskSrc;
uniform bool hasMask;
uniform int mode;
uniform vec3 color;
uniform float reference;
uniform vec3 paintDirection;
uniform bool keepLogos;
uniform float darkness;
varying vec2 vUv;

float paintable(vec3 c) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float same = smoothstep(0.93, 0.975, dot(normalize(c + 1e-4), paintDirection));
  // near-black pixels have no reliable hue: shadows of the paint
  same = mix(1.0, same, smoothstep(0.03, 0.08, lum));
  return keepLogos ? same : 1.0;
}

void main() {
  vec4 s = texture2D(src, vUv);
  vec4 m = texture2D(maskSrc, vUv);
  float k = dot(s.rgb, vec3(0.299, 0.587, 0.114)) / max(reference, 0.02);
  if (mode == 0) {
    vec3 tinted = clamp(color * k, 0.0, 1.0);
    gl_FragColor = vec4(mix(s.rgb, tinted, paintable(s.rgb)), s.a);
  } else if (mode == 1) {
    vec3 tinted = clamp(color * clamp(k, 0.6, 1.4), 0.0, 1.0);
    gl_FragColor = vec4(tinted, s.a + (1.0 - s.a) * darkness);
  } else {
    float w = hasMask ? paintable(m.rgb) : 1.0;
    gl_FragColor = vec4(mix(s.rgb, color, w), s.a);
  }
}
`
/** Resolution of the per-projector depth maps used to find the first surface. */
const DEPTH_SIZE = 1024

/** Bound to samplers that have nothing to sample, so every sampler is valid. */
const WHITE = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  t.needsUpdate = true
  return t
})()
const MAX_UV_TILES = 64

/**
 * Offsets that bring every UV tile a mesh touches into 0..1. Samplers wrap,
 * so a mesh whose UVs lie in -1..0 (common in Kunos models) shows the same
 * texels as one in 0..1; the bake has to draw it where it will be sampled.
 */
export function uvTiles(geometry: THREE.BufferGeometry): [number, number][] {
  const cached = geometry.userData.uvTiles as [number, number][] | undefined
  if (cached) return cached
  const uv = geometry.getAttribute('uv')
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (let i = 0; i < (uv?.count ?? 0); i++) {
    const u = uv!.getX(i)
    const v = uv!.getY(i)
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  const tiles: [number, number][] = []
  if (Number.isFinite(minU)) {
    // a hair of slack so 0..1 meshes with rounding noise stay one tile
    const eps = 1e-4
    const u0 = Math.floor(minU + eps)
    const v0 = Math.floor(minV + eps)
    const u1 = Math.max(u0, Math.ceil(maxU - eps) - 1)
    const v1 = Math.max(v0, Math.ceil(maxV - eps) - 1)
    for (let v = v0; v <= v1 && tiles.length < MAX_UV_TILES; v++) {
      for (let u = u0; u <= u1 && tiles.length < MAX_UV_TILES; u++) tiles.push([0 - u, 0 - v])
    }
  }
  geometry.userData.uvTiles = tiles
  return tiles
}

/** Draws each mesh once per UV tile it touches. */
function drawMeshes(
  renderer: THREE.WebGLRenderer,
  meshes: BakeMesh[],
  material: THREE.ShaderMaterial,
  camera: THREE.Camera,
): void {
  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(undefined, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  for (const m of meshes) {
    mesh.geometry = m.geometry
    material.uniforms.world!.value.copy(m.world)
    for (const [du, dv] of uvTiles(m.geometry)) {
      material.uniforms.uvOffset!.value.set(du, dv)
      material.uniformsNeedUpdate = true
      renderer.render(scene, camera)
    }
  }
}

function nearestTarget(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  })
}

export class LiveryBaker {
  private readonly camera = new THREE.OrthographicCamera()
  private readonly quad: THREE.Mesh
  private readonly quadScene = new THREE.Scene()
  private readonly designMaterial: THREE.ShaderMaterial
  private readonly layerMaterial: THREE.ShaderMaterial
  private readonly dilateMaterial: THREE.ShaderMaterial
  private readonly finalMaterial: THREE.ShaderMaterial
  private readonly recolorMaterial = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: RECOLOR_FRAGMENT,
    uniforms: {
      src: { value: null },
      maskSrc: { value: null },
      hasMask: { value: false },
      mode: { value: 0 },
      color: { value: new THREE.Vector3() },
      reference: { value: 0.5 },
      paintDirection: { value: new THREE.Vector3(1, 1, 1).normalize() },
      keepLogos: { value: true },
      darkness: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  })
  private depthTargets: THREE.WebGLRenderTarget[] = []
  private readonly depthCamera = new THREE.OrthographicCamera()
  private readonly depthMaterial = new THREE.ShaderMaterial({
    vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `void main() { gl_FragColor = vec4(1.0); }`,
    side: THREE.DoubleSide,
    colorWrite: false,
  })
  private ping: THREE.WebGLRenderTarget | null = null
  private pong: THREE.WebGLRenderTarget | null = null
  /** One mipmapped result per texture name; kept across bakes of the same size. */
  private readonly outputs = new Map<string, THREE.WebGLRenderTarget>()

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
    this.designMaterial = new THREE.ShaderMaterial({
      vertexShader: UV_VERTEX,
      fragmentShader: DESIGN_FRAGMENT,
      uniforms: {
        world: { value: new THREE.Matrix4() },
        uvOffset: { value: new THREE.Vector2() },
        baseColor: { value: new THREE.Vector3() },
        source: { value: null },
        useSource: { value: false },
      },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
    const vec3s = () => [new THREE.Vector3(), new THREE.Vector3()]
    this.layerMaterial = new THREE.ShaderMaterial({
      vertexShader: UV_VERTEX,
      fragmentShader: LAYER_FRAGMENT,
      uniforms: {
        world: { value: new THREE.Matrix4() },
        uvOffset: { value: new THREE.Vector2() },
        vinyl: { value: null },
        opacity: { value: 1 },
        useFlat: { value: false },
        flatColor: { value: new THREE.Vector3() },
        count: { value: 1 },
        origin: { value: vec3s() },
        axisS: { value: vec3s() },
        axisT: { value: vec3s() },
        axisR: { value: vec3s() },
        depth0: { value: null },
        depth1: { value: null },
        depthMatrix0: { value: new THREE.Matrix4() },
        depthMatrix1: { value: new THREE.Matrix4() },
        depthScale0: { value: new THREE.Vector2(1, 1) },
        depthScale1: { value: new THREE.Vector2(1, 1) },
      },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // colour blends over what is below; alpha keeps marking covered texels
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    })
    this.dilateMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: DILATE_FRAGMENT,
      uniforms: { src: { value: null }, texel: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    })
    this.finalMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: FINAL_FRAGMENT,
      uniforms: {
        src: { value: null },
        ao: { value: null },
        alphaSource: { value: null },
        hasAo: { value: false },
        hasAlpha: { value: false },
        fillFromSource: { value: false },
        aoStrength: { value: 1 },
        fillColor: { value: new THREE.Vector3() },
      },
      depthTest: false,
      depthWrite: false,
    })
  }

  private ensureTargets(key: string, width: number, height: number): THREE.WebGLRenderTarget {
    if (!this.ping || this.ping.width !== width || this.ping.height !== height) {
      this.ping?.dispose()
      this.pong?.dispose()
      this.ping = nearestTarget(width, height)
      this.pong = nearestTarget(width, height)
    }
    return this.outputTarget(key, width, height)
  }

  /** The mipmapped result texture for `key`, reused while its size stays the same. */
  private outputTarget(key: string, width: number, height: number): THREE.WebGLRenderTarget {
    const existing = this.outputs.get(key)
    if (existing && existing.width === width && existing.height === height) return existing
    existing?.dispose()
    const output = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
      anisotropy: 8,
    })
    const t = output.texture
    t.flipY = false
    t.colorSpace = THREE.NoColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    this.outputs.set(key, output)
    return output
  }

  private depthTarget(index: number): THREE.WebGLRenderTarget {
    let target = this.depthTargets[index]
    if (!target) {
      const depthTexture = new THREE.DepthTexture(DEPTH_SIZE, DEPTH_SIZE, THREE.UnsignedIntType)
      depthTexture.minFilter = THREE.NearestFilter
      depthTexture.magFilter = THREE.NearestFilter
      target = new THREE.WebGLRenderTarget(DEPTH_SIZE, DEPTH_SIZE, {
        depthBuffer: true,
        depthTexture,
        generateMipmaps: false,
      })
      this.depthTargets[index] = target
    }
    return target
  }

  /**
   * Renders the depth of the occluders as seen by a projector, looking along
   * its direction from the near end of its box. Returns the matrix that maps
   * world points to the depth map and its scale (texel size, depth range).
   */
  private renderDepth(
    scene: THREE.Scene,
    p: BakeProjector,
    target: THREE.WebGLRenderTarget,
  ): { matrix: THREE.Matrix4; scale: THREE.Vector2 } {
    const len = (v: [number, number, number]) => Math.hypot(v[0], v[1], v[2])
    const w = 1 / len(p.axisS)
    const h = 1 / len(p.axisT)
    const d = 1 / len(p.axisR)
    const origin = new THREE.Vector3(...p.origin)
    const dir = new THREE.Vector3(...p.axisR).multiplyScalar(d)
    const cam = this.depthCamera
    cam.left = -w / 2
    cam.right = w / 2
    cam.top = h / 2
    cam.bottom = -h / 2
    cam.near = 0
    cam.far = d
    cam.updateProjectionMatrix()
    cam.position.copy(origin).addScaledVector(dir, -d / 2)
    cam.up.set(...p.axisT).normalize()
    cam.lookAt(origin)
    cam.updateMatrixWorld()
    const r = this.renderer
    r.setRenderTarget(target)
    r.clear(false, true, false)
    r.render(scene, cam)
    return {
      matrix: new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
      scale: new THREE.Vector2(Math.max(w, h) / DEPTH_SIZE, d),
    }
  }

  /** Drops results for textures that are no longer painted. */
  keepOnly(keys: Iterable<string>): void {
    const keep = new Set(keys)
    for (const [key, target] of this.outputs) {
      if (!keep.has(key)) {
        target.dispose()
        this.outputs.delete(key)
      }
    }
  }

  /** Bakes one texture (identified by `key`, the texture name) and returns the result. */
  bake(key: string, meshes: BakeMesh[], settings: BakeSettings): THREE.Texture {
    const { width, height } = settings
    const output = this.ensureTargets(key, width, height)
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    const prevClear = r.getClearColor(new THREE.Color())
    const prevAlpha = r.getClearAlpha()
    const prevAutoClear = r.autoClear

    // 1. design pass
    r.setRenderTarget(this.ping)
    r.setClearColor(0x000000, 0)
    r.clear(true, false, false)
    r.autoClear = false
    const du = this.designMaterial.uniforms
    du.baseColor!.value.set(...settings.baseColor)
    du.useSource!.value = !!settings.baseFromSource && !!settings.alphaSource
    du.source!.value = settings.alphaSource ?? WHITE
    drawMeshes(r, meshes, this.designMaterial, this.camera)

    // 1b. vinyls, bottom to top, blended over the base colour
    const lu = this.layerMaterial.uniforms
    const layers = (settings.layers ?? []).filter((l) => l.projectors.length && l.opacity > 0)
    const occluders = new THREE.Scene()
    if (layers.length) {
      for (const m of settings.occluders ?? meshes) {
        const o = new THREE.Mesh(m.geometry, this.depthMaterial)
        o.matrixAutoUpdate = false
        o.matrix.copy(m.world)
        occluders.add(o)
      }
      occluders.updateMatrixWorld(true)
    }
    for (const layer of layers) {
      // depth maps first: they switch the render target
      const depth = layer.projectors
        .slice(0, 2)
        .map((p, i) => ({ ...this.renderDepth(occluders, p, this.depthTarget(i)), i }))
      const second = depth[1] ?? depth[0]!
      lu.depth0!.value = this.depthTarget(depth[0]!.i).depthTexture
      lu.depth1!.value = this.depthTarget(second.i).depthTexture
      lu.depthMatrix0!.value.copy(depth[0]!.matrix)
      lu.depthMatrix1!.value.copy(second.matrix)
      lu.depthScale0!.value.copy(depth[0]!.scale)
      lu.depthScale1!.value.copy(second.scale)
      r.setRenderTarget(this.ping)
      lu.vinyl!.value = layer.texture
      lu.opacity!.value = layer.opacity
      lu.useFlat!.value = !!layer.flatColor
      if (layer.flatColor) lu.flatColor!.value.set(...layer.flatColor)
      lu.count!.value = Math.min(2, layer.projectors.length)
      // the second slot always holds valid vectors (a copy when unused)
      const pair = [layer.projectors[0]!, layer.projectors[1] ?? layer.projectors[0]!]
      pair.forEach((p, i) => {
        lu.origin!.value[i].set(...p.origin)
        lu.axisS!.value[i].set(...p.axisS)
        lu.axisT!.value[i].set(...p.axisT)
        lu.axisR!.value[i].set(...p.axisR)
      })
      drawMeshes(r, meshes, this.layerMaterial, this.camera)
    }

    // 2. dilation (ping-pong)
    this.quad.material = this.dilateMaterial
    this.dilateMaterial.uniforms.texel!.value.set(1 / width, 1 / height)
    let src = this.ping!
    let dst = this.pong!
    for (let i = 0; i < DILATE_PASSES; i++) {
      this.dilateMaterial.uniforms.src!.value = src.texture
      r.setRenderTarget(dst)
      r.render(this.quadScene, this.camera)
      ;[src, dst] = [dst, src]
    }

    // 3. final composite into the mipmapped output
    const u = this.finalMaterial.uniforms
    u.src!.value = src.texture
    u.ao!.value = settings.ao ?? WHITE
    u.hasAo!.value = !!settings.ao && settings.aoStrength > 0
    u.aoStrength!.value = settings.aoStrength
    u.alphaSource!.value = settings.alphaSource ?? WHITE
    u.hasAlpha!.value = !!settings.alphaSource
    u.fillFromSource!.value = !!settings.fillFromSource
    u.fillColor!.value.set(...settings.baseColor)
    this.quad.material = this.finalMaterial
    r.setRenderTarget(output)
    r.render(this.quadScene, this.camera)

    r.setRenderTarget(prevTarget)
    r.setClearColor(prevClear, prevAlpha)
    r.autoClear = prevAutoClear
    return output.texture
  }

  /**
   * Recolours a whole texture in its own UV space (no projection): rims,
   * calipers, glass, or the material map of a part. The result is kept under
   * `key` like a baked livery texture.
   */
  recolor(key: string, source: THREE.Texture, settings: RecolorSettings): THREE.Texture {
    const output = this.outputTarget(key, settings.width, settings.height)
    const u = this.recolorMaterial.uniforms
    u.src!.value = source
    u.maskSrc!.value = settings.mask ?? WHITE
    u.hasMask!.value = !!settings.mask
    u.mode!.value = RECOLOR_MODES.indexOf(settings.mode)
    u.color!.value.set(...settings.color)
    u.reference!.value = settings.reference
    if (settings.paintDirection) u.paintDirection!.value.set(...settings.paintDirection)
    else u.paintDirection!.value.set(1, 1, 1).normalize()
    u.keepLogos!.value = settings.keepLogos
    u.darkness!.value = settings.darkness ?? 0
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    this.quad.material = this.recolorMaterial
    r.setRenderTarget(output)
    r.render(this.quadScene, this.camera)
    r.setRenderTarget(prevTarget)
    return output.texture
  }

  /** Reads a baked texture as RGBA8, row 0 = first row of the texture file. */
  readPixels(key: string): { width: number; height: number; rgba: Uint8Array } {
    const out = this.outputs.get(key)
    if (!out) throw new Error(`Nothing baked for ${key}`)
    const rgba = new Uint8Array(out.width * out.height * 4)
    this.renderer.readRenderTargetPixels(out, 0, 0, out.width, out.height, rgba)
    return { width: out.width, height: out.height, rgba }
  }

  dispose(): void {
    for (const t of this.depthTargets) {
      t.depthTexture?.dispose()
      t.dispose()
    }
    this.depthMaterial.dispose()
    this.recolorMaterial.dispose()
    this.ping?.dispose()
    this.pong?.dispose()
    this.keepOnly([])
    this.designMaterial.dispose()
    this.layerMaterial.dispose()
    this.dilateMaterial.dispose()
    this.finalMaterial.dispose()
    this.quad.geometry.dispose()
  }
}

// ---------------------------------------------------------------------------
// GPU helpers shared with AO extraction

/** Draws a texture into an RGBA8 buffer of the given size (downsampling through mipmaps). */
export function readTexture(
  renderer: THREE.WebGLRenderer,
  texture: THREE.Texture,
  width: number,
  height: number,
): Uint8Array {
  const target = nearestTarget(width, height)
  const material = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: /* glsl */ `uniform sampler2D src; varying vec2 vUv; void main(){ gl_FragColor = texture2D(src, vUv); }`,
    uniforms: { src: { value: texture } },
    depthTest: false,
    depthWrite: false,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(quad)
  const prev = renderer.getRenderTarget()
  renderer.setRenderTarget(target)
  renderer.render(scene, new THREE.OrthographicCamera())
  const out = new Uint8Array(width * height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, width, height, out)
  renderer.setRenderTarget(prev)
  target.dispose()
  material.dispose()
  quad.geometry.dispose()
  return out
}

/** Rasterizes UV coverage of the meshes; returns one byte per texel (255 = covered). */
export function uvCoverage(
  renderer: THREE.WebGLRenderer,
  meshes: BakeMesh[],
  width: number,
  height: number,
): Uint8Array {
  const target = nearestTarget(width, height)
  const material = new THREE.ShaderMaterial({
    vertexShader: UV_VERTEX,
    fragmentShader: /* glsl */ `void main(){ gl_FragColor = vec4(1.0); }`,
    uniforms: { world: { value: new THREE.Matrix4() }, uvOffset: { value: new THREE.Vector2() } },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  })
  const prevTarget = renderer.getRenderTarget()
  const prevAutoClear = renderer.autoClear
  const prevClear = renderer.getClearColor(new THREE.Color())
  const prevAlpha = renderer.getClearAlpha()
  renderer.setRenderTarget(target)
  renderer.setClearColor(0x000000, 0)
  renderer.clear(true, false, false)
  renderer.autoClear = false
  drawMeshes(renderer, meshes, material, new THREE.OrthographicCamera())
  const rgba = new Uint8Array(width * height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, width, height, rgba)
  renderer.setRenderTarget(prevTarget)
  renderer.autoClear = prevAutoClear
  renderer.setClearColor(prevClear, prevAlpha)
  target.dispose()
  material.dispose()
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4]!
  return mask
}

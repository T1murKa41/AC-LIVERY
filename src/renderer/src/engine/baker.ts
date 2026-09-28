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
  /** Model-space world matrix (not the mirrored display matrix). */
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
}

export interface BakeSettings {
  width: number
  height: number
  baseColor: [number, number, number]
  ao: THREE.Texture | null
  aoStrength: number
  /** Original texture; its alpha channel is kept. */
  alphaSource: THREE.Texture | null
  /** Vinyls, bottom first. */
  layers?: BakeLayer[]
}

const UV_VERTEX = /* glsl */ `
uniform mat4 world;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vUv = uv;
  vWorldPos = (world * vec4(position, 1.0)).xyz;
  vWorldNormal = normalize(mat3(world) * normal);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`

const DESIGN_FRAGMENT = /* glsl */ `
uniform vec3 baseColor;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  gl_FragColor = vec4(baseColor, 1.0);
}
`

// Projects one vinyl onto the texels of the car. Surfaces seen at a grazing
// angle fade out so vinyls do not smear around sharp edges, and the depth
// limit keeps a sticker on the left door off the right door.
const LAYER_FRAGMENT = /* glsl */ `
uniform sampler2D vinyl;
uniform float opacity;
uniform int count;
uniform vec3 origin[2];
uniform vec3 axisS[2];
uniform vec3 axisT[2];
uniform vec3 axisR[2];
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

// No early returns or dynamic array indexing around the texture fetch: the
// sample must happen in uniform control flow, otherwise some Direct3D
// translations of WebGL drop or miscompile it.
vec4 project(vec3 o, vec3 as, vec3 at, vec3 ar) {
  vec3 q = vWorldPos - o;
  vec2 st = vec2(dot(q, as), dot(q, at)) + 0.5;
  float r = dot(q, ar);
  vec2 in2 = step(vec2(0.0), st) * step(st, vec2(1.0));
  float inside = in2.x * in2.y * step(abs(r), 0.5);
  // abs(): some models have flipped normals on mirrored halves; the depth
  // limit already keeps vinyls from reaching the other side of the car
  float facing = abs(dot(normalize(vWorldNormal), normalize(ar)));
  vec4 c = texture2D(vinyl, clamp(st, 0.0, 1.0));
  c.a *= inside * smoothstep(0.1, 0.3, facing);
  return c;
}

void main() {
  vec4 c = project(origin[0], axisS[0], axisT[0], axisR[0]);
  vec4 m = project(origin[1], axisS[1], axisT[1], axisR[1]);
  m.a *= step(1.5, float(count));
  c = m.a > c.a ? m : c;
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
uniform float aoStrength;
uniform vec3 fillColor;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(src, vUv);
  vec3 color = c.a > 0.5 ? c.rgb : fillColor;
  if (hasAo) color *= mix(1.0, texture2D(ao, vUv).r, aoStrength);
  float alpha = hasAlpha ? texture2D(alphaSource, vUv).a : 1.0;
  gl_FragColor = vec4(color, alpha);
}
`

const DILATE_PASSES = 8

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
        baseColor: { value: new THREE.Vector3() },
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
        vinyl: { value: null },
        opacity: { value: 1 },
        count: { value: 1 },
        origin: { value: vec3s() },
        axisS: { value: vec3s() },
        axisT: { value: vec3s() },
        axisR: { value: vec3s() },
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
    const scene = new THREE.Scene()
    const mesh = new THREE.Mesh(undefined, this.designMaterial)
    mesh.frustumCulled = false
    scene.add(mesh)
    this.designMaterial.uniforms.baseColor!.value.set(...settings.baseColor)
    for (const m of meshes) {
      mesh.geometry = m.geometry
      this.designMaterial.uniforms.world!.value.copy(m.world)
      this.designMaterial.uniformsNeedUpdate = true
      r.render(scene, this.camera)
    }

    // 1b. vinyls, bottom to top, blended over the base colour
    mesh.material = this.layerMaterial
    const lu = this.layerMaterial.uniforms
    for (const layer of settings.layers ?? []) {
      if (!layer.projectors.length || layer.opacity <= 0) continue
      lu.vinyl!.value = layer.texture
      lu.opacity!.value = layer.opacity
      lu.count!.value = Math.min(2, layer.projectors.length)
      // the second slot always holds valid vectors (a copy when unused)
      const pair = [layer.projectors[0]!, layer.projectors[1] ?? layer.projectors[0]!]
      pair.forEach((p, i) => {
        lu.origin!.value[i].set(...p.origin)
        lu.axisS!.value[i].set(...p.axisS)
        lu.axisT!.value[i].set(...p.axisT)
        lu.axisR!.value[i].set(...p.axisR)
      })
      for (const m of meshes) {
        mesh.geometry = m.geometry
        lu.world!.value.copy(m.world)
        this.layerMaterial.uniformsNeedUpdate = true
        r.render(scene, this.camera)
      }
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
    u.ao!.value = settings.ao
    u.hasAo!.value = !!settings.ao && settings.aoStrength > 0
    u.aoStrength!.value = settings.aoStrength
    u.alphaSource!.value = settings.alphaSource
    u.hasAlpha!.value = !!settings.alphaSource
    u.fillColor!.value.set(...settings.baseColor)
    this.quad.material = this.finalMaterial
    r.setRenderTarget(output)
    r.render(this.quadScene, this.camera)

    r.setRenderTarget(prevTarget)
    r.setClearColor(prevClear, prevAlpha)
    r.autoClear = prevAutoClear
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
    uniforms: { world: { value: new THREE.Matrix4() } },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  })
  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(undefined, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  const prevTarget = renderer.getRenderTarget()
  const prevAutoClear = renderer.autoClear
  const prevClear = renderer.getClearColor(new THREE.Color())
  const prevAlpha = renderer.getClearAlpha()
  renderer.setRenderTarget(target)
  renderer.setClearColor(0x000000, 0)
  renderer.clear(true, false, false)
  renderer.autoClear = false
  for (const m of meshes) {
    mesh.geometry = m.geometry
    material.uniforms.world!.value.copy(m.world)
    renderer.render(scene, new THREE.OrthographicCamera())
  }
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

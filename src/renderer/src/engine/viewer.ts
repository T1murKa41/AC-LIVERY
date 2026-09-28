// 3D viewer: owns the WebGL renderer, builds the car scene from a LoadedCar
// and resolves textures (model textures, skin overrides, live livery).

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CarFrame, V3 } from '@shared/car/analysis'
import { createAcMaterial, refreshMaterialTextures } from './acMaterial'
import { loadTextureFromBytes, missingTexture, type TextureInfo } from './textures'
import type { LoadedCar, LoadedMesh } from './types'

THREE.ColorManagement.enabled = false

export type ViewMode = 'perspective' | 'left' | 'right' | 'top' | 'front' | 'rear'

export interface CarMesh {
  mesh: THREE.Mesh
  source: LoadedMesh
}

const BACKGROUND = /* glsl */ `
varying vec2 vUv;
void main() {
  vec3 top = vec3(0.13, 0.14, 0.16);
  vec3 bottom = vec3(0.07, 0.075, 0.085);
  gl_FragColor = vec4(mix(bottom, top, vUv.y), 1.0);
}
`

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`

const GROUND_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform vec2 halfSize;
uniform vec2 innerSize;
void main() {
  // soft contact shadow shaped like the car footprint, fading out at the plane edge
  vec2 q = abs(vUv - 0.5) * 2.0 * halfSize;
  float d = length(max(q - innerSize, 0.0)) / length(halfSize - innerSize);
  float shadow = pow(1.0 - smoothstep(0.0, 1.0, d), 2.0) * 0.55;
  gl_FragColor = vec4(0.0, 0.0, 0.0, shadow);
}
`

export class Viewer {
  readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly persp = new THREE.PerspectiveCamera(32, 1, 0.05, 200)
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 200)
  private camera: THREE.Camera = this.persp
  private readonly controls: OrbitControls
  private readonly background: THREE.Mesh
  private ground: THREE.Mesh | null = null
  private carRoot: THREE.Group | null = null
  private car: LoadedCar | null = null
  private frame: CarFrame | null = null
  private readonly modelTextures = new Map<string, TextureInfo>()
  private readonly overrides = new Map<string, THREE.Texture>()
  private materials: THREE.ShaderMaterial[] = []
  private meshes: CarMesh[] = []
  private view: ViewMode = 'perspective'
  private frameRequested = false
  private disposed = false
  private readonly resizeObserver: ResizeObserver

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    })
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.controls = new OrbitControls(this.persp, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.addEventListener('change', () => this.requestRender())

    this.background = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: BACKGROUND,
        depthWrite: false,
        depthTest: false,
      }),
    )
    this.background.frustumCulled = false
    this.background.renderOrder = -1000
    this.scene.add(this.background)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
  }

  get loadedCar(): LoadedCar | null {
    return this.car
  }

  get carMeshes(): readonly CarMesh[] {
    return this.meshes
  }

  get carFrame(): CarFrame | null {
    return this.frame
  }

  /** Converts a direction from model space to display space (undoes mirroring). */
  toDisplay(v: V3): THREE.Vector3 {
    return new THREE.Vector3(this.frame?.mirrored ? -v[0] : v[0], v[1], v[2])
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth)
    const h = Math.max(1, this.canvas.clientHeight)
    this.renderer.setSize(w, h, false)
    this.persp.aspect = w / h
    this.persp.updateProjectionMatrix()
    this.updateOrthoFrustum()
    this.requestRender()
  }

  requestRender(): void {
    if (this.frameRequested || this.disposed) return
    this.frameRequested = true
    requestAnimationFrame(() => {
      this.frameRequested = false
      if (this.disposed) return
      const moving = this.controls.update()
      this.renderer.render(this.scene, this.camera)
      if (moving) this.requestRender()
    })
  }

  // -------------------------------------------------------------------------
  // Car

  async setCar(car: LoadedCar): Promise<string[]> {
    this.clearCar()
    this.car = car
    this.frame = car.analysis.frame
    const warnings: string[] = []

    for (const t of car.textures) {
      try {
        this.modelTextures.set(
          t.name.toLowerCase(),
          await loadTextureFromBytes(t.data, this.renderer),
        )
      } catch (err) {
        warnings.push(`${t.name}: ${err instanceof Error ? err.message : String(err)}`)
        this.modelTextures.set(t.name.toLowerCase(), {
          texture: missingTexture(),
          width: 1,
          height: 1,
          format: 'image',
          hasAlpha: false,
        })
      }
    }

    const resolve = (name: string) => this.resolveTexture(name)
    this.materials = car.materials.map((m) => createAcMaterial(m, resolve))

    const root = new THREE.Group()
    root.name = 'car'
    if (this.frame.mirrored) root.scale.x = -1
    const flip = car.analysis.flipWinding
    for (const src of car.meshes) {
      const geometry = buildGeometry(src, flip)
      const material = this.materials[src.materialId] ?? this.materials[0]!
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = src.name
      mesh.matrixAutoUpdate = false
      mesh.matrix.fromArray(src.world)
      mesh.visible = !src.hidden
      mesh.userData.index = src.index
      if (material.transparent) mesh.renderOrder = 10
      root.add(mesh)
      this.meshes.push({ mesh, source: src })
    }
    root.updateMatrixWorld(true)
    this.carRoot = root
    this.scene.add(root)
    this.addGround()
    this.setView('perspective', true)
    return warnings
  }

  private addGround(): void {
    if (!this.frame || !this.carRoot) return
    const box = new THREE.Box3()
    for (const { mesh } of this.meshes) if (mesh.visible) box.expandByObject(mesh)
    const f = this.frame
    const plane = new THREE.PlaneGeometry(f.width * 1.6, f.length * 1.35)
    const ground = new THREE.Mesh(
      plane,
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: GROUND_FRAGMENT,
        uniforms: {
          halfSize: { value: new THREE.Vector2(f.width * 0.8, f.length * 0.675) },
          innerSize: { value: new THREE.Vector2(f.width * 0.42, f.length * 0.44) },
        },
        transparent: true,
        depthWrite: false,
      }),
    )
    const origin = this.toDisplay(f.origin)
    const forward = this.toDisplay(f.forward)
    ground.position.set(origin.x, box.isEmpty() ? 0 : box.min.y + 0.002, origin.z)
    ground.rotation.x = -Math.PI / 2
    ground.rotation.z = Math.atan2(forward.x, forward.z)
    ground.renderOrder = -1
    this.ground = ground
    this.scene.add(ground)
  }

  private clearCar(): void {
    if (this.carRoot) {
      this.scene.remove(this.carRoot)
      for (const { mesh } of this.meshes) mesh.geometry.dispose()
    }
    if (this.ground) {
      this.scene.remove(this.ground)
      this.ground.geometry.dispose()
      ;(this.ground.material as THREE.Material).dispose()
      this.ground = null
    }
    for (const m of this.materials) m.dispose()
    for (const t of this.modelTextures.values()) t.texture.dispose()
    this.modelTextures.clear()
    this.overrides.clear()
    this.materials = []
    this.meshes = []
    this.carRoot = null
    this.car = null
    this.frame = null
  }

  // -------------------------------------------------------------------------
  // Textures

  modelTexture(name: string): TextureInfo | undefined {
    return this.modelTextures.get(name.toLowerCase())
  }

  private resolveTexture(name: string): THREE.Texture | null {
    const key = name.toLowerCase()
    return this.overrides.get(key) ?? this.modelTextures.get(key)?.texture ?? null
  }

  /** Replaces a model texture by name (skin file or live livery); null restores the model's. */
  setOverride(name: string, texture: THREE.Texture | null): void {
    const key = name.toLowerCase()
    if (texture) this.overrides.set(key, texture)
    else this.overrides.delete(key)
    const resolve = (n: string) => this.resolveTexture(n)
    for (const m of this.materials) refreshMaterialTextures(m, resolve)
    this.requestRender()
  }

  clearOverrides(): void {
    this.overrides.clear()
    const resolve = (n: string) => this.resolveTexture(n)
    for (const m of this.materials) refreshMaterialTextures(m, resolve)
    this.requestRender()
  }

  /** Tints the given kn5 materials (used to show which parts carry the livery). */
  highlightMaterials(materialIds: ReadonlySet<number> | null): void {
    this.materials.forEach((m, i) => {
      m.uniforms.highlight!.value = materialIds?.has(i) ? 1 : 0
    })
    this.requestRender()
  }

  // -------------------------------------------------------------------------
  // Views

  getView(): ViewMode {
    return this.view
  }

  setView(view: ViewMode, reset = false): void {
    const f = this.frame
    this.view = view
    if (!f) return
    const origin = this.toDisplay(f.origin)
    const forward = this.toDisplay(f.forward)
    const left = this.toDisplay(f.left)
    const up = new THREE.Vector3(0, 1, 0)
    const radius = Math.hypot(f.length, f.width, f.height) / 2

    if (view === 'perspective') {
      this.camera = this.persp
      this.controls.object = this.persp
      this.controls.enableRotate = true
      if (reset || !this.persp.userData.placed) {
        const dir = forward
          .clone()
          .multiplyScalar(0.75)
          .add(left.clone().multiplyScalar(0.9))
          .add(up.clone().multiplyScalar(0.38))
          .normalize()
        const dist = (radius / Math.sin(THREE.MathUtils.degToRad(this.persp.fov / 2))) * 1.05
        this.persp.position.copy(origin).addScaledVector(dir, dist)
        this.persp.up.set(0, 1, 0)
        this.persp.userData.placed = true
      }
      this.controls.target.copy(origin)
    } else {
      this.camera = this.ortho
      this.controls.object = this.ortho
      this.controls.enableRotate = false
      const dist = radius * 4
      const dirs: Record<Exclude<ViewMode, 'perspective'>, THREE.Vector3> = {
        left: left.clone(),
        right: left.clone().negate(),
        top: up.clone(),
        front: forward.clone(),
        rear: forward.clone().negate(),
      }
      this.ortho.position.copy(origin).addScaledVector(dirs[view], dist)
      this.ortho.up.copy(view === 'top' ? forward : up)
      this.ortho.zoom = 1
      this.controls.target.copy(origin)
      this.updateOrthoFrustum()
    }
    this.controls.update()
    this.requestRender()
  }

  private updateOrthoFrustum(): void {
    const f = this.frame
    if (!f) return
    const aspect = this.persp.aspect
    // visible extents of the car in this view
    let w = f.length
    let h = f.height
    if (this.view === 'top') {
      w = f.width
      h = f.length
    } else if (this.view === 'front' || this.view === 'rear') {
      w = f.width
      h = f.height
    }
    const margin = 1.12
    let halfW = (w * margin) / 2
    let halfH = (h * margin) / 2
    if (halfW / halfH > aspect) halfH = halfW / aspect
    else halfW = halfH * aspect
    this.ortho.left = -halfW
    this.ortho.right = halfW
    this.ortho.top = halfH
    this.ortho.bottom = -halfH
    this.ortho.near = 0.01
    this.ortho.far = Math.hypot(f.length, f.width, f.height) * 10
    this.ortho.updateProjectionMatrix()
  }

  // -------------------------------------------------------------------------
  // Capture

  /**
   * Renders a studio shot from the standard 3/4 front angle into an RGBA
   * buffer (top row first), independent of the on-screen camera.
   */
  capturePreview(width: number, height: number): Uint8Array {
    const f = this.frame
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 })
    const cam = new THREE.PerspectiveCamera(28, width / height, 0.05, 200)
    if (f) {
      const origin = this.toDisplay(f.origin)
      const forward = this.toDisplay(f.forward)
      const left = this.toDisplay(f.left)
      const dir = forward
        .multiplyScalar(0.8)
        .add(left.multiplyScalar(0.85))
        .add(new THREE.Vector3(0, 0.3, 0))
        .normalize()
      const radius = Math.hypot(f.length, f.width, f.height) / 2
      const fit = Math.max(1, (f.length * 0.9) / (radius * 2 * (width / height) * 0.55))
      const dist = (radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 0.92 * fit
      cam.position.copy(origin).addScaledVector(dir, dist)
      cam.lookAt(origin.x, origin.y - f.height * 0.08, origin.z)
    }
    const prev = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, cam)
    const pixels = new Uint8Array(width * height * 4)
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
    this.renderer.setRenderTarget(prev)
    target.dispose()
    return flipRows(pixels, width, height)
  }

  dispose(): void {
    this.disposed = true
    this.resizeObserver.disconnect()
    this.clearCar()
    this.controls.dispose()
    this.renderer.dispose()
  }
}

export function flipRows(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(pixels.length)
  const row = width * 4
  for (let y = 0; y < height; y++)
    out.set(pixels.subarray(y * row, (y + 1) * row), (height - 1 - y) * row)
  return out
}

export function buildGeometry(src: LoadedMesh, flipWinding: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(src.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(src.normals, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(src.uvs, 2))
  g.setAttribute('tangentU', new THREE.BufferAttribute(src.tangents, 3))
  let indices = src.indices
  if (flipWinding) {
    indices = new Uint16Array(src.indices)
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const t = indices[i + 1]!
      indices[i + 1] = indices[i + 2]!
      indices[i + 2] = t
    }
  }
  g.setIndex(new THREE.BufferAttribute(indices, 1))
  g.computeBoundingSphere()
  return g
}

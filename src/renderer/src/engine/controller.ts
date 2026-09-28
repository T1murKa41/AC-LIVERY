// Glue between the 3D engine and the app: loads a car into the viewer, applies
// stock skins, resolves the AO source, bakes the livery and prepares exports.
// One instance lives as long as the viewport canvas.

import * as THREE from 'three'
import { carDir, skinDir, type Backend, type CarDetails, type ExportTexture } from '@shared/api'
import type { CarAnalysis } from '@shared/car/analysis'
import { canDecodeOnCpu, decodeDdsMip, isDds, parseDds } from '@shared/formats/dds'
import { aoSourceScore } from '@shared/image/ao'
import { LiveryBaker, readTexture, uvCoverage, type BakeLayer, type BakeMesh } from './baker'
import { hitsProjector, placeAt, projectors, type Frame } from '@shared/design/placement'
import type { Design, Layer, Placement } from '@shared/design/types'
import { rasterize, rasterKey } from './vinyl'
import { extractAoInWorker } from './aoWorker'
import { parseCarInWorker } from './loadCar'
import { loadTextureFromBytes, textureSize, type TextureInfo } from './textures'
import { Viewer, type InteractionHandler, type RayHit, type ViewMode } from './viewer'

/** 'auto' | 'none' | 'model' | 'skin:<id>' */
export type AoSource = string

export interface LiveryParams {
  baseColor: string
  aoSource: AoSource
  aoStrength: number
  /** Texture names to repaint. */
  textures: string[]
  /** Stock skin providing every other texture; null = the model's own textures. */
  baseSkin: string | null
  design: Design
  /** Other textures to blank out (e.g. stock sponsor decals). */
  cleared: string[]
}

export interface LiveryCandidate {
  name: string
  /** Share of visible car pixels covered by this texture (0..1). */
  visible: number
  /** Surface area of the meshes using it, m². */
  area: number
}

export interface SkinTextureStatus {
  texture: string
  file?: string
  status: 'loaded' | 'missing' | 'error'
  format?: string
  width?: number
  height?: number
  error?: string
}

export interface AoResolution {
  /** Source actually used ('model', 'skin:<id>' or 'none'). */
  used: AoSource
  texture: THREE.Texture | null
}

/** Stand-in for textures the user blanked out. */
const TRANSPARENT = (() => {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1)
  t.needsUpdate = true
  return t
})()

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const v = m ? parseInt(m[1]!, 16) : 0xffffff
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

function findFile(files: string[], name: string): string | undefined {
  const lower = name.toLowerCase()
  return files.find((f) => f.toLowerCase() === lower)
}

export class EngineController {
  readonly viewer: Viewer
  private readonly baker: LiveryBaker
  private car: CarDetails | null = null
  private analysis: CarAnalysis | null = null
  private readonly skinTextures = new Map<string, Map<string, TextureInfo>>()
  private readonly aoCache = new Map<string, THREE.DataTexture | null>()
  private liveryActive = false
  private readonly autoAoPick = new Map<string, AoSource>()
  private candidates: LiveryCandidate[] | null = null
  private painted: string[] = []
  private cleared: string[] = []
  private readonly vinyls = new Map<string, { key: string; texture: THREE.CanvasTexture }>()
  private baseSkin: string | null = null
  private lastSkinStatus: SkinTextureStatus[] = []
  private generation = 0

  constructor(
    canvas: HTMLCanvasElement,
    private readonly backend: Backend,
  ) {
    this.viewer = new Viewer(canvas)
    this.baker = new LiveryBaker(this.viewer.renderer)
  }

  get carAnalysis(): CarAnalysis | null {
    return this.analysis
  }

  // -------------------------------------------------------------------------
  // Loading

  /** Loads the model. Returns non-fatal warnings (e.g. textures that failed to decode). */
  async loadCar(car: CarDetails): Promise<{ analysis: CarAnalysis; warnings: string[] }> {
    const gen = ++this.generation
    this.disposeCarResources()
    this.car = car
    if (!car.kn5) throw Object.assign(new Error('no-model'), { kind: 'no-model' })
    const bytes = await this.backend.readFile(`${carDir(car.id)}/${car.kn5}`)
    const skinFileNames = [...new Set(car.skins.flatMap((s) => s.files))]
    const loaded = await parseCarInWorker(bytes, skinFileNames)
    if (gen !== this.generation) throw Object.assign(new Error('cancelled'), { kind: 'cancelled' })
    const warnings = await this.viewer.setCar(loaded)
    this.analysis = loaded.analysis
    return { analysis: loaded.analysis, warnings }
  }

  /** Updates the skin list after an export without reloading the model. */
  updateCarDetails(car: CarDetails): void {
    this.car = car
    // skins written by AC Livery may have just changed on disk
    for (const skin of car.skins) {
      if (!skin.ours) continue
      for (const t of this.skinTextures.get(skin.id)?.values() ?? []) t.texture.dispose()
      this.skinTextures.delete(skin.id)
    }
  }

  get hasLivery(): boolean {
    return this.liveryActive
  }

  private disposeCarResources(): void {
    for (const skin of this.skinTextures.values())
      for (const t of skin.values()) t.texture.dispose()
    this.skinTextures.clear()
    for (const t of this.aoCache.values()) t?.dispose()
    this.aoCache.clear()
    this.autoAoPick.clear()
    this.candidates = null
    this.painted = []
    this.baseSkin = null
    this.lastSkinStatus = []
    this.liveryActive = false
    this.analysis = null
  }

  private async skinTexture(skinId: string, textureName: string): Promise<TextureInfo | null> {
    const skin = this.car?.skins.find((s) => s.id === skinId)
    const file = skin && findFile(skin.files, textureName)
    if (!this.car || !file) return null
    let cache = this.skinTextures.get(skinId)
    if (!cache) {
      cache = new Map()
      this.skinTextures.set(skinId, cache)
    }
    const key = textureName.toLowerCase()
    const hit = cache.get(key)
    if (hit) return hit
    const bytes = new Uint8Array(
      await this.backend.readFile(`${skinDir(this.car.id, skinId)}/${file}`),
    )
    const info = await loadTextureFromBytes(bytes, this.viewer.renderer)
    cache.set(key, info)
    return info
  }

  /**
   * Shows a stock skin (null = textures embedded in the model) and reports,
   * for every paintable texture, whether the skin's file was used.
   */
  async showSkin(skinId: string | null): Promise<SkinTextureStatus[]> {
    this.liveryActive = false
    this.viewer.clearOverrides()
    if (!skinId || !this.analysis) return []
    const skin = this.car?.skins.find((s) => s.id === skinId)
    const status = await Promise.all(
      this.analysis.paintable.map(async (name): Promise<SkinTextureStatus> => {
        const file = skin && findFile(skin.files, name)
        if (!file) return { texture: name, status: 'missing' }
        try {
          const info = await this.skinTexture(skinId, name)
          if (!info) return { texture: name, file, status: 'missing' }
          if (!this.liveryActive) this.viewer.setOverride(name, info.texture)
          return {
            texture: name,
            file,
            status: 'loaded',
            format: info.format,
            width: info.width,
            height: info.height,
          }
        } catch (err) {
          return {
            texture: name,
            file,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }),
    )
    this.lastSkinStatus = status
    return status
  }

  get skinStatus(): readonly SkinTextureStatus[] {
    return this.lastSkinStatus
  }

  // -------------------------------------------------------------------------
  // Livery

  /**
   * Paintable textures ranked by how much of the visible car they cover.
   * Measured once per car, with the stock skin that was shown first.
   */
  detectLiveryCandidates(): LiveryCandidate[] {
    if (this.candidates) return this.candidates
    const analysis = this.analysis
    if (!analysis) return []
    const shares = this.viewer.measureVisibleTextures()
    const paintable = new Set(analysis.paintable.map((n) => n.toLowerCase()))
    const pool = paintable.size
      ? analysis.diffuseUsage.filter((u) => paintable.has(u.name.toLowerCase()))
      : analysis.diffuseUsage
    this.candidates = pool
      .map((u) => ({ name: u.name, visible: shares.get(u.name.toLowerCase()) ?? 0, area: u.area }))
      .sort((a, b) => b.visible - a.visible || b.area - a.area)
      .slice(0, 16)
    return this.candidates
  }

  /** Default selection: the texture covering most of the visible car. */
  autoLiveryTextures(): string[] {
    const top = this.detectLiveryCandidates()[0]
    if (top && top.visible > 0) return [top.name]
    return this.analysis?.bodyTexture ? [this.analysis.bodyTexture] : []
  }

  private bakeMeshes(texture: string): BakeMesh[] {
    const key = texture.toLowerCase()
    const car = this.viewer.loadedCar
    if (!car) return []
    return (
      this.viewer.carMeshes
        .filter(({ source }) => {
          const mat = car.materials[source.materialId]
          const diffuse = mat?.textures.find((t) => t.name === 'txDiffuse')?.texture
          return diffuse?.toLowerCase() === key
        })
        // display space: vinyls are placed where the user sees them
        .map(({ mesh }) => ({ geometry: mesh.geometry, world: mesh.matrixWorld.clone() }))
    )
  }

  /** Candidate AO sources for a texture: the model plus every stock skin that has it. */
  private aoCandidates(texture: string): AoSource[] {
    if (!this.car) return []
    const skins = this.car.skins
      .filter((s) => !s.ours && findFile(s.files, texture))
      .map((s) => `skin:${s.id}`)
    return ['model', ...skins]
  }

  private async sourceTexture(source: AoSource, texture: string): Promise<TextureInfo | null> {
    if (source === 'model') return this.viewer.modelTexture(texture) ?? null
    if (source.startsWith('skin:')) return this.skinTexture(source.slice(5), texture)
    return null
  }

  /**
   * Small RGBA preview of a candidate for scoring. DDS files are decoded on the
   * CPU from a small mip level, so dozens of stock skins can be compared
   * without uploading their full textures to the GPU.
   */
  private async candidatePreview(
    source: AoSource,
    texture: string,
    size: number,
  ): Promise<Uint8Array | null> {
    if (!this.car) return null
    let bytes: Uint8Array | null = null
    if (source === 'model') {
      bytes =
        this.viewer.loadedCar?.textures.find((t) => t.name.toLowerCase() === texture.toLowerCase())
          ?.data ?? null
    } else if (source.startsWith('skin:')) {
      const skin = this.car.skins.find((s) => s.id === source.slice(5))
      const file = skin && findFile(skin.files, texture)
      if (skin && file) {
        bytes = new Uint8Array(
          await this.backend.readFile(`${skinDir(this.car.id, skin.id)}/${file}`),
        )
      }
    }
    if (bytes && isDds(bytes)) {
      const dds = parseDds(bytes)
      if (canDecodeOnCpu(dds.format)) {
        const mip =
          dds.mips.find((m) => Math.max(m.width, m.height) <= size * 2) ?? dds.mips.at(-1)!
        return resampleNearest(decodeDdsMip(dds.format, mip), mip.width, mip.height, size, size)
      }
    }
    // PNG/JPG or formats only the GPU can decode
    const info = await this.sourceTexture(source, texture).catch(() => null)
    return info ? readTexture(this.viewer.renderer, info.texture, size, size) : null
  }

  private async pickCleanest(texture: string): Promise<AoSource> {
    const key = texture.toLowerCase()
    const cached = this.autoAoPick.get(key)
    if (cached) return cached
    const size = 64
    const mask = uvCoverage(this.viewer.renderer, this.bakeMeshes(texture), size, size)
    let best: AoSource = 'model'
    let bestScore = -Infinity
    for (const candidate of this.aoCandidates(texture)) {
      const rgba = await this.candidatePreview(candidate, texture, size).catch(() => null)
      if (!rgba) continue
      const score = aoSourceScore(rgba, mask)
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
    this.autoAoPick.set(key, best)
    return best
  }

  private async resolveAo(texture: string, source: AoSource): Promise<AoResolution> {
    if (source === 'none') return { used: 'none', texture: null }
    let used = source === 'auto' ? await this.pickCleanest(texture) : source
    // a skin picked by hand may not have this particular texture
    if (used.startsWith('skin:') && !(await this.sourceTexture(used, texture))) used = 'model'
    const cacheKey = `${texture.toLowerCase()}|${used}`
    if (this.aoCache.has(cacheKey)) return { used, texture: this.aoCache.get(cacheKey) ?? null }
    const info = await this.sourceTexture(used, texture)
    if (!info) return { used: 'none', texture: null }
    const { width, height } = this.liveryTextureSize(texture, info)
    const rgba = readTexture(this.viewer.renderer, info.texture, width, height)
    const detail = await extractAoInWorker(rgba, width, height)
    const tex = new THREE.DataTexture(
      detail,
      width,
      height,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    )
    tex.unpackAlignment = 1
    tex.flipY = false
    tex.colorSpace = THREE.NoColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.needsUpdate = true
    this.aoCache.set(cacheKey, tex)
    return { used, texture: tex }
  }

  /** Output resolution: the stock texture size, capped at 8K. */
  private liveryTextureSize(
    texture: string,
    info?: TextureInfo | null,
  ): { width: number; height: number } {
    const src = info ?? this.viewer.modelTexture(texture)
    const width = Math.min(8192, Math.max(64, src?.width ?? 2048))
    const height = Math.min(8192, Math.max(64, src?.height ?? 2048))
    return { width, height }
  }

  /**
   * Repaints the given textures and shows the result. Every other paintable
   * texture comes from `baseSkin` (or the model when null), exactly as it
   * will be exported.
   */
  async bakeLivery(params: LiveryParams): Promise<{ aoUsed: AoSource }> {
    const analysis = this.analysis
    if (!analysis) return { aoUsed: 'none' }
    const textures = params.textures.filter((t) => this.viewer.modelTexture(t))
    const layers = await this.prepareLayers(params.design)
    const baked = new Map<string, THREE.Texture>()
    let aoUsed: AoSource = 'none'
    for (const [i, name] of textures.entries()) {
      const ao =
        params.aoStrength > 0
          ? await this.resolveAo(name, params.aoSource)
          : { used: 'none', texture: null }
      if (i === 0) aoUsed = ao.used
      const baseInfo = params.baseSkin
        ? await this.skinTexture(params.baseSkin, name).catch(() => null)
        : null
      const alphaInfo = baseInfo ?? this.viewer.modelTexture(name) ?? null
      const aoInfo = ao.used === 'none' ? null : await this.sourceTexture(ao.used, name)
      const texture = this.baker.bake(name.toLowerCase(), this.bakeMeshes(name), {
        ...this.liveryTextureSize(name, aoInfo ?? alphaInfo),
        baseColor: hexToRgb(params.baseColor),
        ao: ao.texture,
        aoStrength: params.aoStrength,
        alphaSource: alphaInfo?.texture ?? null,
        layers,
      })
      baked.set(name.toLowerCase(), texture)
    }
    this.baker.keepOnly(baked.keys())

    // load the base skin before touching the view to avoid flicker
    const base = new Map<string, THREE.Texture>()
    if (params.baseSkin) {
      for (const name of analysis.paintable) {
        if (baked.has(name.toLowerCase())) continue
        const info = await this.skinTexture(params.baseSkin, name).catch(() => null)
        if (info) base.set(name, info.texture)
      }
    }
    const cleared = params.cleared.filter(
      (n) => !baked.has(n.toLowerCase()) && this.viewer.modelTexture(n),
    )
    this.viewer.clearOverrides()
    for (const [name, texture] of base) this.viewer.setOverride(name, texture)
    for (const name of cleared) this.viewer.setOverride(name, TRANSPARENT)
    for (const name of textures) this.viewer.setOverride(name, baked.get(name.toLowerCase())!)
    this.painted = textures
    this.setPaintFilter(textures)
    this.cleared = cleared
    this.baseSkin = params.baseSkin
    this.liveryActive = textures.length > 0
    return { aoUsed }
  }

  // -------------------------------------------------------------------------
  // Vinyls

  displayFrame(): Frame | null {
    return this.viewer.displayFrame()
  }

  private paintedMeshes = new Set<number>()

  /** Mouse rays and placement only consider meshes that carry the given textures. */
  setPaintFilter(textures: string[]): void {
    const car = this.viewer.loadedCar
    const keys = new Set(textures.map((t) => t.toLowerCase()))
    this.paintedMeshes = new Set(
      (car?.meshes ?? [])
        .filter((m) => {
          const tex = car!.materials[m.materialId]?.textures.find((t) => t.name === 'txDiffuse')
          return !!tex && keys.has(tex.texture.toLowerCase())
        })
        .map((m) => m.index),
    )
    this.viewer.hitFilter = this.paintedMeshes.size ? (i) => this.paintedMeshes.has(i) : null
  }

  /**
   * Whether any part of a layer's projector reaches the painted surface.
   * Samples the centre and four inner points of each projector.
   */
  layerReachesPaint(layer: Layer): boolean {
    const frame = this.displayFrame()
    if (!frame || this.paintedMeshes.size === 0) return true
    const filter = (i: number) => this.paintedMeshes.has(i)
    const len2 = (v: number[]) => v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2
    for (const p of projectors(frame, layer.placement)) {
      const depth = 1 / Math.sqrt(len2(p.axisR))
      const dir = p.axisR.map((v) => v * depth) as [number, number, number]
      const sx = p.axisS.map((v) => v / len2(p.axisS))
      const tx = p.axisT.map((v) => v / len2(p.axisT))
      const samples: [number, number][] = [
        [0, 0],
        [-0.3, -0.3],
        [0.3, -0.3],
        [-0.3, 0.3],
        [0.3, 0.3],
      ]
      for (const [a, b] of samples) {
        const from = [0, 1, 2].map(
          (k) => p.origin[k]! + sx[k]! * a + tx[k]! * b - dir[k]! * depth * 0.5,
        ) as [number, number, number]
        if (this.viewer.segmentHits(from, dir, depth, filter)) return true
      }
    }
    return false
  }

  gpuInfo(): string {
    return this.viewer.gpuInfo()
  }

  /** Rasterizes changed layers and returns the visible ones, bottom first. */
  private async prepareLayers(design: Design): Promise<BakeLayer[]> {
    const frame = this.displayFrame()
    if (!frame) return []
    const live = new Set(design.layers.map((l) => l.id))
    for (const [id, v] of this.vinyls) {
      if (!live.has(id)) {
        v.texture.dispose()
        this.vinyls.delete(id)
      }
    }
    const out: BakeLayer[] = []
    for (const layer of design.layers) {
      if (!layer.visible || layer.opacity <= 0) continue
      const texture = await this.vinylTexture(layer, design).catch((err) => {
        console.error(err)
        return null
      })
      if (!texture) continue
      out.push({ texture, projectors: projectors(frame, layer.placement), opacity: layer.opacity })
    }
    return out
  }

  private async vinylTexture(layer: Layer, design: Design): Promise<THREE.Texture> {
    const key = rasterKey(layer, design.assets)
    const cached = this.vinyls.get(layer.id)
    if (cached?.key === key) return cached.texture
    const canvas = await rasterize(layer, design.assets)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.NoColorSpace
    texture.anisotropy = 8
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
    cached?.texture.dispose()
    this.vinyls.set(layer.id, { key, texture })
    return texture
  }

  /** Topmost unlocked-or-not layer whose projector contains the point. */
  layerAt(point: [number, number, number], design: Design): string | null {
    const frame = this.displayFrame()
    if (!frame) return null
    for (let i = design.layers.length - 1; i >= 0; i--) {
      const layer = design.layers[i]!
      if (!layer.visible) continue
      if (projectors(frame, layer.placement).some((p) => hitsProjector(p, point))) return layer.id
    }
    return null
  }

  /** New placement projected at a hit point, as seen from the camera. */
  placeAtHit(placement: Placement, hit: RayHit): Placement | null {
    const frame = this.displayFrame()
    return frame ? placeAt(frame, placement, hit.point, hit.direction) : null
  }

  centerHit(): RayHit | null {
    return this.viewer.raycastCenter()
  }

  showOutline(layer: Layer | null): void {
    const frame = this.displayFrame()
    if (!layer || !frame) {
      this.viewer.setOutline(null)
      return
    }
    const rects = projectors(frame, layer.placement).map((p, i) => {
      const s2 = p.axisS[0] ** 2 + p.axisS[1] ** 2 + p.axisS[2] ** 2
      const t2 = p.axisT[0] ** 2 + p.axisT[1] ** 2 + p.axisT[2] ** 2
      const sx = p.axisS.map((v) => v / s2) as [number, number, number]
      const tx = p.axisT.map((v) => v / t2) as [number, number, number]
      const corner = (a: number, b: number): [number, number, number] => [
        p.origin[0] + sx[0] * a + tx[0] * b,
        p.origin[1] + sx[1] * a + tx[1] * b,
        p.origin[2] + sx[2] * a + tx[2] * b,
      ]
      return {
        corners: [corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5)],
        dashed: i > 0,
      }
    })
    this.viewer.setOutline(rects)
  }

  setInteraction(handler: InteractionHandler | null): void {
    this.viewer.interaction = handler
  }

  /** Baked textures plus the untouched textures of the base skin to copy along. */
  exportPayload(): {
    textures: ExportTexture[]
    copyFiles?: { fromSkin: string; files: string[] }
  } {
    if (!this.liveryActive || !this.analysis) return { textures: [] }
    const textures: ExportTexture[] = this.painted.map((name) => ({
      name,
      ...this.baker.readPixels(name.toLowerCase()),
    }))
    // blanked textures are written as tiny fully transparent files
    for (const name of this.cleared) {
      textures.push({ name, width: 4, height: 4, rgba: new Uint8Array(4 * 4 * 4) })
    }
    const skin = this.baseSkin ? this.car?.skins.find((s) => s.id === this.baseSkin) : undefined
    if (!skin) return { textures }
    const written = new Set(textures.map((t) => t.name.toLowerCase()))
    const files = this.analysis.paintable
      .filter((n) => !written.has(n.toLowerCase()))
      .map((n) => findFile(skin.files, n))
      .filter((f): f is string => !!f)
    return { textures, copyFiles: files.length ? { fromSkin: skin.id, files } : undefined }
  }

  /** Preview size matching the stock preview.jpg of the car, if any. */
  async previewSize(): Promise<{ width: number; height: number }> {
    return (await this.stockImageSize('preview.jpg')) ?? { width: 1022, height: 575 }
  }

  async liveryIconSize(): Promise<{ width: number; height: number }> {
    return (await this.stockImageSize('livery.png')) ?? { width: 64, height: 64 }
  }

  private async stockImageSize(
    fileName: string,
  ): Promise<{ width: number; height: number } | null> {
    if (!this.car) return null
    const skin = this.car.skins.find((s) => !s.ours && findFile(s.files, fileName))
    if (!skin) return null
    try {
      const bytes = new Uint8Array(
        await this.backend.readFile(
          `${skinDir(this.car.id, skin.id)}/${findFile(skin.files, fileName)}`,
        ),
      )
      const size = await textureSize(bytes)
      return size.width > 0 && size.height > 0 && size.width <= 4096 ? size : null
    } catch {
      return null
    }
  }

  capturePreview(width: number, height: number): Uint8Array {
    return this.viewer.capturePreview(width, height)
  }

  setView(view: ViewMode): void {
    this.viewer.setView(view)
  }

  set onPick(handler: ((meshIndex: number | null) => void) | null) {
    this.viewer.onPick = handler
  }

  highlightMesh(meshIndex: number | null): void {
    this.viewer.highlightMesh(meshIndex)
  }

  setShowHidden(show: boolean): void {
    this.viewer.setShowHidden(show)
  }

  /** Tints every material that samples one of the given textures. */
  highlightTextures(names: string[] | null): void {
    const car = this.viewer.loadedCar
    const keys = new Set((names ?? []).map((n) => n.toLowerCase()))
    if (!car || keys.size === 0) {
      this.viewer.highlightMaterials(null)
      return
    }
    const ids = new Set<number>()
    car.materials.forEach((m, i) => {
      if (m.textures.some((t) => t.name === 'txDiffuse' && keys.has(t.texture.toLowerCase())))
        ids.add(i)
    })
    this.viewer.highlightMaterials(ids)
  }

  dispose(): void {
    for (const v of this.vinyls.values()) v.texture.dispose()
    this.vinyls.clear()
    this.generation++
    this.disposeCarResources()
    this.baker.dispose()
    this.viewer.dispose()
  }
}

function resampleNearest(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8Array {
  const out = new Uint8Array(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh))
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw))
      out.set(src.subarray((sy * sw + sx) * 4, (sy * sw + sx) * 4 + 4), (y * dw + x) * 4)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Image encoding helpers (renderer side)

export async function encodeImage(
  rgba: Uint8Array,
  width: number,
  height: number,
  type: 'image/jpeg' | 'image/png',
  quality = 0.92,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  const blob = await canvas.convertToBlob({ type, quality })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Small livery icon in the style of the stock livery.png files. */
export async function renderLiveryIcon(
  width: number,
  height: number,
  color: string,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const r = Math.min(width, height) * 0.18
  ctx.beginPath()
  ctx.roundRect(1, 1, width - 2, height - 2, r)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 32))
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.stroke()
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

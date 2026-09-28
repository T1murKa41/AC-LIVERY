// Glue between the 3D engine and the app: loads a car into the viewer, applies
// stock skins, resolves the AO source, bakes the livery and prepares exports.
// One instance lives as long as the viewport canvas.

import * as THREE from 'three'
import { carDir, skinDir, type Backend, type CarDetails, type ExportTexture } from '@shared/api'
import type { CarAnalysis } from '@shared/car/analysis'
import { canDecodeOnCpu, decodeDdsMip, isDds, parseDds } from '@shared/formats/dds'
import { aoSourceScore } from '@shared/image/ao'
import { LiveryBaker, readTexture, uvCoverage, type BakeMesh } from './baker'
import { extractAoInWorker } from './aoWorker'
import { parseCarInWorker } from './loadCar'
import { loadTextureFromBytes, textureSize, type TextureInfo } from './textures'
import { Viewer, type ViewMode } from './viewer'

/** 'auto' | 'none' | 'model' | 'skin:<id>' */
export type AoSource = string

export interface BakeParams {
  baseColor: string
  aoSource: AoSource
  aoStrength: number
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
  private autoAoPick: AoSource | null = null
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
    this.autoAoPick = null
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

  private bakeMeshes(): BakeMesh[] {
    const body = this.analysis?.bodyTexture?.toLowerCase()
    const car = this.viewer.loadedCar
    if (!body || !car) return []
    return this.viewer.carMeshes
      .filter(({ source }) => {
        const mat = car.materials[source.materialId]
        const diffuse = mat?.textures.find((t) => t.name === 'txDiffuse')?.texture
        return diffuse?.toLowerCase() === body
      })
      .map(({ mesh, source }) => ({
        geometry: mesh.geometry,
        world: new THREE.Matrix4().fromArray(source.world),
      }))
  }

  /** Candidate AO sources: the model texture plus every skin that overrides the body texture. */
  aoCandidates(): AoSource[] {
    const body = this.analysis?.bodyTexture
    if (!body || !this.car) return []
    const skins = this.car.skins
      .filter((s) => !s.ours && findFile(s.files, body))
      .map((s) => `skin:${s.id}`)
    return ['model', ...skins]
  }

  private async sourceTexture(source: AoSource): Promise<TextureInfo | null> {
    const body = this.analysis?.bodyTexture
    if (!body) return null
    if (source === 'model') return this.viewer.modelTexture(body) ?? null
    if (source.startsWith('skin:')) return this.skinTexture(source.slice(5), body)
    return null
  }

  /**
   * Small RGBA preview of a candidate for scoring. DDS files are decoded on the
   * CPU from a small mip level, so dozens of stock skins can be compared
   * without uploading their full textures to the GPU.
   */
  private async candidatePreview(source: AoSource, size: number): Promise<Uint8Array | null> {
    const body = this.analysis?.bodyTexture
    if (!body || !this.car) return null
    let bytes: Uint8Array | null = null
    if (source === 'model') {
      bytes =
        this.viewer.loadedCar?.textures.find((t) => t.name.toLowerCase() === body.toLowerCase())
          ?.data ?? null
    } else if (source.startsWith('skin:')) {
      const skin = this.car.skins.find((s) => s.id === source.slice(5))
      const file = skin && findFile(skin.files, body)
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
    const info = await this.sourceTexture(source).catch(() => null)
    return info ? readTexture(this.viewer.renderer, info.texture, size, size) : null
  }

  private async pickCleanest(): Promise<AoSource> {
    if (this.autoAoPick) return this.autoAoPick
    const size = 64
    const mask = uvCoverage(this.viewer.renderer, this.bakeMeshes(), size, size)
    let best: AoSource = 'model'
    let bestScore = -Infinity
    for (const candidate of this.aoCandidates()) {
      const rgba = await this.candidatePreview(candidate, size).catch(() => null)
      if (!rgba) continue
      const score = aoSourceScore(rgba, mask)
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
    this.autoAoPick = best
    return best
  }

  async resolveAo(source: AoSource): Promise<AoResolution> {
    if (source === 'none' || !this.analysis?.bodyTexture) return { used: 'none', texture: null }
    const used = source === 'auto' ? await this.pickCleanest() : source
    if (this.aoCache.has(used)) return { used, texture: this.aoCache.get(used) ?? null }
    const info = await this.sourceTexture(used)
    if (!info) return { used: 'none', texture: null }
    const { width, height } = this.liveryTextureSize(info)
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
    this.aoCache.set(used, tex)
    return { used, texture: tex }
  }

  /** Output resolution: the stock texture size, capped at 8K. */
  private liveryTextureSize(info?: TextureInfo | null): { width: number; height: number } {
    const body = this.analysis?.bodyTexture
    const model = body ? this.viewer.modelTexture(body) : undefined
    const src = info ?? model
    const width = Math.min(8192, Math.max(64, src?.width ?? 2048))
    const height = Math.min(8192, Math.max(64, src?.height ?? 2048))
    return { width, height }
  }

  async bakeLivery(params: BakeParams, ao: AoResolution): Promise<void> {
    const body = this.analysis?.bodyTexture
    if (!body) return
    const aoInfo = ao.used === 'none' ? null : await this.sourceTexture(ao.used)
    const size = this.liveryTextureSize(aoInfo)
    const texture = this.baker.bake(this.bakeMeshes(), {
      ...size,
      baseColor: hexToRgb(params.baseColor),
      ao: ao.texture,
      aoStrength: params.aoStrength,
      alphaSource: this.viewer.modelTexture(body)?.texture ?? null,
    })
    this.liveryActive = true
    this.viewer.clearOverrides()
    this.viewer.setOverride(body, texture)
  }

  exportTextures(): ExportTexture[] {
    const body = this.analysis?.bodyTexture
    if (!body || !this.liveryActive) return []
    const { width, height, rgba } = this.baker.readPixels()
    return [{ name: body, width, height, rgba }]
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

  highlightLivery(on: boolean): void {
    const body = this.analysis?.bodyTexture?.toLowerCase()
    const car = this.viewer.loadedCar
    if (!on || !body || !car) {
      this.viewer.highlightMaterials(null)
      return
    }
    const ids = new Set<number>()
    car.materials.forEach((m, i) => {
      if (m.textures.some((t) => t.name === 'txDiffuse' && t.texture.toLowerCase() === body))
        ids.add(i)
    })
    this.viewer.highlightMaterials(ids)
  }

  dispose(): void {
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

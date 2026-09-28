// Structural analysis of a car model: orientation, paintable textures,
// which meshes carry the livery and whether the sides share UV space.

import {
  getTextureMapping,
  transformDirection,
  transformPoint,
  walkKn5,
  type Kn5File,
  type Kn5MeshNode,
  type Kn5SkinnedMeshNode,
} from '../formats/kn5'

export type V3 = [number, number, number]

export type MeshCategory = 'body' | 'glass' | 'rim' | 'caliper' | 'tyre' | 'other'

export interface MeshInfo {
  /** Index in depth-first order over mesh nodes; stable id within one model. */
  index: number
  name: string
  materialId: number
  materialName: string
  shader: string
  diffuse?: string
  maps?: string
  /** World-space surface area in m². */
  area: number
  triangles: number
  category: MeshCategory
  /** Inside a WHEEL_* subtree. */
  wheel: boolean
  world: Float32Array
}

/**
 * Orthonormal frame attached to the car body. `left` points to the driver's
 * left as defined by the WHEEL_L* / WHEEL_R* dummies, `forward` to the nose.
 */
export interface CarFrame {
  origin: V3
  forward: V3
  left: V3
  up: V3
  /** Body extents along the frame axes, in metres. */
  length: number
  width: number
  height: number
  /**
   * The model is stored mirrored relative to a right-handed Y-up system
   * (left x up != forward); the viewer mirrors it back for display.
   */
  mirrored: boolean
  source: 'wheels' | 'bounds'
}

export interface TextureUsage {
  name: string
  /** Total area of meshes sampling this texture as txDiffuse. */
  area: number
  meshes: number[]
  paintable: boolean
}

export type CarWarningCode = 'no-wheels' | 'no-body-texture' | 'no-skins' | 'shared-side-uv'

export interface CarAnalysis {
  frame: CarFrame
  meshes: MeshInfo[]
  diffuseUsage: TextureUsage[]
  paintable: string[]
  bodyTexture: string | null
  bodyMapsTexture: string | null
  bodyMeshes: number[]
  /** Share of UV texels used by both sides of the car (0..1), null if unknown. */
  sideUvOverlap: number | null
  /** Triangle winding disagrees with vertex normals (flip for rendering). */
  flipWinding: boolean
  warnings: CarWarningCode[]
}

const WHEEL_RE = /^WHEEL_(LF|RF|LR|RR)$/i

export function categorize(meshName: string, materialName: string, wheel: boolean): MeshCategory {
  const s = `${meshName} ${materialName}`
  if (/glass|window|windscreen|windshield|wind_screen/i.test(s)) return 'glass'
  if (/caliper/i.test(s)) return 'caliper'
  if (/tyre|tire/i.test(s)) return 'tyre'
  if (/(^|[^a-z])rims?([^a-z]|$)/i.test(s)) return 'rim'
  if (wheel) return 'other'
  return 'body'
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
function scale(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k]
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function normalize(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2])
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

type GeometryNode = Kn5MeshNode | Kn5SkinnedMeshNode

interface CollectedMesh {
  info: MeshInfo
  node: GeometryNode
}

function collectMeshes(kn5: Kn5File): {
  meshes: CollectedMesh[]
  wheels: Partial<Record<'LF' | 'RF' | 'LR' | 'RR', V3>>
} {
  const meshes: CollectedMesh[] = []
  const wheels: Partial<Record<'LF' | 'RF' | 'LR' | 'RR', V3>> = {}
  const wheelNodes = new Set<Kn5File['root']>()

  walkKn5(kn5.root, (node, world, parent) => {
    const inWheel = parent !== null && wheelNodes.has(parent)
    if (node.kind === 'base') {
      const m = WHEEL_RE.exec(node.name)
      if (m) wheels[m[1]!.toUpperCase() as 'LF'] = transformPoint(world, 0, 0, 0)
      if (m || inWheel) wheelNodes.add(node)
      return
    }
    const material = kn5.materials[node.materialId]
    const materialName = material?.name ?? `#${node.materialId}`
    meshes.push({
      node,
      info: {
        index: meshes.length,
        name: node.name,
        materialId: node.materialId,
        materialName,
        shader: material?.shader ?? '',
        diffuse: material ? getTextureMapping(material, 'txDiffuse') : undefined,
        maps: material ? getTextureMapping(material, 'txMaps') : undefined,
        area: meshArea(node, world),
        triangles: node.indices.length / 3,
        category: categorize(node.name, materialName, inWheel),
        wheel: inWheel,
        world,
      },
    })
  })
  return { meshes, wheels }
}

function meshArea(node: GeometryNode, world: Float32Array): number {
  const p = node.positions
  const idx = node.indices
  let area = 0
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = transformPoint(world, p[idx[i]! * 3]!, p[idx[i]! * 3 + 1]!, p[idx[i]! * 3 + 2]!)
    const b = transformPoint(world, p[idx[i + 1]! * 3]!, p[idx[i + 1]! * 3 + 1]!, p[idx[i + 1]! * 3 + 2]!)
    const c = transformPoint(world, p[idx[i + 2]! * 3]!, p[idx[i + 2]! * 3 + 1]!, p[idx[i + 2]! * 3 + 2]!)
    const n = cross(sub(b, a), sub(c, a))
    area += Math.hypot(n[0], n[1], n[2]) / 2
  }
  return area
}

/** Area-weighted agreement between geometric and vertex normals. Negative = flipped winding. */
function windingScore(node: GeometryNode): number {
  const p = node.positions
  const n = node.normals
  const idx = node.indices
  let score = 0
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const ia = idx[i]! * 3
    const ib = idx[i + 1]! * 3
    const ic = idx[i + 2]! * 3
    const a: V3 = [p[ia]!, p[ia + 1]!, p[ia + 2]!]
    const g = cross(sub([p[ib]!, p[ib + 1]!, p[ib + 2]!], a), sub([p[ic]!, p[ic + 1]!, p[ic + 2]!], a))
    const vn: V3 = [
      n[ia]! + n[ib]! + n[ic]!,
      n[ia + 1]! + n[ib + 1]! + n[ic + 1]!,
      n[ia + 2]! + n[ib + 2]! + n[ic + 2]!,
    ]
    score += dot(g, vn)
  }
  return score
}

function computeFrame(
  wheels: Partial<Record<'LF' | 'RF' | 'LR' | 'RR', V3>>,
  bodyMeshes: CollectedMesh[],
): CarFrame {
  const up: V3 = [0, 1, 0]
  let forward: V3
  let left: V3
  let source: CarFrame['source']
  let mirrored = false

  // world-space bounds of the body, used for the origin and the fallback axes
  const min: V3 = [Infinity, Infinity, Infinity]
  const max: V3 = [-Infinity, -Infinity, -Infinity]
  for (const { node, info } of bodyMeshes) {
    const p = node.positions
    for (let i = 0; i < p.length; i += 3) {
      const w = transformPoint(info.world, p[i]!, p[i + 1]!, p[i + 2]!)
      for (let k = 0; k < 3; k++) {
        if (w[k]! < min[k]!) min[k] = w[k]!
        if (w[k]! > max[k]!) max[k] = w[k]!
      }
    }
  }
  if (!Number.isFinite(min[0])) {
    min.fill(-1)
    max.fill(1)
  }

  const { LF, RF, LR, RR } = wheels
  if (LF && RF && LR && RR) {
    const f = sub(scale(add(LF, RF), 0.5), scale(add(LR, RR), 0.5))
    const l = sub(scale(add(LF, LR), 0.5), scale(add(RF, RR), 0.5))
    forward = normalize([f[0], 0, f[2]])
    const rhLeft = cross(up, forward)
    mirrored = dot(l, rhLeft) < 0
    left = mirrored ? scale(rhLeft, -1) : rhLeft
    source = 'wheels'
  } else {
    const ext = sub(max, min)
    forward = ext[2] >= ext[0] ? [0, 0, 1] : [1, 0, 0]
    left = cross(up, forward)
    source = 'bounds'
  }

  // extents along the frame axes
  let fMin = Infinity
  let fMax = -Infinity
  let lMin = Infinity
  let lMax = -Infinity
  let uMin = Infinity
  let uMax = -Infinity
  for (const { node, info } of bodyMeshes) {
    const p = node.positions
    for (let i = 0; i < p.length; i += 3) {
      const w = transformPoint(info.world, p[i]!, p[i + 1]!, p[i + 2]!)
      const fv = dot(w, forward)
      const lv = dot(w, left)
      const uv = w[1]
      if (fv < fMin) fMin = fv
      if (fv > fMax) fMax = fv
      if (lv < lMin) lMin = lv
      if (lv > lMax) lMax = lv
      if (uv < uMin) uMin = uv
      if (uv > uMax) uMax = uv
    }
  }
  if (!Number.isFinite(fMin)) {
    fMin = lMin = uMin = -1
    fMax = lMax = uMax = 1
  }
  const origin = add(
    add(scale(forward, (fMin + fMax) / 2), scale(left, (lMin + lMax) / 2)),
    scale(up, (uMin + uMax) / 2),
  )
  return {
    origin,
    forward,
    left,
    up,
    length: fMax - fMin,
    width: lMax - lMin,
    height: uMax - uMin,
    mirrored,
    source,
  }
}

/**
 * Rasterizes the UV footprint of body triangles on the left and right sides
 * into a coarse grid and measures how much of it is shared.
 */
export function measureSideUvOverlap(
  meshes: { node: GeometryNode; world: Float32Array }[],
  frame: CarFrame,
  gridSize = 256,
): number | null {
  const leftMask = new Uint8Array(gridSize * gridSize)
  const rightMask = new Uint8Array(gridSize * gridSize)
  const centerBand = frame.width * 0.1
  for (const { node, world } of meshes) {
    const p = node.positions
    const uv = node.uvs
    const idx = node.indices
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const ids = [idx[i]!, idx[i + 1]!, idx[i + 2]!]
      let cx = 0
      let cy = 0
      let cz = 0
      for (const id of ids) {
        cx += p[id * 3]!
        cy += p[id * 3 + 1]!
        cz += p[id * 3 + 2]!
      }
      const c = transformPoint(world, cx / 3, cy / 3, cz / 3)
      const lateral = dot(sub(c, frame.origin), frame.left)
      if (Math.abs(lateral) < centerBand) continue
      // skip faces that are not facing sideways (roof, bonnet)
      const nrm = transformDirection(
        world,
        node.normals[ids[0]! * 3]! + node.normals[ids[1]! * 3]! + node.normals[ids[2]! * 3]!,
        node.normals[ids[0]! * 3 + 1]! + node.normals[ids[1]! * 3 + 1]! + node.normals[ids[2]! * 3 + 1]!,
        node.normals[ids[0]! * 3 + 2]! + node.normals[ids[1]! * 3 + 2]! + node.normals[ids[2]! * 3 + 2]!,
      )
      if (Math.abs(dot(normalize(nrm), frame.left)) < 0.5) continue
      rasterTriangle(
        lateral > 0 ? leftMask : rightMask,
        gridSize,
        ids.map((id) => [uv[id * 2]!, uv[id * 2 + 1]!] as [number, number]),
      )
    }
  }
  let l = 0
  let r = 0
  let both = 0
  for (let i = 0; i < leftMask.length; i++) {
    if (leftMask[i]) l++
    if (rightMask[i]) r++
    if (leftMask[i] && rightMask[i]) both++
  }
  const minSide = Math.min(l, r)
  if (minSide < gridSize) return null // too few side texels to judge
  return both / minSide
}

function rasterTriangle(mask: Uint8Array, size: number, uv: [number, number][]): void {
  const pts = uv.map(([u, v]) => [(u - Math.floor(u)) * size, (v - Math.floor(v)) * size])
  // triangles crossing a tile boundary are rare on car skins; skip them
  const span = (k: number) => Math.max(...uv.map((p) => p[k]!)) - Math.min(...uv.map((p) => p[k]!))
  if (span(0) > 1 || span(1) > 1) return
  const [a, b, c] = pts as [[number, number], [number, number], [number, number]]
  for (const p of pts) {
    const x = Math.min(size - 1, Math.max(0, Math.floor(p[0]!)))
    const y = Math.min(size - 1, Math.max(0, Math.floor(p[1]!)))
    mask[y * size + x] = 1
  }
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])))
  const x1 = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])))
  const y1 = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (Math.abs(area) < 1e-9) return
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area
      const w2 = 1 - w0 - w1
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) mask[y * size + x] = 1
    }
  }
}

export interface AnalyzeOptions {
  /** File names found in any skins/<skin>/ folder of the car. */
  skinFileNames: string[]
}

export function analyzeCar(kn5: Kn5File, options: AnalyzeOptions): CarAnalysis {
  const { meshes, wheels } = collectMeshes(kn5)
  const warnings: CarWarningCode[] = []
  const skinFiles = new Set(options.skinFileNames.map((n) => n.toLowerCase()))
  const paintable = kn5.textures.map((t) => t.name).filter((n) => skinFiles.has(n.toLowerCase()))
  if (skinFiles.size === 0) warnings.push('no-skins')

  const usage = new Map<string, TextureUsage>()
  for (const { info } of meshes) {
    if (!info.diffuse) continue
    const key = info.diffuse
    const u = usage.get(key) ?? {
      name: key,
      area: 0,
      meshes: [],
      paintable: skinFiles.has(key.toLowerCase()),
    }
    u.area += info.area
    u.meshes.push(info.index)
    usage.set(key, u)
  }
  const diffuseUsage = [...usage.values()].sort((a, b) => b.area - a.area)

  // The livery texture: the paintable diffuse covering most of the non-glass, non-wheel surface.
  const bodyArea = (u: TextureUsage) =>
    u.meshes.reduce((s, i) => {
      const m = meshes[i]!.info
      return s + (m.category === 'body' ? m.area : 0)
    }, 0)
  const candidates = diffuseUsage.filter((u) => u.paintable && bodyArea(u) > 0)
  let body = candidates.sort((a, b) => bodyArea(b) - bodyArea(a))[0] ?? null
  if (!body) {
    body = diffuseUsage.filter((u) => bodyArea(u) > 0).sort((a, b) => bodyArea(b) - bodyArea(a))[0] ?? null
  }
  if (!body) warnings.push('no-body-texture')

  const bodyMeshes = body ? body.meshes.filter((i) => !meshes[i]!.info.wheel) : []
  const bodyCollected = bodyMeshes.map((i) => meshes[i]!)

  const mapsArea = new Map<string, number>()
  for (const { info } of bodyCollected) {
    if (info.maps) mapsArea.set(info.maps, (mapsArea.get(info.maps) ?? 0) + info.area)
  }
  const bodyMapsTexture = [...mapsArea.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const frameMeshes = bodyCollected.length
    ? bodyCollected
    : meshes.filter((m) => m.info.category === 'body' && !m.info.wheel)
  const frame = computeFrame(wheels, frameMeshes)
  if (frame.source !== 'wheels') warnings.push('no-wheels')

  const sideUvOverlap = bodyCollected.length
    ? measureSideUvOverlap(
        bodyCollected.map((m) => ({ node: m.node, world: m.info.world })),
        frame,
      )
    : null
  if (sideUvOverlap !== null && sideUvOverlap > 0.25) warnings.push('shared-side-uv')

  const winding = meshes.reduce((s, m) => s + Math.sign(windingScore(m.node)) * m.info.area, 0)

  return {
    frame,
    meshes: meshes.map((m) => m.info),
    diffuseUsage,
    paintable,
    bodyTexture: body?.name ?? null,
    bodyMapsTexture,
    bodyMeshes,
    sideUvOverlap,
    flipWinding: winding < 0,
    warnings,
  }
}

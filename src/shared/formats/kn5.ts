// Reader and writer for Kunos .kn5 model files (Assetto Corsa).
//
// Layout (little-endian):
//   "sc6969", i32 version, [i32 extra if version > 5]
//   i32 textureCount, textures: i32 active, string name, u32 size, bytes
//   i32 materialCount, materials (see readMaterial)
//   node hierarchy, depth-first (see readNode)
// Strings are u32-length-prefixed. Matrices are 16 floats, row-major with the
// translation in elements 12..14, which is the same memory layout three.js
// expects in Matrix4.fromArray().

import { BinaryReader, BinaryWriter, FormatError } from './binary'

export const KN5_MAGIC = 'sc6969'

export interface Kn5Texture {
  name: string
  active: number
  data: Uint8Array
}

export interface Kn5ShaderProperty {
  name: string
  a: number
  b: [number, number]
  c: [number, number, number]
  d: [number, number, number, number]
}

export interface Kn5TextureMapping {
  /** Sampler name in the shader, e.g. txDiffuse, txNormal, txMaps. */
  name: string
  slot: number
  texture: string
}

export interface Kn5Material {
  name: string
  shader: string
  blendMode: number
  alphaTested: boolean
  depthMode: number
  properties: Kn5ShaderProperty[]
  textures: Kn5TextureMapping[]
}

interface Kn5NodeCommon {
  name: string
  active: boolean
  children: Kn5Node[]
}

export interface Kn5BaseNode extends Kn5NodeCommon {
  kind: 'base'
  transform: Float32Array
}

export interface Kn5Geometry {
  /** xyz per vertex */
  positions: Float32Array
  /** xyz per vertex */
  normals: Float32Array
  /** uv per vertex, DirectX convention (v = 0 is the top row of the image) */
  uvs: Float32Array
  /** xyz per vertex */
  tangents: Float32Array
  indices: Uint16Array
}

export interface Kn5MeshNode extends Kn5NodeCommon, Kn5Geometry {
  kind: 'mesh'
  castShadows: boolean
  visible: boolean
  transparent: boolean
  materialId: number
  layer: number
  lodIn: number
  lodOut: number
  boundingSphere: { center: [number, number, number]; radius: number }
  renderable: boolean
}

export interface Kn5Bone {
  name: string
  transform: Float32Array
}

export interface Kn5SkinnedMeshNode extends Kn5NodeCommon, Kn5Geometry {
  kind: 'skinned'
  castShadows: boolean
  visible: boolean
  transparent: boolean
  bones: Kn5Bone[]
  /** 4 weights per vertex */
  weights: Float32Array
  /** 4 bone indices per vertex (stored as floats in the file) */
  boneIndices: Float32Array
  materialId: number
  layer: number
}

export type Kn5Node = Kn5BaseNode | Kn5MeshNode | Kn5SkinnedMeshNode

export interface Kn5File {
  version: number
  extra: number
  textures: Kn5Texture[]
  materials: Kn5Material[]
  root: Kn5Node
}

export interface Kn5ParseOptions {
  /** Skip texture payloads (keeps names and sizes only, data is empty). */
  skipTextureData?: boolean
}

const NODE_BASE = 1
const NODE_MESH = 2
const NODE_SKINNED = 3

const MAX_COUNT = 10_000_000

function count(r: BinaryReader, what: string): number {
  const n = r.i32()
  if (n < 0 || n > MAX_COUNT) {
    throw new FormatError(`Invalid ${what} count ${n} at offset ${r.pos - 4}`)
  }
  return n
}

/** True if the bytes start with the kn5 magic. Encrypted models usually fail this check. */
export function isKn5(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 6) return false
  return String.fromCharCode(...bytes.subarray(0, 6)) === KN5_MAGIC
}

export function parseKn5(bytes: Uint8Array, options: Kn5ParseOptions = {}): Kn5File {
  const r = new BinaryReader(bytes)
  const magic = r.ascii(6)
  if (magic !== KN5_MAGIC) {
    throw new FormatError('Not a kn5 file (bad magic). The model may be encrypted.')
  }
  const version = r.i32()
  if (version < 1 || version > 6) throw new FormatError(`Unsupported kn5 version ${version}`)
  const extra = version > 5 ? r.i32() : 0

  const textures: Kn5Texture[] = []
  const textureCount = count(r, 'texture')
  for (let i = 0; i < textureCount; i++) {
    const active = r.i32()
    const name = r.string()
    const size = r.u32()
    const data = options.skipTextureData ? (r.bytesView(size), new Uint8Array(0)) : r.bytesView(size)
    textures.push({ name, active, data })
  }

  const materials: Kn5Material[] = []
  const materialCount = count(r, 'material')
  for (let i = 0; i < materialCount; i++) materials.push(readMaterial(r, version))

  const root = readNode(r, 0)
  return { version, extra, textures, materials, root }
}

function readMaterial(r: BinaryReader, version: number): Kn5Material {
  const name = r.string()
  const shader = r.string()
  const blendMode = r.u8()
  const alphaTested = r.bool()
  const depthMode = version > 4 ? r.i32() : 0
  const properties: Kn5ShaderProperty[] = []
  const propertyCount = count(r, 'shader property')
  for (let i = 0; i < propertyCount; i++) {
    properties.push({
      name: r.string(),
      a: r.f32(),
      b: [r.f32(), r.f32()],
      c: [r.f32(), r.f32(), r.f32()],
      d: [r.f32(), r.f32(), r.f32(), r.f32()],
    })
  }
  const textures: Kn5TextureMapping[] = []
  const mappingCount = count(r, 'texture mapping')
  for (let i = 0; i < mappingCount; i++) {
    textures.push({ name: r.string(), slot: r.u32(), texture: r.string() })
  }
  return { name, shader, blendMode, alphaTested, depthMode, properties, textures }
}

function readVertices(
  r: BinaryReader,
  n: number,
  skinned: boolean,
): Kn5Geometry & { weights?: Float32Array; boneIndices?: Float32Array } {
  const positions = new Float32Array(n * 3)
  const normals = new Float32Array(n * 3)
  const uvs = new Float32Array(n * 2)
  const tangents = new Float32Array(n * 3)
  const weights = skinned ? new Float32Array(n * 4) : undefined
  const boneIndices = skinned ? new Float32Array(n * 4) : undefined
  for (let i = 0; i < n; i++) {
    positions[i * 3] = r.f32()
    positions[i * 3 + 1] = r.f32()
    positions[i * 3 + 2] = r.f32()
    normals[i * 3] = r.f32()
    normals[i * 3 + 1] = r.f32()
    normals[i * 3 + 2] = r.f32()
    uvs[i * 2] = r.f32()
    uvs[i * 2 + 1] = r.f32()
    tangents[i * 3] = r.f32()
    tangents[i * 3 + 1] = r.f32()
    tangents[i * 3 + 2] = r.f32()
    if (weights && boneIndices) {
      for (let k = 0; k < 4; k++) weights[i * 4 + k] = r.f32()
      for (let k = 0; k < 4; k++) boneIndices[i * 4 + k] = r.f32()
    }
  }
  return { positions, normals, uvs, tangents, indices: new Uint16Array(0), weights, boneIndices }
}

function readIndices(r: BinaryReader, vertexCount: number): Uint16Array {
  const n = count(r, 'index')
  const indices = r.u16Array(n)
  for (let i = 0; i < n; i++) {
    if (indices[i]! >= vertexCount) {
      throw new FormatError(`Index ${indices[i]} out of range (${vertexCount} vertices)`)
    }
  }
  return indices
}

function readNode(r: BinaryReader, depth: number): Kn5Node {
  if (depth > 256) throw new FormatError('Node hierarchy is too deep')
  const nodeClass = r.i32()
  const name = r.string()
  const childCount = count(r, 'child')
  const active = r.bool()
  let node: Kn5Node

  switch (nodeClass) {
    case NODE_BASE:
      node = { kind: 'base', name, active, children: [], transform: r.f32Array(16) }
      break
    case NODE_MESH: {
      const castShadows = r.bool()
      const visible = r.bool()
      const transparent = r.bool()
      const vertexCount = count(r, 'vertex')
      const geo = readVertices(r, vertexCount, false)
      geo.indices = readIndices(r, vertexCount)
      node = {
        kind: 'mesh',
        name,
        active,
        children: [],
        castShadows,
        visible,
        transparent,
        positions: geo.positions,
        normals: geo.normals,
        uvs: geo.uvs,
        tangents: geo.tangents,
        indices: geo.indices,
        materialId: r.u32(),
        layer: r.u32(),
        lodIn: r.f32(),
        lodOut: r.f32(),
        boundingSphere: { center: [r.f32(), r.f32(), r.f32()], radius: r.f32() },
        renderable: r.bool(),
      }
      break
    }
    case NODE_SKINNED: {
      const castShadows = r.bool()
      const visible = r.bool()
      const transparent = r.bool()
      const bones: Kn5Bone[] = []
      const boneCount = count(r, 'bone')
      for (let i = 0; i < boneCount; i++) bones.push({ name: r.string(), transform: r.f32Array(16) })
      const vertexCount = count(r, 'vertex')
      const geo = readVertices(r, vertexCount, true)
      geo.indices = readIndices(r, vertexCount)
      const materialId = r.u32()
      const layer = r.u32()
      r.bytesView(8) // lodIn/lodOut, unused for skinned meshes
      node = {
        kind: 'skinned',
        name,
        active,
        children: [],
        castShadows,
        visible,
        transparent,
        bones,
        positions: geo.positions,
        normals: geo.normals,
        uvs: geo.uvs,
        tangents: geo.tangents,
        indices: geo.indices,
        weights: geo.weights!,
        boneIndices: geo.boneIndices!,
        materialId,
        layer,
      }
      break
    }
    default:
      throw new FormatError(`Unknown node class ${nodeClass} for node "${name}" at offset ${r.pos}`)
  }

  for (let i = 0; i < childCount; i++) node.children.push(readNode(r, depth + 1))
  return node
}

// ---------------------------------------------------------------------------
// Writer. Used for synthetic test fixtures and the browser mock backend.

export function writeKn5(file: Kn5File): Uint8Array {
  const w = new BinaryWriter(1 << 16)
  w.ascii(KN5_MAGIC).i32(file.version)
  if (file.version > 5) w.i32(file.extra)

  w.i32(file.textures.length)
  for (const t of file.textures) {
    w.i32(t.active).string(t.name).u32(t.data.byteLength).bytes(t.data)
  }

  w.i32(file.materials.length)
  for (const m of file.materials) {
    w.string(m.name).string(m.shader).u8(m.blendMode).bool(m.alphaTested)
    if (file.version > 4) w.i32(m.depthMode)
    w.i32(m.properties.length)
    for (const p of m.properties) w.string(p.name).f32(p.a).f32s(p.b).f32s(p.c).f32s(p.d)
    w.i32(m.textures.length)
    for (const t of m.textures) w.string(t.name).u32(t.slot).string(t.texture)
  }

  writeNode(w, file.root)
  return w.toBytes()
}

function writeVertices(w: BinaryWriter, g: Kn5Geometry, skin?: Kn5SkinnedMeshNode): void {
  const n = g.positions.length / 3
  w.i32(n)
  for (let i = 0; i < n; i++) {
    w.f32s(g.positions.subarray(i * 3, i * 3 + 3))
    w.f32s(g.normals.subarray(i * 3, i * 3 + 3))
    w.f32s(g.uvs.subarray(i * 2, i * 2 + 2))
    w.f32s(g.tangents.subarray(i * 3, i * 3 + 3))
    if (skin) {
      w.f32s(skin.weights.subarray(i * 4, i * 4 + 4))
      w.f32s(skin.boneIndices.subarray(i * 4, i * 4 + 4))
    }
  }
  w.i32(g.indices.length)
  for (const idx of g.indices) w.u16(idx)
}

function writeNode(w: BinaryWriter, node: Kn5Node): void {
  const cls = node.kind === 'base' ? NODE_BASE : node.kind === 'mesh' ? NODE_MESH : NODE_SKINNED
  w.i32(cls).string(node.name).i32(node.children.length).bool(node.active)
  if (node.kind === 'base') {
    w.f32s(node.transform)
  } else if (node.kind === 'mesh') {
    w.bool(node.castShadows).bool(node.visible).bool(node.transparent)
    writeVertices(w, node)
    w.u32(node.materialId).u32(node.layer).f32(node.lodIn).f32(node.lodOut)
    w.f32s(node.boundingSphere.center).f32(node.boundingSphere.radius)
    w.bool(node.renderable)
  } else {
    w.bool(node.castShadows).bool(node.visible).bool(node.transparent)
    w.i32(node.bones.length)
    for (const b of node.bones) w.string(b.name).f32s(b.transform)
    writeVertices(w, node, node)
    w.u32(node.materialId).u32(node.layer).f32(0).f32(0)
  }
  for (const child of node.children) writeNode(w, child)
}

// ---------------------------------------------------------------------------
// Helpers

export function getProperty(material: Kn5Material, name: string): Kn5ShaderProperty | undefined {
  return material.properties.find((p) => p.name === name)
}

export function getTextureMapping(material: Kn5Material, sampler: string): string | undefined {
  return material.textures.find((t) => t.name === sampler)?.texture
}

/** Depth-first walk with the accumulated world matrix (row-major 4x4, row vectors). */
export function walkKn5(
  root: Kn5Node,
  visit: (node: Kn5Node, world: Float32Array, parent: Kn5Node | null) => void,
): void {
  const rec = (node: Kn5Node, parentWorld: Float32Array, parent: Kn5Node | null): void => {
    const world = node.kind === 'base' ? multiplyRowMajor(node.transform, parentWorld) : parentWorld
    visit(node, world, parent)
    for (const c of node.children) rec(c, world, node)
  }
  rec(root, IDENTITY, null)
}

export const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/** a * b for row-major matrices used with row vectors (v' = v * a * b). */
export function multiplyRowMajor(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[i * 4 + k]! * b[k * 4 + j]!
      out[i * 4 + j] = s
    }
  }
  return out
}

/** Transforms a point by a row-major matrix (row vector convention). */
export function transformPoint(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    x * m[0]! + y * m[4]! + z * m[8]! + m[12]!,
    x * m[1]! + y * m[5]! + z * m[9]! + m[13]!,
    x * m[2]! + y * m[6]! + z * m[10]! + m[14]!,
  ]
}

/** Transforms a direction (no translation). */
export function transformDirection(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    x * m[0]! + y * m[4]! + z * m[8]!,
    x * m[1]! + y * m[5]! + z * m[9]!,
    x * m[2]! + y * m[6]! + z * m[10]!,
  ]
}

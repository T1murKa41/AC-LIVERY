// Procedurally generated car used by unit tests and the browser mock backend.
// Real Kunos content cannot be committed to a public repository, so this is
// the only model that ships with the project. It mimics the structure of a
// real car: WHEEL_* dummies, a painted body using Skin_00.dds with a txMaps
// texture, rims and glass with their own materials, and a skins/ folder.

import { writeDds } from '../formats/dds'
import {
  IDENTITY,
  writeKn5,
  type Kn5Material,
  type Kn5MeshNode,
  type Kn5Node,
  type Kn5ShaderProperty,
} from '../formats/kn5'
import { serializeUiSkin } from '../formats/uiSkin'

export const SYNTHETIC_CAR_ID = 'aclivery_test_coupe'
export const BODY_TEXTURE = 'Skin_00.dds'
export const MAPS_TEXTURE = 'Skin_00_Maps.dds'

type V3 = [number, number, number]

interface MeshBuilder {
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
}

function newBuilder(): MeshBuilder {
  return { positions: [], normals: [], uvs: [], indices: [] }
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function normalize(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Adds a triangle with counter-clockwise winding as seen from the side `n` points to. */
function tri(m: MeshBuilder, p: [V3, V3, V3], uv: [number, number][], n: V3): void {
  const base = m.positions.length / 3
  for (let i = 0; i < 3; i++) {
    m.positions.push(...p[i]!)
    m.normals.push(...n)
    m.uvs.push(...uv[i]!)
  }
  const ccw = dot(cross(sub(p[1], p[0]), sub(p[2], p[0])), n) >= 0
  m.indices.push(base, ccw ? base + 1 : base + 2, ccw ? base + 2 : base + 1)
}

function quad(m: MeshBuilder, p: [V3, V3, V3, V3], uv: [number, number][], n: V3): void {
  tri(m, [p[0], p[1], p[2]], [uv[0]!, uv[1]!, uv[2]!], n)
  tri(m, [p[0], p[2], p[3]], [uv[0]!, uv[2]!, uv[3]!], n)
}

// Side profile of the body in the (z, y) plane, rear to front along the top.
const LENGTH = 4.5
const WIDTH = 1.9
const HALF_W = WIDTH / 2
const PROFILE: [number, number][] = [
  [-2.25, 0.25],
  [-2.25, 0.8],
  [-1.7, 0.95],
  [-1.0, 1.3],
  [0.6, 1.3],
  [1.3, 0.95],
  [2.25, 0.75],
  [2.25, 0.25],
]

function sideUv(z: number, y: number, right: boolean, sharedUv: boolean): [number, number] {
  const fz = (z + LENGTH / 2) / LENGTH
  const v = 0.02 + ((1.35 - y) / 1.2) * 0.33
  if (!right || sharedUv) return [0.02 + fz * 0.46, v]
  return [0.52 + (1 - fz) * 0.46, v]
}

function buildBody(sharedUv: boolean): MeshBuilder {
  const m = newBuilder()
  const center: [number, number] = [0, 0.75]
  // Left (+X) and right (-X) sides as triangle fans around the profile centroid.
  for (const right of [false, true]) {
    const x = right ? -HALF_W : HALF_W
    const n: V3 = [right ? -1 : 1, 0, 0]
    for (let i = 0; i < PROFILE.length; i++) {
      const a = PROFILE[i]!
      const b = PROFILE[(i + 1) % PROFILE.length]!
      tri(
        m,
        [
          [x, center[1], center[0]],
          [x, a[1], a[0]],
          [x, b[1], b[0]],
        ],
        [
          sideUv(center[0], center[1], right, sharedUv),
          sideUv(a[0], a[1], right, sharedUv),
          sideUv(b[0], b[1], right, sharedUv),
        ],
        n,
      )
    }
  }
  // Strip over rear, roof and front: arc length maps to v in [0.4, 0.98].
  let total = 0
  for (let i = 0; i + 1 < PROFILE.length; i++) {
    total += Math.hypot(PROFILE[i + 1]![0] - PROFILE[i]![0], PROFILE[i + 1]![1] - PROFILE[i]![1])
  }
  let acc = 0
  for (let i = 0; i + 1 < PROFILE.length; i++) {
    const a = PROFILE[i]!
    const b = PROFILE[i + 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const v0 = 0.4 + (acc / total) * 0.58
    const v1 = 0.4 + ((acc + len) / total) * 0.58
    acc += len
    // outward normal of the edge in the (z, y) plane
    const n = normalize([0, b[0] - a[0], -(b[1] - a[1])])
    quad(
      m,
      [
        [HALF_W, a[1], a[0]],
        [-HALF_W, a[1], a[0]],
        [-HALF_W, b[1], b[0]],
        [HALF_W, b[1], b[0]],
      ],
      [
        [0.05, v0],
        [0.95, v0],
        [0.95, v1],
        [0.05, v1],
      ],
      n,
    )
  }
  return m
}

function buildGlass(): MeshBuilder {
  const m = newBuilder()
  // Windscreen slightly in front of the body surface between roof and bonnet.
  const a: V3 = [HALF_W - 0.1, 1.28, 0.62]
  const b: V3 = [-(HALF_W - 0.1), 1.28, 0.62]
  const c: V3 = [-(HALF_W - 0.1), 0.98, 1.26]
  const d: V3 = [HALF_W - 0.1, 0.98, 1.26]
  const n = normalize([0, 0.64, 0.3])
  const off = (p: V3): V3 => [p[0] + n[0] * 0.01, p[1] + n[1] * 0.01, p[2] + n[2] * 0.01]
  quad(
    m,
    [off(a), off(b), off(c), off(d)],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    n,
  )
  return m
}

/**
 * Sponsor decal lying exactly on the left door, like the separate logo meshes
 * of Kunos cars. It only shows up if coplanar decals win the depth test and
 * the alpha test of ksPerPixelAT is honoured.
 */
function buildDecal(): MeshBuilder {
  const m = newBuilder()
  const x = HALF_W
  quad(
    m,
    [
      [x, 0.75, -0.5],
      [x, 0.75, 0.7],
      [x, 0.45, 0.7],
      [x, 0.45, -0.5],
    ],
    [
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    [1, 0, 0],
  )
  return m
}

function buildWheel(outwardX: number): MeshBuilder {
  const m = newBuilder()
  const r = 0.33
  const segs = 24
  const n: V3 = [outwardX, 0, 0]
  for (let i = 0; i < segs; i++) {
    const t0 = (i / segs) * Math.PI * 2
    const t1 = ((i + 1) / segs) * Math.PI * 2
    tri(
      m,
      [
        [0, 0, 0],
        [0, Math.sin(t0) * r, Math.cos(t0) * r],
        [0, Math.sin(t1) * r, Math.cos(t1) * r],
      ],
      [
        [0.5, 0.5],
        [0.5 + Math.cos(t0) * 0.5, 0.5 + Math.sin(t0) * 0.5],
        [0.5 + Math.cos(t1) * 0.5, 0.5 + Math.sin(t1) * 0.5],
      ],
      n,
    )
  }
  return m
}

function meshNode(name: string, materialId: number, b: MeshBuilder): Kn5MeshNode {
  const vertexCount = b.positions.length / 3
  let cx = 0
  let cy = 0
  let cz = 0
  for (let i = 0; i < vertexCount; i++) {
    cx += b.positions[i * 3]!
    cy += b.positions[i * 3 + 1]!
    cz += b.positions[i * 3 + 2]!
  }
  cx /= vertexCount
  cy /= vertexCount
  cz /= vertexCount
  let radius = 0
  for (let i = 0; i < vertexCount; i++) {
    radius = Math.max(
      radius,
      Math.hypot(
        b.positions[i * 3]! - cx,
        b.positions[i * 3 + 1]! - cy,
        b.positions[i * 3 + 2]! - cz,
      ),
    )
  }
  return {
    kind: 'mesh',
    name,
    active: true,
    children: [],
    castShadows: true,
    visible: true,
    transparent: false,
    positions: new Float32Array(b.positions),
    normals: new Float32Array(b.normals),
    uvs: new Float32Array(b.uvs),
    tangents: new Float32Array(vertexCount * 3),
    indices: new Uint16Array(b.indices),
    materialId,
    layer: 0,
    lodIn: 0,
    lodOut: 0,
    boundingSphere: { center: [cx, cy, cz], radius },
    renderable: true,
  }
}

function translation(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(IDENTITY)
  m[12] = x
  m[13] = y
  m[14] = z
  return m
}

function prop(name: string, a: number, c: [number, number, number] = [0, 0, 0]): Kn5ShaderProperty {
  return { name, a, b: [0, 0], c, d: [0, 0, 0, 0] }
}

function material(
  name: string,
  shader: string,
  textures: Record<string, string>,
  props: Kn5ShaderProperty[],
  blendMode = 0,
): Kn5Material {
  return {
    name,
    shader,
    blendMode,
    alphaTested: false,
    depthMode: 0,
    properties: props,
    textures: Object.entries(textures).map(([sampler, texture], slot) => ({
      name: sampler,
      slot,
      texture,
    })),
  }
}

// ---------------------------------------------------------------------------
// Textures

export interface RgbaImage {
  width: number
  height: number
  data: Uint8Array
}

function image(size: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = rgb[0]
    data[i * 4 + 1] = rgb[1]
    data[i * 4 + 2] = rgb[2]
    data[i * 4 + 3] = 255
  }
  return { width: size, height: size, data }
}

function fillRect(
  img: RgbaImage,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  rgb: [number, number, number],
): void {
  const x0 = Math.floor(u0 * img.width)
  const x1 = Math.ceil(u1 * img.width)
  const y0 = Math.floor(v0 * img.height)
  const y1 = Math.ceil(v1 * img.height)
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
      const o = (y * img.width + x) * 4
      img.data[o] = rgb[0]
      img.data[o + 1] = rgb[1]
      img.data[o + 2] = rgb[2]
    }
  }
}

/** Darkens a band (fake baked AO / panel line). */
function shade(img: RgbaImage, u0: number, v0: number, u1: number, v1: number, k: number): void {
  const x0 = Math.floor(u0 * img.width)
  const x1 = Math.ceil(u1 * img.width)
  const y0 = Math.floor(v0 * img.height)
  const y1 = Math.ceil(v1 * img.height)
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
      const o = (y * img.width + x) * 4
      for (let c = 0; c < 3; c++) img.data[o + c] = Math.round(img.data[o + c]! * k)
    }
  }
}

function paintSkin(
  base: [number, number, number],
  stripe: [number, number, number] | null,
): RgbaImage {
  const img = image(512, base)
  if (stripe) {
    fillRect(img, 0.02, 0.18, 0.48, 0.24, stripe)
    fillRect(img, 0.52, 0.18, 0.98, 0.24, stripe)
    fillRect(img, 0.42, 0.4, 0.58, 0.98, stripe)
  }
  // baked "AO": panel lines on the sides and darker lower edges
  for (const u of [0.18, 0.3, 0.7, 0.82]) shade(img, u, 0.08, u + 0.004, 0.33, 0.35)
  shade(img, 0.02, 0.3, 0.98, 0.35, 0.6)
  shade(img, 0.05, 0.62, 0.95, 0.63, 0.4)
  return img
}

function encode(img: RgbaImage): Uint8Array {
  return writeDds(img.data, img.width, img.height, 'BC1')
}

function encodeAlpha(img: RgbaImage): Uint8Array {
  return writeDds(img.data, img.width, img.height, 'BC3')
}

/** Transparent decal sheet with a coloured "logo": a thick frame and a bar. */
function paintDecal(rgb: [number, number, number]): RgbaImage {
  const w = 128
  const h = 64
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const frame =
        (x >= 8 && x < 120 && y >= 8 && y < 56 && !(x >= 18 && x < 110 && y >= 18 && y < 46)) ||
        (y >= 28 && y < 36 && x >= 30 && x < 98)
      const o = (y * w + x) * 4
      data.set(frame ? [...rgb, 255] : [0, 0, 0, 0], o)
    }
  }
  return { width: w, height: h, data }
}

export const DECAL_TEXTURE = 'decals.dds'

// ---------------------------------------------------------------------------

export interface SyntheticCarOptions {
  /** Left and right sides share one UV island (like some real cars). */
  sharedSideUv?: boolean
  /**
   * Adds an opaque livery layer (Livery.dds) just above the painted body, so
   * the body texture is completely hidden. The texture that carries the
   * visible paint is then not the one with the most "body" area.
   */
  overlayLivery?: boolean
}

export const OVERLAY_TEXTURE = 'Livery.dds'

function offsetAlongNormals(m: MeshBuilder, distance: number): MeshBuilder {
  const positions = m.positions.map((v, i) => v + m.normals[i]! * distance)
  return { ...m, positions }
}

export interface SyntheticCar {
  id: string
  kn5: Uint8Array
  /** Files relative to the car folder (content/cars/<id>/). */
  files: Record<string, Uint8Array>
}

export function buildSyntheticCar(options: SyntheticCarOptions = {}): SyntheticCar {
  const materials: Kn5Material[] = [
    material(
      'Material_Body',
      'ksPerPixelMultiMap',
      { txDiffuse: BODY_TEXTURE, txMaps: MAPS_TEXTURE },
      [
        prop('ksAmbient', 0.45),
        prop('ksDiffuse', 0.45),
        prop('ksSpecular', 0.35),
        prop('ksSpecularEXP', 40),
        prop('fresnelC', 0.08),
        prop('fresnelEXP', 3),
        prop('fresnelMaxLevel', 0.6),
      ],
    ),
    material('Material_Rim', 'ksPerPixel', { txDiffuse: 'rim.dds' }, [
      prop('ksAmbient', 0.4),
      prop('ksDiffuse', 0.4),
      prop('ksSpecular', 0.6),
      prop('ksSpecularEXP', 60),
    ]),
    material(
      'Material_Glass',
      'ksPerPixel',
      { txDiffuse: 'glass.dds' },
      [
        prop('ksAmbient', 0.2),
        prop('ksDiffuse', 0.1),
        prop('ksSpecular', 1),
        prop('ksSpecularEXP', 200),
      ],
      1,
    ),
    // alpha testing comes from the shader name only, as in many stock cars
    material('Material_Decals', 'ksPerPixelAT', { txDiffuse: DECAL_TEXTURE }, [
      prop('ksAmbient', 0.45),
      prop('ksDiffuse', 0.45),
      prop('ksSpecular', 0.2),
      prop('ksSpecularEXP', 30),
    ]),
    material(
      'Material_Livery',
      'ksPerPixelMultiMap',
      { txDiffuse: OVERLAY_TEXTURE, txMaps: MAPS_TEXTURE },
      [
        prop('ksAmbient', 0.45),
        prop('ksDiffuse', 0.45),
        prop('ksSpecular', 0.35),
        prop('ksSpecularEXP', 40),
      ],
    ),
  ]

  const wheel = (name: string, x: number, z: number): Kn5Node => ({
    kind: 'base',
    name,
    active: true,
    transform: translation(x, 0.33, z),
    children: [meshNode(`${name}_RIM`, 1, buildWheel(Math.sign(x)))],
  })

  const root: Kn5Node = {
    kind: 'base',
    name: `${SYNTHETIC_CAR_ID}.kn5`,
    active: true,
    transform: new Float32Array(IDENTITY),
    children: [
      {
        kind: 'base',
        name: 'BODY',
        active: true,
        transform: new Float32Array(IDENTITY),
        children: [
          meshNode('BODY_PAINT', 0, buildBody(options.sharedSideUv ?? false)),
          meshNode('GLASS_WINDSCREEN', 2, buildGlass()),
          meshNode('DECAL_SPONSOR_L', 3, buildDecal()),
          ...(options.overlayLivery
            ? [meshNode('BODY_LIVERY', 4, offsetAlongNormals(buildBody(false), 0.004))]
            : []),
        ],
      },
      wheel('WHEEL_LF', HALF_W + 0.01, 1.45),
      wheel('WHEEL_RF', -HALF_W - 0.01, 1.45),
      wheel('WHEEL_LR', HALF_W + 0.01, -1.4),
      wheel('WHEEL_RR', -HALF_W - 0.01, -1.4),
    ],
  }

  const white = paintSkin([235, 235, 232], null)
  const red = paintSkin([200, 30, 35], [245, 245, 245])
  const maps = image(64, [128, 160, 200])
  const kn5 = writeKn5({
    version: 6,
    extra: 0,
    textures: [
      { name: BODY_TEXTURE, active: 1, data: encode(white) },
      { name: MAPS_TEXTURE, active: 1, data: encode(maps) },
      { name: 'rim.dds', active: 1, data: encode(image(64, [150, 150, 155])) },
      { name: 'glass.dds', active: 1, data: encode(image(16, [30, 35, 40])) },
      { name: DECAL_TEXTURE, active: 1, data: encodeAlpha(paintDecal([255, 120, 20])) },
      ...(options.overlayLivery
        ? [
            {
              name: OVERLAY_TEXTURE,
              active: 1,
              data: encode(paintSkin([20, 20, 22], [240, 240, 240])),
            },
          ]
        : []),
    ],
    materials,
    root,
  })

  const files: Record<string, Uint8Array> = {
    [`${SYNTHETIC_CAR_ID}.kn5`]: kn5,
    'ui/ui_car.json': new TextEncoder().encode(
      JSON.stringify({ name: 'AC Livery Test Coupe', brand: 'AC Livery', class: 'race' }),
    ),
    'skins/00_white/Skin_00.dds': encode(white),
    'skins/00_white/ui_skin.json': new TextEncoder().encode(
      serializeUiSkin({ skinname: 'White', number: '0' }),
    ),
    'skins/01_red_stripe/Skin_00.dds': encode(red),
    [`skins/01_red_stripe/${DECAL_TEXTURE}`]: encodeAlpha(paintDecal([30, 90, 230])),
    'skins/01_red_stripe/ui_skin.json': new TextEncoder().encode(
      serializeUiSkin({
        skinname: 'Red Stripe',
        drivername: 'Test Driver',
        number: '7',
        team: 'Test',
      }),
    ),
  }
  if (options.overlayLivery) {
    files[`skins/00_white/${OVERLAY_TEXTURE}`] = encode(paintSkin([235, 235, 232], null))
    files[`skins/01_red_stripe/${OVERLAY_TEXTURE}`] = encode(
      paintSkin([20, 20, 22], [240, 240, 240]),
    )
  }
  return { id: SYNTHETIC_CAR_ID, kn5, files }
}

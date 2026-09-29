// Finds the textures of parts that can be recoloured on their own: rims,
// brake calipers and glass. Mesh categories come from the car analysis; this
// adds the texture-level rules that keep a recolour from spilling onto other
// parts (shared atlases, decal sheets, detail tiles).

import { getTextureMapping, type Kn5Material } from '../formats/kn5'
import type { CarAnalysis, MeshCategory } from './analysis'

export interface GlassTexture {
  name: string
  /** Seen from outside the car (not only in the cockpit). */
  exterior: boolean
}

export interface CarParts {
  rims: string[]
  /** Material maps (txMaps) of the rims, for their finish, with the rim texture using each. */
  rimMaps: { name: string; diffuse: string }[]
  calipers: string[]
  glass: GlassTexture[]
}

const DECAL_RE = /decal|logo|sticker|sponsor|number|name/i
const DAMAGE_RE = /damage|broken|crack/i
const BLEND_ALPHA = 1

interface Usage {
  name: string
  categories: Set<MeshCategory>
  materials: Set<number>
  meshes: number[]
}

/**
 * @param hidden mesh indices not shown by default (cockpit, damage...)
 */
export function detectParts(
  analysis: CarAnalysis,
  materials: readonly Kn5Material[],
  hidden: ReadonlySet<number> = new Set(),
): CarParts {
  const usage = new Map<string, Usage>()
  for (const m of analysis.meshes) {
    if (!m.diffuse) continue
    const key = m.diffuse.toLowerCase()
    const u = usage.get(key) ?? {
      name: m.diffuse,
      categories: new Set(),
      materials: new Set(),
      meshes: [],
    }
    u.categories.add(m.category)
    u.materials.add(m.materialId)
    u.meshes.push(m.index)
    usage.set(key, u)
  }
  // tiles multiplied over other textures: tinting them would tint twice
  const details = new Set(
    materials.flatMap((mat) => {
      const d = getTextureMapping(mat, 'txDetail')
      return d ? [d.toLowerCase()] : []
    }),
  )

  const only = (category: MeshCategory) =>
    [...usage.values()].filter((u) => u.categories.size === 1 && u.categories.has(category))

  const solid = (u: Usage) =>
    !details.has(u.name.toLowerCase()) &&
    !DECAL_RE.test(u.name) &&
    [...u.materials].every((id) => {
      const mat = materials[id]
      return !!mat && mat.blendMode !== BLEND_ALPHA && !DECAL_RE.test(mat.name)
    })

  const rims = only('rim').filter(solid)
  const rimNames = new Set(rims.map((u) => u.name.toLowerCase()))
  const rimMaps = new Map<string, { name: string; diffuse: string }>()
  const otherMaps = new Set<string>()
  for (const mat of materials) {
    const d = getTextureMapping(mat, 'txDiffuse')
    const m = getTextureMapping(mat, 'txMaps')
    if (!m) continue
    if (d && rimNames.has(d.toLowerCase()) && mat.shader.toLowerCase().includes('multimap')) {
      rimMaps.set(m.toLowerCase(), { name: m, diffuse: d })
    } else otherMaps.add(m.toLowerCase())
  }

  const glass = only('glass')
    .filter((u) => !DAMAGE_RE.test(u.name) && !details.has(u.name.toLowerCase()))
    .map((u) => ({
      name: u.name,
      exterior: u.meshes.some((i) => {
        const mesh = analysis.meshes[i]!
        return !hidden.has(i) && !/^int/i.test(mesh.materialName) && !/^int/i.test(mesh.name)
      }),
    }))

  return {
    rims: rims.map((u) => u.name),
    rimMaps: [...rimMaps.entries()].filter(([k]) => !otherMaps.has(k)).map(([, v]) => v),
    calipers: only('caliper')
      .filter(solid)
      .map((u) => u.name),
    glass,
  }
}

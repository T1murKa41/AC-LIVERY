import { describe, expect, it } from 'vitest'
import { buildSyntheticCar, CALIPER_TEXTURE, RIM_TEXTURE } from '../fixtures/syntheticCar'
import { parseKn5, type Kn5Material } from '../formats/kn5'
import { analyzeCar, type CarAnalysis, type MeshInfo } from './analysis'
import { detectParts } from './parts'

describe('detectParts', () => {
  it('finds rims, calipers and glass of the test car', () => {
    const car = buildSyntheticCar()
    const kn5 = parseKn5(car.kn5)
    const parts = detectParts(analyzeCar(kn5, { skinFileNames: [] }), kn5.materials)
    expect(parts.rims).toEqual([RIM_TEXTURE])
    expect(parts.calipers).toEqual([CALIPER_TEXTURE])
    expect(parts.glass).toEqual([{ name: 'glass.dds', exterior: true }])
    expect(parts.rimMaps).toEqual([])
  })

  // a hand-made model shaped like a Kunos LMP car
  const mat = (
    name: string,
    shader: string,
    textures: Record<string, string>,
    blendMode = 0,
  ): Kn5Material => ({
    name,
    shader,
    blendMode,
    alphaTested: false,
    depthMode: 0,
    properties: [],
    textures: Object.entries(textures).map(([sampler, texture], slot) => ({
      name: sampler,
      slot,
      texture,
    })),
  })
  const materials = [
    mat('EXT_Rims_Base', 'ksPerPixelMultiMap', {
      txDiffuse: 'Rims_Base.dds',
      txMaps: 'Rims_Base_MAP.dds',
      txDetail: 'metal_detail_rim.dds',
    }),
    mat('EXT_Rims_Spokes', 'ksPerPixelNM', { txDiffuse: 'metal_detail_rim.dds' }, 1),
    mat('EXT_Rims_Decals', 'ksPerPixelNM', { txDiffuse: 'Rims_Decals_DIFF.dds' }, 1),
    mat('EXT_Suspension_Calipers', 'ksPerPixelNM', { txDiffuse: 'Susp_Calipers_DIFF.dds' }),
    mat('EXT_Window_Alpha', 'ksPerPixelReflection', { txDiffuse: 'EXT_Glass.dds' }, 1),
    mat('INT_Glass', 'ksWindscreen', { txDiffuse: 'INTERNAL_glass.dds' }, 1),
    mat('INT_Glass_Sponsor', 'ksPerPixel', { txDiffuse: 'EXT_Details_DIF.dds' }, 1),
    mat('EXT_details', 'ksPerPixelMultiMap', { txDiffuse: 'EXT_Details_DIF.dds' }),
    mat('DAMAGE_GLASS', 'ksBrokenGlass', { txDiffuse: 'DAMAGE_GLASS_color.dds' }, 1),
  ]
  const mesh = (index: number, name: string, materialId: number, category: MeshInfo['category']) =>
    ({
      index,
      name,
      materialId,
      materialName: materials[materialId]!.name,
      shader: materials[materialId]!.shader,
      diffuse: materials[materialId]!.textures[0]!.texture,
      area: 1,
      triangles: 10,
      category,
      wheel: category === 'rim',
      world: new Float32Array(16),
    }) satisfies MeshInfo
  const analysis = {
    meshes: [
      mesh(0, 'GEO_Rim_LF', 0, 'rim'),
      mesh(1, 'GEO_Spokes', 1, 'rim'),
      mesh(2, 'Decals2', 2, 'rim'),
      mesh(3, 'GEO_Caliper', 3, 'caliper'),
      mesh(4, 'GEO_Window', 4, 'glass'),
      mesh(5, 'GEO_FrontGlass_int', 5, 'glass'),
      mesh(6, 'GEO_Glass_Banner', 6, 'glass'),
      mesh(7, 'GEO_Details', 7, 'body'),
      mesh(8, 'GEO_Damage_0', 8, 'glass'),
    ],
  } as unknown as CarAnalysis

  it('skips decal sheets, detail tiles, shared atlases and damage', () => {
    const parts = detectParts(analysis, materials, new Set([5, 8]))
    expect(parts.rims).toEqual(['Rims_Base.dds'])
    expect(parts.rimMaps).toEqual([{ name: 'Rims_Base_MAP.dds', diffuse: 'Rims_Base.dds' }])
    expect(parts.calipers).toEqual(['Susp_Calipers_DIFF.dds'])
    expect(parts.glass).toEqual([
      { name: 'EXT_Glass.dds', exterior: true },
      { name: 'INTERNAL_glass.dds', exterior: false },
    ])
  })
})

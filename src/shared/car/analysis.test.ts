import { describe, expect, it } from 'vitest'
import { buildSyntheticCar, BODY_TEXTURE, MAPS_TEXTURE } from '../fixtures/syntheticCar'
import { parseKn5, type Kn5Node } from '../formats/kn5'
import { analyzeCar, categorize } from './analysis'

const skinFiles = (files: Record<string, Uint8Array>) =>
  Object.keys(files)
    .filter((f) => f.startsWith('skins/'))
    .map((f) => f.split('/').at(-1)!)

describe('analyzeCar', () => {
  const car = buildSyntheticCar()
  const kn5 = parseKn5(car.kn5)
  const analysis = analyzeCar(kn5, { skinFileNames: skinFiles(car.files) })

  it('finds the livery texture and its maps', () => {
    expect(analysis.paintable).toEqual([BODY_TEXTURE, 'decals.dds'])
    expect(analysis.bodyTexture).toBe(BODY_TEXTURE)
    expect(analysis.bodyMapsTexture).toBe(MAPS_TEXTURE)
    expect(analysis.bodyMeshes.map((i) => analysis.meshes[i]!.name)).toEqual(['BODY_PAINT'])
  })

  it('derives the car frame from the wheel dummies', () => {
    const f = analysis.frame
    expect(f.source).toBe('wheels')
    expect(f.forward[2]).toBeCloseTo(1)
    expect(f.left[0]).toBeCloseTo(1)
    expect(f.mirrored).toBe(false)
    expect(f.length).toBeCloseTo(4.5)
    expect(f.width).toBeCloseTo(1.9)
    expect(f.origin[1]).toBeCloseTo(0.775)
  })

  it('detects a mirrored model', () => {
    const mirrored = parseKn5(car.kn5)
    const swap = (n: Kn5Node) => {
      if (n.kind === 'base' && /^WHEEL_/.test(n.name)) n.transform[12] = -n.transform[12]!
      n.children.forEach(swap)
    }
    swap(mirrored.root)
    const a = analyzeCar(mirrored, { skinFileNames: [BODY_TEXTURE] })
    expect(a.frame.mirrored).toBe(true)
    expect(a.frame.left[0]).toBeCloseTo(-1)
  })

  it('reports separate side UVs as not shared', () => {
    expect(analysis.sideUvOverlap).not.toBeNull()
    expect(analysis.sideUvOverlap!).toBeLessThan(0.05)
    expect(analysis.warnings).not.toContain('shared-side-uv')
  })

  it('warns when both sides share a UV island', () => {
    const shared = buildSyntheticCar({ sharedSideUv: true })
    const a = analyzeCar(parseKn5(shared.kn5), { skinFileNames: skinFiles(shared.files) })
    expect(a.sideUvOverlap!).toBeGreaterThan(0.9)
    expect(a.warnings).toContain('shared-side-uv')
  })

  it('keeps winding when it matches the vertex normals', () => {
    expect(analysis.flipWinding).toBe(false)
    const flipped = parseKn5(car.kn5)
    const flip = (n: Kn5Node) => {
      if (n.kind !== 'base') {
        for (let i = 0; i < n.indices.length; i += 3) {
          const t = n.indices[i + 1]!
          n.indices[i + 1] = n.indices[i + 2]!
          n.indices[i + 2] = t
        }
      }
      n.children.forEach(flip)
    }
    flip(flipped.root)
    expect(analyzeCar(flipped, { skinFileNames: [] }).flipWinding).toBe(true)
  })

  it('falls back when there are no skins', () => {
    const a = analyzeCar(kn5, { skinFileNames: [] })
    expect(a.warnings).toContain('no-skins')
    expect(a.bodyTexture).toBe(BODY_TEXTURE)
  })
})

describe('analyzeCar with a livery overlay', () => {
  it('lists both textures as paintable with equal body area', () => {
    const car = buildSyntheticCar({ overlayLivery: true })
    const a = analyzeCar(parseKn5(car.kn5), { skinFileNames: skinFiles(car.files) })
    expect(a.paintable).toEqual(expect.arrayContaining([BODY_TEXTURE, 'Livery.dds']))
    const body = a.diffuseUsage.find((u) => u.name === BODY_TEXTURE)!
    const overlay = a.diffuseUsage.find((u) => u.name === 'Livery.dds')!
    // area alone cannot tell which one is visible: the viewer measures that
    expect(overlay.area).toBeCloseTo(body.area, 0)
  })
})

describe('categorize', () => {
  it('sorts meshes by name', () => {
    expect(categorize('WINDSCREEN', 'glass_mat', false)).toBe('glass')
    expect(categorize('RIM_LF', 'm', true)).toBe('rim')
    expect(categorize('door_trim', 'm', false)).toBe('body')
    expect(categorize('CALIPER_RF', 'm', true)).toBe('caliper')
    expect(categorize('TYRE', 'm', true)).toBe('tyre')
  })
})

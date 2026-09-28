import { describe, expect, it } from 'vitest'
import { buildSyntheticCar, BODY_TEXTURE } from '../fixtures/syntheticCar'
import { FormatError } from './binary'
import { isKn5, parseKn5, walkKn5, writeKn5, transformPoint, type Kn5Node } from './kn5'

describe('kn5', () => {
  const car = buildSyntheticCar()

  it('parses the synthetic car', () => {
    expect(isKn5(car.kn5)).toBe(true)
    const kn5 = parseKn5(car.kn5)
    expect(kn5.version).toBe(6)
    expect(kn5.textures.map((t) => t.name)).toContain(BODY_TEXTURE)
    expect(kn5.materials.map((m) => m.shader)).toEqual([
      'ksPerPixelMultiMap',
      'ksPerPixel',
      'ksPerPixel',
    ])
    const names: string[] = []
    walkKn5(kn5.root, (n) => names.push(n.name))
    expect(names).toEqual(expect.arrayContaining(['BODY_PAINT', 'WHEEL_LF', 'WHEEL_RR_RIM']))
  })

  it('round-trips through the writer byte for byte', () => {
    const parsed = parseKn5(car.kn5)
    expect(writeKn5(parsed)).toEqual(car.kn5)
  })

  it('supports version 5 files without the extra header field', () => {
    const parsed = parseKn5(car.kn5)
    const v5 = writeKn5({ ...parsed, version: 5 })
    expect(v5.byteLength).toBe(car.kn5.byteLength - 4)
    expect(parseKn5(v5).materials).toHaveLength(parsed.materials.length)
  })

  it('can skip texture payloads', () => {
    const parsed = parseKn5(car.kn5, { skipTextureData: true })
    expect(parsed.textures.every((t) => t.data.byteLength === 0)).toBe(true)
  })

  it('accumulates node transforms', () => {
    const kn5 = parseKn5(car.kn5)
    let world: Float32Array | null = null
    walkKn5(kn5.root, (n, w) => {
      if (n.name === 'WHEEL_LF_RIM') world = w
    })
    expect(world).not.toBeNull()
    const p = transformPoint(world!, 0, 0, 0)
    expect(p[1]).toBeCloseTo(0.33)
    expect(p[2]).toBeCloseTo(1.45)
  })

  it('rejects encrypted or foreign data with a FormatError', () => {
    const junk = new Uint8Array(64).fill(7)
    expect(isKn5(junk)).toBe(false)
    expect(() => parseKn5(junk)).toThrow(FormatError)
  })

  it('reports truncated files', () => {
    expect(() => parseKn5(car.kn5.subarray(0, car.kn5.byteLength - 10))).toThrow(FormatError)
  })

  it('handles skinned meshes', () => {
    const parsed = parseKn5(car.kn5)
    const skinned: Kn5Node = {
      kind: 'skinned',
      name: 'SKINNED',
      active: true,
      children: [],
      castShadows: false,
      visible: true,
      transparent: false,
      bones: [{ name: 'BONE', transform: new Float32Array(16) }],
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array(9),
      uvs: new Float32Array(6),
      tangents: new Float32Array(9),
      weights: new Float32Array(12).fill(0.25),
      boneIndices: new Float32Array(12),
      indices: new Uint16Array([0, 1, 2]),
      materialId: 0,
      layer: 0,
    }
    parsed.root.children.push(skinned)
    const again = parseKn5(writeKn5(parsed))
    const found = again.root.children.at(-1)!
    expect(found.kind).toBe('skinned')
    if (found.kind === 'skinned') {
      expect(found.bones[0]!.name).toBe('BONE')
      expect(Array.from(found.weights)).toEqual(new Array(12).fill(0.25))
    }
  })
})

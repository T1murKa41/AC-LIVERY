import { describe, expect, it } from 'vitest'
import {
  buildMipChain,
  decodeDdsMip,
  encodeBc,
  hasTransparency,
  mipByteSize,
  parseDds,
  writeDds,
} from './dds'

function gradient(w: number, h: number, alpha = false): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      out[o] = Math.round((x / (w - 1)) * 255)
      out[o + 1] = Math.round((y / (h - 1)) * 255)
      out[o + 2] = 128
      out[o + 3] = alpha ? Math.round(((x + y) / (w + h - 2)) * 255) : 255
    }
  }
  return out
}

function maxError(a: Uint8Array, b: Uint8Array, channels = [0, 1, 2, 3]): number {
  let m = 0
  for (let i = 0; i < a.length; i += 4) {
    for (const c of channels) m = Math.max(m, Math.abs(a[i + c]! - b[i + c]!))
  }
  return m
}

describe('dds', () => {
  it('writes and reads back uncompressed BGRA8 exactly', () => {
    const src = gradient(16, 8, true)
    const dds = parseDds(writeDds(src, 16, 8, 'BGRA8'))
    expect(dds.format).toBe('BGRA8')
    expect(dds.mips.map((m) => [m.width, m.height])).toEqual([
      [16, 8],
      [8, 4],
      [4, 2],
      [2, 1],
      [1, 1],
    ])
    expect(decodeDdsMip(dds.format, dds.mips[0]!)).toEqual(src)
  })

  it('encodes BC1 with bounded error', () => {
    const src = gradient(64, 64)
    const dds = parseDds(writeDds(src, 64, 64, 'BC1'))
    expect(dds.format).toBe('BC1')
    expect(dds.mips[0]!.data.byteLength).toBe(mipByteSize('BC1', 64, 64))
    const back = decodeDdsMip('BC1', dds.mips[0]!)
    expect(maxError(src, back, [0, 1, 2])).toBeLessThan(24)
    expect(hasTransparency(back)).toBe(false)
  })

  it('encodes BC3 alpha with bounded error', () => {
    const src = gradient(32, 32, true)
    const back = decodeDdsMip('BC3', parseDds(writeDds(src, 32, 32, 'BC3')).mips[0]!)
    expect(maxError(src, back, [3])).toBeLessThan(12)
    expect(maxError(src, back, [0, 1, 2])).toBeLessThan(24)
  })

  it('encodes flat colors exactly (after 565 quantization)', () => {
    const src = new Uint8Array(8 * 8 * 4)
    for (let i = 0; i < 64; i++) src.set([200, 40, 16, 255], i * 4)
    const back = decodeDdsMip('BC1', { width: 8, height: 8, data: encodeBc('BC1', src, 8, 8) })
    expect(maxError(src, back, [0, 1, 2])).toBeLessThanOrEqual(4)
  })

  it('handles sizes that are not multiples of four', () => {
    const src = gradient(6, 5)
    const back = decodeDdsMip('BC1', parseDds(writeDds(src, 6, 5, 'BC1')).mips[0]!)
    expect(back.byteLength).toBe(6 * 5 * 4)
  })

  it('builds a full mip chain down to 1x1', () => {
    const chain = buildMipChain(gradient(8, 2), 8, 2)
    expect(chain.at(-1)).toMatchObject({ width: 1, height: 1 })
    expect(chain).toHaveLength(4)
  })

  it('parses DX10 headers', () => {
    const legacy = writeDds(gradient(8, 8), 8, 8, 'BC1', false)
    const dx10 = new Uint8Array(legacy.byteLength + 20)
    dx10.set(legacy.subarray(0, 128))
    const v = new DataView(dx10.buffer)
    v.setUint32(84, 0x30315844, true) // 'DX10'
    v.setUint32(128, 72, true) // BC1_UNORM_SRGB
    v.setUint32(132, 3, true)
    v.setUint32(140, 1, true)
    dx10.set(legacy.subarray(128), 148)
    const dds = parseDds(dx10)
    expect(dds.format).toBe('BC1')
    expect(dds.srgb).toBe(true)
  })

  it('decodes 16-bit legacy formats', () => {
    const make = (masks: [number, number, number, number], flags: number, pixel: number) => {
      const bytes = new Uint8Array(128 + 2)
      const v = new DataView(bytes.buffer)
      v.setUint32(0, 0x20534444, true)
      v.setUint32(4, 124, true)
      v.setUint32(12, 1, true)
      v.setUint32(16, 1, true)
      v.setUint32(28, 1, true)
      v.setUint32(76, 32, true)
      v.setUint32(80, flags, true)
      v.setUint32(88, 16, true)
      masks.forEach((m, i) => v.setUint32(92 + i * 4, m, true))
      v.setUint16(128, pixel, true)
      const dds = parseDds(bytes)
      return [dds.format, [...decodeDdsMip(dds.format, dds.mips[0]!)]]
    }
    expect(make([0xf800, 0x07e0, 0x001f, 0], 0x40, 0xf800)).toEqual(['B5G6R5', [255, 0, 0, 255]])
    expect(make([0x7c00, 0x03e0, 0x001f, 0x8000], 0x41, 0x83e0)).toEqual([
      'B5G5R5A1',
      [0, 255, 0, 255],
    ])
    expect(make([0x0f00, 0x00f0, 0x000f, 0xf000], 0x41, 0x700f)).toEqual([
      'B4G4R4A4',
      [0, 0, 255, 119],
    ])
  })

  it('rejects non-DDS data', () => {
    expect(() => parseDds(new Uint8Array(200))).toThrow()
  })
})

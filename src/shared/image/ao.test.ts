import { describe, expect, it } from 'vitest'
import { aoSourceScore, extractAoDetail } from './ao'

function solid(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) out.set([...rgb, 255], i * 4)
  return out
}

describe('extractAoDetail', () => {
  it('is neutral on flat paint of any colour', () => {
    for (const rgb of [
      [240, 240, 240],
      [200, 20, 20],
      [30, 30, 90],
    ] as [number, number, number][]) {
      const d = extractAoDetail(solid(32, 32, rgb), 32, 32)
      expect(Math.min(...d)).toBeGreaterThan(250)
    }
  })

  it('keeps thin dark panel lines', () => {
    const img = solid(64, 64, [220, 220, 220])
    for (let y = 0; y < 64; y++) img.set([80, 80, 80, 255], (y * 64 + 32) * 4)
    const d = extractAoDetail(img, 64, 64)
    expect(d[10 * 64 + 32]!).toBeLessThan(110)
    expect(d[10 * 64 + 10]!).toBeGreaterThan(250)
  })

  it('does not carry over bright details', () => {
    const img = solid(64, 64, [120, 120, 120])
    for (let x = 20; x < 30; x++) img.set([255, 255, 255, 255], (10 * 64 + x) * 4)
    const d = extractAoDetail(img, 64, 64)
    expect(d[10 * 64 + 25]!).toBe(255)
  })
})

describe('aoSourceScore', () => {
  it('prefers white over coloured skins', () => {
    const white = aoSourceScore(solid(8, 8, [235, 235, 235]), null)
    const red = aoSourceScore(solid(8, 8, [200, 30, 30]), null)
    const black = aoSourceScore(solid(8, 8, [20, 20, 20]), null)
    expect(white).toBeGreaterThan(red)
    expect(white).toBeGreaterThan(black)
  })

  it('ignores texels outside the mask', () => {
    const img = solid(2, 1, [240, 240, 240])
    img.set([255, 0, 0, 255], 4)
    expect(aoSourceScore(img, new Uint8Array([1, 0]))).toBeCloseTo(
      aoSourceScore(solid(1, 1, [240, 240, 240]), null),
    )
  })
})

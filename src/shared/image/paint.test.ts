import { describe, expect, it } from 'vitest'
import { measurePaint } from './paint'

function image(fill: (i: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(100 * 4)
  for (let i = 0; i < 100; i++) out.set([...fill(i), 255], i * 4)
  return out
}

const cos = (a: number[], b: number[]) =>
  (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) /
  Math.hypot(a[0]!, a[1]!, a[2]!) /
  Math.hypot(b[0]!, b[1]!, b[2]!)

describe('measurePaint', () => {
  it('finds a yellow caliper under a white logo', () => {
    // 70 % yellow in two shades, 30 % white lettering
    const p = measurePaint(
      image((i) => (i < 30 ? [250, 250, 250] : i < 60 ? [230, 190, 20] : [150, 124, 13])),
    )
    expect(cos(p.direction, [230, 190, 20])).toBeGreaterThan(0.999)
    // median of the yellow pixels, not of the logo
    expect(p.luminance).toBeLessThan(0.75)
    expect(p.luminance).toBeGreaterThan(0.4)
  })

  it('finds a silver rim under a red logo', () => {
    const p = measurePaint(image((i) => (i < 20 ? [220, 20, 30] : [165, 165, 170])))
    expect(cos(p.direction, [1, 1, 1])).toBeGreaterThan(0.999)
    expect(p.luminance).toBeCloseTo(0.65, 1)
  })

  it('copes with black textures', () => {
    const p = measurePaint(image(() => [0, 0, 0]))
    expect(p.luminance).toBe(0.08)
  })
})

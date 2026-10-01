import { describe, expect, it } from 'vitest'
import { resolveLayer } from './params'
import {
  PATTERNS,
  PATTERN_INFO,
  PATTERN_PRESETS,
  cellRandom,
  fadeFactor,
  fbm,
  newFill,
  normalizeFill,
  random,
  valueNoise,
} from './patterns'
import { DEFAULT_PLACEMENT, newShapeLayer, type ShapeLayer } from './types'

describe('pattern fills', () => {
  it('has defaults and info for every pattern', () => {
    for (const p of PATTERNS) {
      const f = newFill(p)
      expect(f.pattern).toBe(p)
      expect(normalizeFill(f)).toEqual(f)
      expect(PATTERN_INFO[p]).toBeDefined()
    }
  })

  it('makes stored fills safe and drops unknown ones', () => {
    expect(normalizeFill(null)).toBeNull()
    expect(normalizeFill({ pattern: 'plaid' })).toBeNull()
    const f = normalizeFill({
      pattern: 'dots',
      background: 'red',
      transparent: 'yes',
      size: -3,
      weight: 9,
      angle: Number.NaN,
      fade: -7,
      seed: 12.6,
    })!
    expect(f.background).toBe(newFill('dots').background)
    expect(f.transparent).toBe(true)
    expect(f.size).toBe(0.01)
    expect(f.weight).toBe(1)
    expect(f.angle).toBe(0)
    expect(f.fade).toBe(-1)
    expect(f.seed).toBe(13)
  })

  it('fades towards the chosen edge', () => {
    expect(fadeFactor(0, 0.9)).toBe(1)
    expect(fadeFactor(1, 0)).toBe(1)
    expect(fadeFactor(1, 1)).toBe(0)
    expect(fadeFactor(1, 0.5)).toBeCloseTo(0.5)
    expect(fadeFactor(-1, 0)).toBe(0)
    expect(fadeFactor(-1, 1)).toBe(1)
    expect(fadeFactor(0.5, 1)).toBeCloseTo(0.5)
    // outside the layer it stays in range
    expect(fadeFactor(1, 2)).toBe(0)
    expect(fadeFactor(1, -1)).toBe(1)
  })

  it('draws the same random numbers for the same seed', () => {
    const a = random(7)
    const b = random(7)
    const c = random(8)
    const sa = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(sa)
    expect([c(), c(), c()]).not.toEqual(sa)
    for (const v of sa) expect(v).toBeGreaterThanOrEqual(0)
    expect(cellRandom(3, 4, 1)).toBe(cellRandom(3, 4, 1))
    expect(cellRandom(3, 4, 1)).not.toBe(cellRandom(4, 3, 1))
  })

  it('has smooth noise in 0..1', () => {
    let min = 1
    let max = 0
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.137
      const y = i * 0.071
      const n = fbm(x, y, 5)
      min = Math.min(min, n)
      max = Math.max(max, n)
      expect(Math.abs(valueNoise(x + 1e-4, y, 5) - valueNoise(x, y, 5))).toBeLessThan(0.01)
    }
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThanOrEqual(1)
    expect(max - min).toBeGreaterThan(0.4)
    // lattice points take the cell's own value
    expect(valueNoise(2, 3, 9)).toBe(cellRandom(2, 3, 9))
  })

  it('has presets with known patterns and sizes', () => {
    const ids = new Set<string>()
    for (const p of PATTERN_PRESETS) {
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      expect(normalizeFill(p.fill)).toEqual(p.fill)
      expect(p.width).toBeGreaterThan(0)
      expect(p.height).toBeGreaterThan(0)
    }
  })

  it('binds the pattern background to a parameter', () => {
    const layer: ShapeLayer = {
      ...newShapeLayer('rect', DEFAULT_PLACEMENT, '#ffffff'),
      fill: { ...newFill('checker'), transparent: false, background: '#000000' },
      bindings: { color: 'primary', background: 'secondary' },
    }
    const r = resolveLayer(layer, { primary: '#112233', secondary: '#445566' }, {}) as ShapeLayer
    expect(r.color).toBe('#112233')
    expect(r.fill!.background).toBe('#445566')
    // the layer itself is left as it was
    expect(layer.fill!.background).toBe('#000000')
  })
})

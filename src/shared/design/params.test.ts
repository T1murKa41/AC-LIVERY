import { describe, expect, it } from 'vitest'
import { fillText, paramValues, placeholders, resolveDraft, STANDARD_PARAMS } from './params'
import {
  DEFAULT_PARTS,
  DEFAULT_PLACEMENT,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
  type Layer,
} from './types'

describe('template parameters', () => {
  it('fills placeholders and keeps unknown ones', () => {
    expect(fillText('#{number} {Driver} {nope}', { number: '7', driver: 'Ann' })).toBe(
      '#7 Ann {nope}',
    )
    expect(placeholders('{number}-{team}')).toEqual(['number', 'team'])
  })

  it('falls back to defaults and rejects bad colours', () => {
    const v = paramValues(STANDARD_PARAMS, { number: '12', primary: 'red' })
    expect(v.number).toBe('12')
    expect(v.primary).toBe('#d7261e')
    expect(v.driver).toBe('Driver Name')
  })

  it('resolves a draft', () => {
    const stripe = { ...newShapeLayer('rect', DEFAULT_PLACEMENT), bindings: { color: 'secondary' } }
    const number = {
      ...newTextLayer('{number}', DEFAULT_PLACEMENT, 1),
      bindings: { color: 'accent' },
    }
    const logo = {
      ...newImageLayer('stock', 'logo', DEFAULT_PLACEMENT, 1),
      bindings: { asset: 'sponsor1' },
    }
    const draft = {
      baseColor: '#000000',
      design: {
        layers: [stripe, number, logo],
        assets: { a1: { name: 'x.png', mime: 'image/png', data: 'data:,' } },
      },
      parts: DEFAULT_PARTS,
      csp: { colorA: '#111111', colorB: '#222222' },
      meta: { drivername: '{driver}', number: '{number}' },
      params: [...STANDARD_PARAMS],
      values: { number: '44', driver: 'Lewis', primary: '#0000ff', secondary: '#00ff00' },
      bindings: { baseColor: 'primary', rims: 'accent' },
    }
    const r = resolveDraft(draft)
    expect(r.baseColor).toBe('#0000ff')
    expect(r.parts.rims.color).toBe('#16181b')
    expect(r.meta).toEqual({ drivername: 'Lewis', number: '44' })
    const [s, t, i] = r.design.layers as [Layer, Layer, Layer]
    expect(s.kind === 'shape' && s.color).toBe('#00ff00')
    expect(t.kind === 'text' && t.text).toBe('44')
    expect(t.kind === 'text' && t.color).toBe('#16181b')
    // no sponsor image given: the slot is hidden
    expect(i!.visible).toBe(false)
    const withLogo = resolveDraft({ ...draft, values: { ...draft.values, sponsor1: 'a1' } })
    const img = withLogo.design.layers[2]!
    expect(img.visible && img.kind === 'image' && img.asset).toBe('a1')
    // the source draft is untouched
    expect(number.text).toBe('{number}')
  })

  it('leaves drafts without parameters alone', () => {
    const draft = {
      baseColor: '#123456',
      design: { layers: [], assets: {} },
      parts: DEFAULT_PARTS,
      csp: { colorA: '#111111', colorB: '#222222' },
      meta: { number: '{number}' },
    }
    expect(resolveDraft(draft)).toBe(draft)
  })
})

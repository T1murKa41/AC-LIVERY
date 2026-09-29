import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLACEMENT,
  duplicateLayer,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
  pruneAssets,
} from './types'

describe('layers', () => {
  it('derives height from the aspect ratio', () => {
    expect(newTextLayer('42', DEFAULT_PLACEMENT, 2).placement.height).toBeCloseTo(0.1)
    expect(newShapeLayer('circle', DEFAULT_PLACEMENT).placement.height).toBeCloseTo(0.2)
  })

  it('duplicates with a new id and a nudged position', () => {
    const a = newShapeLayer('star', DEFAULT_PLACEMENT)
    const b = duplicateLayer(a)
    expect(b.id).not.toBe(a.id)
    expect(b.placement.position).not.toEqual(a.placement.position)
  })

  it('keeps only referenced assets', () => {
    const img = newImageLayer('img1', 'logo', DEFAULT_PLACEMENT, 1)
    const text = { ...newTextLayer('A', DEFAULT_PLACEMENT, 1), font: 'asset:font1' }
    const asset = { name: 'x', mime: 'image/png', data: 'data:,' }
    const design = pruneAssets({
      layers: [img, text],
      assets: { img1: asset, font1: asset, unused: asset },
    })
    expect(Object.keys(design.assets).sort()).toEqual(['font1', 'img1'])
  })
})

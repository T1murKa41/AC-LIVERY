import { describe, expect, it } from 'vitest'
import { basis, positionToWorld, type Frame } from './placement'
import {
  moveSelection,
  rotateSelection,
  scaleSelection,
  selectionBounds,
  snapAngle,
} from './transform'
import { DEFAULT_PLACEMENT, type Placement, type V3 } from './types'

// display space like the viewer: +X left, +Y up, +Z forward
const frame: Frame = {
  origin: [0, 0.6, 0],
  forward: [0, 0, 1],
  left: [1, 0, 0],
  up: [0, 1, 0],
  length: 4,
  width: 2,
  height: 1.2,
}

const onLeft = (z: number, y = 0): Placement => ({
  ...DEFAULT_PLACEMENT,
  position: [1, y, z],
  direction: [-1, 0, 0],
  width: 0.1,
  height: 0.1,
})

const close = (a: V3, b: V3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5))

describe('selection transforms', () => {
  it('bounds two vinyls in the plane of the first', () => {
    const b = selectionBounds(frame, [onLeft(-0.5), onLeft(0.5)], onLeft(-0.5))
    // 0.4 m wide each, centres 2 m apart along the car
    expect(b.width).toBeCloseTo(2.4)
    expect(b.height).toBeCloseTo(0.4)
    close(b.center, [1, 0.6, 0])
  })

  it('moves without changing depth', () => {
    const dir = basis(frame, onLeft(0)).dir
    const [moved] = moveSelection(frame, [onLeft(0)], [0.3, 0.2, 1], dir)
    close(positionToWorld(frame, moved!.position), [1, 0.8, 1])
  })

  it('scales sizes and gaps around the pivot', () => {
    const dir = basis(frame, onLeft(0)).dir
    const out = scaleSelection(frame, [onLeft(-0.5), onLeft(0.5)], [1, 0.6, 0], 2, dir)
    close(positionToWorld(frame, out[0]!.position), [1, 0.6, -2])
    close(positionToWorld(frame, out[1]!.position), [1, 0.6, 2])
    expect(out[0]!.width).toBeCloseTo(0.2)
  })

  it('rotates positions and vinyls counter-clockwise as seen by the projector', () => {
    const dir = basis(frame, onLeft(0)).dir
    // seen from the left side (looking at -X) the nose (+Z) is on the viewer's
    // left; a quarter turn counter-clockwise takes it to the bottom
    const [turned] = rotateSelection(frame, [onLeft(0.5)], [1, 0.6, 0], 90, dir)
    close(positionToWorld(frame, turned!.position), [1, -0.4, 0])
    expect(turned!.rotation).toBe(90)
    const [back] = rotateSelection(frame, [turned!], [1, 0.6, 0], -90, dir)
    expect(back!.rotation).toBe(0)
    close(positionToWorld(frame, back!.position), [1, 0.6, 1])
  })

  it('snaps angles near a step', () => {
    expect(snapAngle(88, 90, 3)).toBe(90)
    expect(snapAngle(80, 90, 3)).toBe(80)
    expect(snapAngle(22, 15)).toBe(15)
  })
})

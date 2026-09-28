import { describe, expect, it } from 'vitest'
import {
  hitsProjector,
  placeAt,
  positionToWorld,
  projectPoint,
  projectors,
  type Frame,
} from './placement'
import { DEFAULT_PLACEMENT, type Placement, type V3 } from './types'

// Same frame as the synthetic car: nose +Z, driver's left +X.
const frame: Frame = {
  origin: [0, 0.75, 0],
  forward: [0, 0, 1],
  left: [1, 0, 0],
  up: [0, 1, 0],
  length: 4.5,
  width: 1.9,
  height: 1.05,
}

const onLeftDoor: Placement = { ...DEFAULT_PLACEMENT, position: [1, 0, 0], direction: [-1, 0, 0] }
const leftSurface = (dz = 0, dy = 0): V3 => [0.95, 0.75 + dy, dz]

describe('projectors', () => {
  it('centres the vinyl on its position', () => {
    const [p] = projectors(frame, onLeftDoor)
    const [s, t, r] = projectPoint(p!, leftSurface())
    expect(s).toBeCloseTo(0.5)
    expect(t).toBeCloseTo(0.5)
    expect(r).toBeCloseTo(0)
  })

  it('reads left to right from nose to tail on the left side', () => {
    const [p] = projectors(frame, onLeftDoor)
    expect(projectPoint(p!, leftSurface(-0.2))[0]).toBeGreaterThan(0.5) // towards the rear = right
    expect(projectPoint(p!, leftSurface(0, 0.1))[1]).toBeGreaterThan(0.5) // higher = top
  })

  it('scales with the placement size relative to the body', () => {
    const [p] = projectors(frame, { ...onLeftDoor, width: 0.2 }) // 0.9 m wide
    expect(hitsProjector(p!, leftSurface(-0.44))).toBe(true)
    expect(hitsProjector(p!, leftSurface(-0.46))).toBe(false)
  })

  it('rotates counter-clockwise as seen by the projector', () => {
    const [p] = projectors(frame, { ...onLeftDoor, rotation: 90 })
    // after 90° the top of the vinyl points to the nose (screen left on this side)
    expect(projectPoint(p!, leftSurface(0.1))[1]).toBeGreaterThan(0.5)
  })

  it('does not reach the other side of the car', () => {
    const [p] = projectors(frame, onLeftDoor)
    expect(hitsProjector(p!, [-0.95, 0.75, 0])).toBe(false)
  })

  it('mirrors to the right side, readable or flipped', () => {
    const [, readable] = projectors(frame, { ...onLeftDoor, mirror: 'readable' })
    const [, flipped] = projectors(frame, { ...onLeftDoor, mirror: 'flipped' })
    const rightSurface = (dz: number): V3 => [-0.95, 0.75, dz]
    expect(projectPoint(readable!, rightSurface(0))[0]).toBeCloseTo(0.5)
    // on the right side the nose is on the viewer's right
    expect(projectPoint(readable!, rightSurface(0.2))[0]).toBeGreaterThan(0.5)
    expect(projectPoint(flipped!, rightSurface(0.2))[0]).toBeLessThan(0.5)
    expect(projectors(frame, onLeftDoor)).toHaveLength(1)
  })

  it('uses the nose as "up" when projecting from above', () => {
    const [p] = projectors(frame, { ...onLeftDoor, position: [0, 1, 0], direction: [0, -1, 0] })
    expect(projectPoint(p!, [0, 1.275, 0.3])[1]).toBeGreaterThan(0.5)
  })
})

describe('placeAt', () => {
  it('stores positions relative to the body and round-trips', () => {
    const point: V3 = [0.95, 0.9, -1.2]
    const placed = placeAt(frame, DEFAULT_PLACEMENT, point, [-2, 0, 0])
    expect(placed.direction).toEqual([-1, 0, 0])
    const back = positionToWorld(frame, placed.position)
    back.forEach((v, i) => expect(v).toBeCloseTo(point[i]!))
    expect(placed.position[0]).toBeCloseTo(1)
  })

  it('keeps the same relative spot on a longer car', () => {
    const placed = placeAt(frame, DEFAULT_PLACEMENT, [0.95, 0.75, 1.125], [-1, 0, 0])
    const longer = { ...frame, length: 9 }
    expect(positionToWorld(longer, placed.position)[2]).toBeCloseTo(2.25)
  })
})

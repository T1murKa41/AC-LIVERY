// Moving, scaling and rotating several vinyls together (a selection or a
// group). Everything happens in the plane of a reference vinyl, seen along
// its projection direction, so a group keeps its layout on the car.

import { basis, positionToWorld, worldToPosition, type Frame } from './placement'
import type { Placement, V3 } from './types'

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** Part of a vector across the plane with unit normal `n`. */
const planar = (v: V3, n: V3): V3 => sub(v, scale(n, dot(v, n)))

/** Rotates v around a unit axis by angle (radians), right-hand rule. */
function rotate(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)))
}

/** Rectangle around several vinyls in the plane of a reference vinyl. */
export interface SelectionBounds {
  center: V3
  /** Corners in world space: bottom-left, bottom-right, top-right, top-left. */
  corners: [V3, V3, V3, V3]
  right: V3
  up: V3
  dir: V3
  width: number
  height: number
}

export function selectionBounds(
  frame: Frame,
  placements: Placement[],
  reference: Placement,
): SelectionBounds {
  const ref = basis(frame, reference)
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const p of placements) {
    const b = basis(frame, p)
    const hw = (p.width * frame.length) / 2
    const hh = (p.height * frame.length) / 2
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const corner = add(b.origin, add(scale(b.right, su * hw), scale(b.up, sv * hh)))
      const q = sub(corner, ref.origin)
      const u = dot(q, ref.right)
      const v = dot(q, ref.up)
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
  }
  const at = (u: number, v: number): V3 =>
    add(ref.origin, add(scale(ref.right, u), scale(ref.up, v)))
  return {
    center: at((minU + maxU) / 2, (minV + maxV) / 2),
    corners: [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)],
    right: ref.right,
    up: ref.up,
    dir: ref.dir,
    width: maxU - minU,
    height: maxV - minV,
  }
}

/** Shifts vinyls by a world offset, ignoring its part along `dir` (depth stays). */
export function moveSelection(
  frame: Frame,
  placements: Placement[],
  delta: V3,
  dir: V3,
): Placement[] {
  const shift = planar(delta, dir)
  return placements.map((p) => ({
    ...p,
    position: worldToPosition(frame, add(positionToWorld(frame, p.position), shift)),
  }))
}

/** Scales vinyls and the gaps between them around a pivot. */
export function scaleSelection(
  frame: Frame,
  placements: Placement[],
  pivot: V3,
  k: number,
  dir: V3,
): Placement[] {
  return placements.map((p) => {
    const offset = sub(positionToWorld(frame, p.position), pivot)
    const along = dot(offset, dir)
    const moved = add(pivot, add(scale(planar(offset, dir), k), scale(dir, along)))
    return {
      ...p,
      position: worldToPosition(frame, moved),
      width: p.width * k,
      height: p.height * k,
    }
  })
}

/**
 * Turns vinyls around a pivot, counter-clockwise as seen along `dir` (the
 * same convention as Placement.rotation). Vinyls projected the other way
 * turn the other way in their own frame; side-on ones keep their rotation.
 */
export function rotateSelection(
  frame: Frame,
  placements: Placement[],
  pivot: V3,
  degrees: number,
  dir: V3,
): Placement[] {
  const angle = (degrees * Math.PI) / 180
  const axis = scale(dir, -1)
  return placements.map((p) => {
    const offset = sub(positionToWorld(frame, p.position), pivot)
    const moved = add(pivot, rotate(offset, axis, angle))
    const facing = dot(basis(frame, p).dir, dir)
    const turn = facing > 0.5 ? degrees : facing < -0.5 ? -degrees : 0
    return {
      ...p,
      position: worldToPosition(frame, moved),
      rotation: (((p.rotation + turn) % 360) + 360) % 360,
    }
  })
}

/** Snaps an angle (degrees) to a step; also used for the 0/90/180/270 detents. */
export function snapAngle(degrees: number, step: number, tolerance = step / 2): number {
  const snapped = Math.round(degrees / step) * step
  return Math.abs(snapped - degrees) <= tolerance ? snapped : degrees
}

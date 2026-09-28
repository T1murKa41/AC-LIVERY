// Projector math: turns a car-relative Placement into world-space axes and back.
//
// A projector is an oriented box. For a world point W:
//   s = dot(W - origin, axisS) + 0.5   horizontal coordinate in the vinyl, 0..1
//   t = dot(W - origin, axisT) + 0.5   vertical coordinate (1 = top of the vinyl)
//   r = dot(W - origin, axisR)         depth, the point is inside if |r| <= 0.5
// axisR is along the projection direction, so dot(normal, -axisR) tells how
// much a surface faces the projector.
//
// All vectors here are in display space (what the user sees; the viewer has
// already undone any mirroring of the model).

import type { MirrorMode, Placement, V3 } from './types'

export interface Frame {
  origin: V3
  forward: V3
  left: V3
  up: V3
  length: number
  width: number
  height: number
}

export interface Projector {
  origin: V3
  axisS: V3
  axisT: V3
  axisR: V3
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const length = (a: V3): number => Math.hypot(a[0], a[1], a[2])
const normalize = (a: V3): V3 => {
  const l = length(a)
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0]
}

/** Rotates v around a unit axis by angle (radians), right-hand rule. */
function rotate(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)))
}

/** Car-frame components (left, up, forward) to a world vector. */
export function frameToWorld(frame: Frame, v: V3): V3 {
  return add(add(scale(frame.left, v[0]), scale(frame.up, v[1])), scale(frame.forward, v[2]))
}

/** World vector to car-frame components (left, up, forward). */
export function worldToFrame(frame: Frame, v: V3): V3 {
  return [dot(v, frame.left), dot(v, frame.up), dot(v, frame.forward)]
}

/** Normalised position (-1..1 over the body) to a world point. */
export function positionToWorld(frame: Frame, p: V3): V3 {
  return add(
    frame.origin,
    frameToWorld(frame, [
      (p[0] * frame.width) / 2,
      (p[1] * frame.height) / 2,
      (p[2] * frame.length) / 2,
    ]),
  )
}

export function worldToPosition(frame: Frame, w: V3): V3 {
  const local = worldToFrame(frame, sub(w, frame.origin))
  return [
    local[0] / (frame.width / 2),
    local[1] / (frame.height / 2),
    local[2] / (frame.length / 2),
  ]
}

/** World-space axes of a placement: centre, the vinyl's right and up, projection direction. */
export interface Basis {
  origin: V3
  right: V3
  up: V3
  dir: V3
}

export function basis(frame: Frame, placement: Placement): Basis {
  const dir = normalize(frameToWorld(frame, placement.direction))
  // "up" of the vinyl: the car's up, or its nose when projecting from above/below
  let up = sub(frame.up, scale(dir, dot(frame.up, dir)))
  if (length(up) < 0.2) up = sub(frame.forward, scale(dir, dot(frame.forward, dir)))
  up = normalize(up)
  // counter-clockwise as seen by the projector = rotation around -dir
  up = normalize(rotate(up, scale(dir, -1), (placement.rotation * Math.PI) / 180))
  const right = normalize(cross(dir, up))
  return { origin: positionToWorld(frame, placement.position), right, up, dir }
}

function toProjector(frame: Frame, placement: Placement, b: Basis): Projector {
  const w = Math.max(1e-4, placement.width * frame.length)
  const h = Math.max(1e-4, placement.height * frame.length)
  const d = Math.max(1e-4, placement.depth * frame.width)
  return {
    origin: b.origin,
    axisS: scale(b.right, 1 / w),
    axisT: scale(b.up, 1 / h),
    axisR: scale(b.dir, 1 / d),
  }
}

/** Reflects a world point/vector across the car's symmetry plane. */
function reflectPoint(frame: Frame, p: V3): V3 {
  const k = dot(sub(p, frame.origin), frame.left)
  return sub(p, scale(frame.left, 2 * k))
}

function reflectVector(frame: Frame, v: V3): V3 {
  return sub(v, scale(frame.left, 2 * dot(v, frame.left)))
}

/** The projector for a placement and, if mirrored, its copy on the other side. */
export function projectors(frame: Frame, placement: Placement): Projector[] {
  const b = basis(frame, placement)
  const out = [toProjector(frame, placement, b)]
  if (placement.mirror !== 'none') {
    const dir = reflectVector(frame, b.dir)
    const up = reflectVector(frame, b.up)
    // A reflection flips handedness. Recomputing "right" keeps the image
    // readable; negating it gives a true mirror image.
    let right = normalize(cross(dir, up))
    if (placement.mirror === 'flipped') right = scale(right, -1)
    out.push(
      toProjector(frame, placement, { origin: reflectPoint(frame, b.origin), right, up, dir }),
    )
  }
  return out
}

/** Vinyl coordinates (s, t, r) of a world point for one projector. */
export function projectPoint(p: Projector, w: V3): V3 {
  const q = sub(w, p.origin)
  return [dot(q, p.axisS) + 0.5, dot(q, p.axisT) + 0.5, dot(q, p.axisR)]
}

/** True if the world point falls inside the vinyl rectangle and depth range. */
export function hitsProjector(p: Projector, w: V3): boolean {
  const [s, t, r] = projectPoint(p, w)
  return s >= 0 && s <= 1 && t >= 0 && t <= 1 && Math.abs(r) <= 0.5
}

/** Moves a placement so it is projected at a world point along a world direction. */
export function placeAt(frame: Frame, placement: Placement, point: V3, direction: V3): Placement {
  return {
    ...placement,
    position: worldToPosition(frame, point),
    direction: normalize(worldToFrame(frame, normalize(direction))),
  }
}

export function setMirror(placement: Placement, mirror: MirrorMode): Placement {
  return { ...placement, mirror }
}

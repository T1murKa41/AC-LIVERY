// Gallery thumbnails of the built-in templates: a generic car seen from the
// left with the template's side vinyls drawn on it. Not the real car, just
// enough to tell the templates apart before applying one.

import { resolveDraft } from '@shared/design/params'
import type { TemplateContent } from '@shared/design/templates'
import { DEFAULT_CSP, DEFAULT_PARTS, type Layer } from '@shared/design/types'
import { rasterize } from './vinyl'

const W = 360
const H = 128
/** Body length and height on the thumbnail, in pixels. */
const LEN = W * 0.88
const HEIGHT = LEN * 0.26
const CX = W / 2
const CY = H * 0.46
/** Shapes are drawn this big at most: the thumbnail is small. */
const RASTER = 512

// outline of the body and the side glass, as (z, y) in body coordinates:
// z = 1 at the nose, y = -1 at the sills and 1 on the roof
const BODY: [number, number][] = [
  [0.97, -1],
  [1, -0.6],
  [0.99, -0.25],
  [0.9, -0.05],
  [0.6, 0.12],
  [0.38, 0.3],
  [0.12, 0.92],
  [-0.3, 0.98],
  [-0.58, 0.6],
  [-0.8, 0.38],
  [-0.99, 0.32],
  [-1, -0.4],
  [-0.96, -1],
]
const GLASS: [number, number][] = [
  [0.34, 0.33],
  [0.11, 0.83],
  [-0.28, 0.88],
  [-0.6, 0.37],
]
const WHEELS = [0.62, -0.62]
const WHEEL_RADIUS = 0.075 * LEN

/** Seen from the left the nose points left. */
function px(z: number, y: number): [number, number] {
  return [CX - (z * LEN) / 2, CY - (y * HEIGHT) / 2]
}

function outline(points: [number, number][]): Path2D {
  const p = new Path2D()
  points.forEach(([z, y], i) => {
    const [x, v] = px(z, y)
    if (i) p.lineTo(x, v)
    else p.moveTo(x, v)
  })
  p.closePath()
  return p
}

/** Vinyls projected onto the left side (the right side mirrors them). */
function onLeftSide(layer: Layer): boolean {
  return layer.visible && layer.placement.direction[0] < -0.5
}

async function render(content: TemplateContent): Promise<string> {
  const draft = resolveDraft({
    ...content,
    parts: content.parts ?? DEFAULT_PARTS,
    csp: content.csp ?? DEFAULT_CSP,
    meta: content.meta ?? {},
  })
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const body = outline(BODY)

  ctx.save()
  ctx.clip(body)
  ctx.fillStyle = draft.baseColor
  ctx.fillRect(0, 0, W, H)
  for (const layer of draft.design.layers.filter(onLeftSide)) {
    try {
      const raster = await rasterize(layer, draft.design.assets, { maxSize: RASTER })
      const p = layer.placement
      const [x, y] = px(p.position[2], p.position[1])
      const w = p.width * LEN
      const h = p.height * LEN
      ctx.save()
      ctx.globalAlpha = layer.opacity
      ctx.translate(x, y)
      // the rotation is counter-clockwise as the projector sees it, and it looks from where we do
      ctx.rotate((-p.rotation * Math.PI) / 180)
      ctx.drawImage(raster, -w / 2, -h / 2, w, h)
      ctx.restore()
    } catch {
      // a layer that cannot be drawn (a missing image) is left out of the thumbnail
    }
  }
  // light from above
  const shade = ctx.createLinearGradient(0, CY - HEIGHT / 2, 0, CY + HEIGHT / 2)
  shade.addColorStop(0, 'rgba(255,255,255,0.18)')
  shade.addColorStop(0.55, 'rgba(255,255,255,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.3)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(22,27,34,0.92)'
  ctx.fill(outline(GLASS))
  ctx.restore()

  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.lineWidth = 1.5
  ctx.stroke(body)
  for (const z of WHEELS) {
    const [x, y] = px(z, -0.92)
    ctx.beginPath()
    ctx.arc(x, y, WHEEL_RADIUS * 1.12, Math.PI, 0)
    ctx.fillStyle = '#0d0f12'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, WHEEL_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = '#141619'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, WHEEL_RADIUS * 0.62, 0, Math.PI * 2)
    ctx.fillStyle = '#6b7079'
    ctx.fill()
  }
  return canvas.toDataURL('image/png')
}

const thumbnails = new Map<string, Promise<string>>()
const ready = new Map<string, string>()
/** Thumbnails are drawn one after another so the gallery stays responsive. */
let queue: Promise<unknown> = Promise.resolve()

/** A drawn thumbnail, if there is one already. */
export function cachedThumbnail(id: string): string | null {
  return ready.get(id) ?? null
}

/** Thumbnail of a built-in template (drawn once, then cached). */
export function templateThumbnail(id: string, build: () => TemplateContent): Promise<string> {
  let p = thumbnails.get(id)
  if (!p) {
    p = queue.then(() => render(build()))
    queue = p.catch(() => undefined)
    thumbnails.set(id, p)
    void p.then((url) => ready.set(id, url)).catch(() => thumbnails.delete(id))
  }
  return p
}

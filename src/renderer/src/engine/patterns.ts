// Draws pattern fills (see @shared/design/patterns) into a canvas. Vector
// patterns are drawn as paths in the pattern's own turned frame; generated
// ones (camo, tiger) are computed per pixel at a capped resolution.

import { cellRandom, fadeFactor, fbm, random, type PatternFill } from '@shared/design/patterns'

/** Pixels computed per generated pattern; the result is scaled up to the canvas. */
const PIXEL_BUDGET = 600_000

interface Frame {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  /** Cell size in pixels. */
  c: number
  /** Half-extent that covers the canvas whatever the angle. */
  r: number
  cos: number
  sin: number
  fill: PatternFill
  color: string
}

/** Canvas x (0..1 across the layer) of a point in the pattern frame. */
function canvasX(f: Frame, u: number, v: number): number {
  return (f.w / 2 + u * f.cos - v * f.sin) / f.w
}

function fadeAt(f: Frame, u: number, v: number): number {
  return fadeFactor(f.fill.fade, canvasX(f, u, v))
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return a.map((x, i) => Math.round(x + (b[i]! - x) * t)) as [number, number, number]
}

function css([r, g, b]: [number, number, number], a = 1): string {
  return `rgba(${r},${g},${b},${a})`
}

/** Grid indices covering [-r, r] with the given step. */
function range(r: number, step: number): number[] {
  const n = Math.ceil(r / step) + 1
  return Array.from({ length: n * 2 + 1 }, (_, i) => i - n)
}

/**
 * A band along u around the curve v = y(u), as thick as `thickness(u, v)`:
 * stripes, zigzags and waves that thin out where the pattern fades.
 */
function band(
  f: Frame,
  from: number,
  to: number,
  step: number,
  y: (u: number) => number,
  thickness: (u: number, v: number) => number,
  slope?: number,
): void {
  const top: [number, number][] = []
  const bottom: [number, number][] = []
  const e = step / 8
  for (let u = from; ; u += step) {
    const x = Math.min(u, to)
    const v = y(x)
    // thickness across the curve, not straight up: slopes would thin it
    const k = slope ?? (y(x + e) - y(x - e)) / (2 * e)
    const t = (thickness(x, v) / 2) * Math.sqrt(1 + k * k)
    top.push([x, v - t])
    bottom.push([x, v + t])
    if (x >= to) break
  }
  const { ctx } = f
  ctx.beginPath()
  top.forEach(([x, v], i) => (i ? ctx.lineTo(x, v) : ctx.moveTo(x, v)))
  for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(bottom[i]![0], bottom[i]![1])
  ctx.closePath()
  ctx.fill()
}

function polygon(ctx: CanvasRenderingContext2D, points: [number, number][]): void {
  ctx.beginPath()
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
}

/** Fills a tile and strokes it hairline-thin so neighbouring tiles leave no seams. */
function tile(ctx: CanvasRenderingContext2D): void {
  ctx.fill()
  ctx.stroke()
}

function hexPoints(x: number, y: number, radius: number): [number, number][] {
  return Array.from({ length: 6 }, (_, k) => {
    const a = ((60 * k - 90) * Math.PI) / 180
    return [x + Math.cos(a) * radius, y + Math.sin(a) * radius] as [number, number]
  })
}

/** Centres of a pointy-top hexagon grid with `c` between neighbours. */
function hexCentres(f: Frame): [number, number][] {
  const radius = f.c / Math.sqrt(3)
  const rowStep = radius * 1.5
  const out: [number, number][] = []
  for (const j of range(f.r, rowStep)) {
    for (const i of range(f.r, f.c)) out.push([i * f.c + (j & 1 ? f.c / 2 : 0), j * rowStep])
  }
  return out
}

const VECTOR: Partial<Record<PatternFill['pattern'], (f: Frame) => void>> = {
  stripes(f) {
    const th = f.fill.weight * f.c
    for (const k of range(f.r, f.c)) {
      const v0 = k * f.c
      if (!f.fill.fade) f.ctx.fillRect(-f.r, v0 - th / 2, f.r * 2, th)
      else
        band(
          f,
          -f.r,
          f.r,
          f.c / 4,
          () => v0,
          (u, v) => th * fadeAt(f, u, v),
        )
    }
  },

  checker(f) {
    const { ctx, c } = f
    for (const j of range(f.r, c)) {
      for (const i of range(f.r, c)) {
        if ((i + j) & 1) continue
        const x = (i + 0.5) * c
        const y = (j + 0.5) * c
        const s = c * fadeAt(f, x, y)
        if (s > 0.5) ctx.fillRect(x - s / 2, y - s / 2, s, s)
      }
    }
  },

  dots(f) {
    const { ctx, c } = f
    const rowStep = c * 0.866
    for (const j of range(f.r, rowStep)) {
      for (const i of range(f.r, c)) {
        const x = i * c + (j & 1 ? c / 2 : 0)
        const y = j * rowStep
        const radius = (f.fill.weight * c * fadeAt(f, x, y)) / 2
        if (radius < 0.4) continue
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  },

  hex(f) {
    const radius = f.c / Math.sqrt(3)
    for (const [x, y] of hexCentres(f)) {
      const s = radius * f.fill.weight * fadeAt(f, x, y)
      if (s < 0.4) continue
      polygon(f.ctx, hexPoints(x, y, s))
      f.ctx.fill()
    }
  },

  honeycomb(f) {
    const { ctx } = f
    const radius = f.c / Math.sqrt(3)
    ctx.lineJoin = 'round'
    for (const [x, y] of hexCentres(f)) {
      const lw = f.fill.weight * f.c * 0.3 * fadeAt(f, x, y)
      if (lw < 0.3) continue
      ctx.lineWidth = lw
      polygon(ctx, hexPoints(x, y, radius))
      ctx.stroke()
    }
  },

  triangles(f) {
    const { ctx, c } = f
    const th = c * 0.866
    ctx.lineWidth = 1.2
    for (const j of range(f.r, th)) {
      for (const i of range(f.r, c / 2)) {
        const x0 = (i * c) / 2
        const y0 = j * th
        const up = ((i + j) & 1) === 0
        const fade = fadeAt(f, x0 + c / 2, y0 + th / 2)
        if (cellRandom(i, j, f.fill.seed) >= f.fill.weight * fade) continue
        polygon(
          ctx,
          up
            ? [
                [x0, y0 + th],
                [x0 + c / 2, y0],
                [x0 + c, y0 + th],
              ]
            : [
                [x0, y0],
                [x0 + c, y0],
                [x0 + c / 2, y0 + th],
              ],
        )
        tile(ctx)
      }
    }
  },

  pixels(f) {
    const { ctx, c } = f
    ctx.lineWidth = 1.2
    for (const j of range(f.r, c)) {
      for (const i of range(f.r, c)) {
        const fade = fadeAt(f, (i + 0.5) * c, (j + 0.5) * c)
        if (cellRandom(i, j, f.fill.seed) >= f.fill.weight * fade) continue
        ctx.beginPath()
        ctx.rect(i * c, j * c, c, c)
        tile(ctx)
      }
    }
  },

  zigzag(f) {
    const { c } = f
    const amp = c * 0.3
    const th = f.fill.weight * c * 0.6
    const tri = (u: number) => {
      const p = u / c - Math.floor(u / c)
      return (4 * Math.abs(p - 0.5) - 1) * amp
    }
    // start on a corner so that every corner is sampled and stays sharp
    const from = -Math.ceil(f.r / c + 1) * c
    for (const k of range(f.r, c)) {
      const v0 = k * c
      band(
        f,
        from,
        f.r + c,
        c / 8,
        (u) => v0 + tri(u),
        (u, v) => th * fadeAt(f, u, v),
        (4 * amp) / c,
      )
    }
  },

  waves(f) {
    const { c } = f
    const amp = c * 0.25
    const th = f.fill.weight * c * 0.6
    for (const k of range(f.r, c)) {
      const v0 = k * c
      band(
        f,
        -f.r - c,
        f.r + c,
        c / 16,
        (u) => v0 + Math.sin((u / c) * Math.PI * 2) * amp,
        (u, v) => th * fadeAt(f, u, v),
      )
    }
  },

  speed(f) {
    const { c } = f
    const rnd = random(f.fill.seed)
    const row = c * 0.7
    for (const k of range(f.r, row)) {
      const v0 = (k + (rnd() - 0.5) * 0.4) * row
      const th = f.fill.weight * c * 0.45 * (0.5 + rnd())
      let u = -f.r - rnd() * c * 8
      while (u < f.r) {
        const len = c * (4 + rnd() * 10)
        const end = u + len
        // dashes taper to a point at their right end (the tail on a side)
        if (rnd() < 0.8) {
          band(
            f,
            u,
            end,
            len / 12,
            () => v0,
            (x, v) => th * fadeAt(f, x, v) * Math.min(1, ((end - x) / len) * 2.5),
          )
        }
        u = end + c * (1 + rnd() * 4)
      }
    }
  },

  splatter(f) {
    const { ctx, c } = f
    const rnd = random(f.fill.seed)
    const area = (f.r * 2) ** 2
    const count = Math.min(4000, Math.round((area / (c * c)) * (0.3 + 1.7 * f.fill.weight)))
    for (let n = 0; n < count; n++) {
      const x = (rnd() * 2 - 1) * f.r
      const y = (rnd() * 2 - 1) * f.r
      const radius = c * (0.04 + 0.5 * rnd() ** 4) * fadeAt(f, x, y)
      const satellites = Math.floor(rnd() * 5)
      if (radius < 0.4) continue
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      // a lumpy outline: a few smaller circles on the rim
      for (let k = 0; k < 4; k++) {
        const a = rnd() * Math.PI * 2
        const d = radius * (0.5 + rnd() * 0.4)
        ctx.moveTo(x + Math.cos(a) * d + radius * 0.55, y + Math.sin(a) * d)
        ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, radius * 0.55, 0, Math.PI * 2)
      }
      for (let k = 0; k < satellites; k++) {
        const a = rnd() * Math.PI * 2
        const d = radius * (1.4 + rnd() * 1.8)
        const s = radius * (0.08 + rnd() * 0.22)
        ctx.moveTo(x + Math.cos(a) * d + s, y + Math.sin(a) * d)
        ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, s, 0, Math.PI * 2)
      }
      ctx.fill('nonzero')
    }
  },

  carbon(f) {
    const { ctx, c } = f
    const dark = rgb(f.fill.background)
    const light = rgb(f.color)
    // one tow running along u and one across it, drawn once and stamped
    const tiles = [0, 1].map((across) => {
      const size = Math.max(2, Math.ceil(c))
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const t = canvas.getContext('2d')!
      const g = across
        ? t.createLinearGradient(0, 0, size, 0)
        : t.createLinearGradient(0, 0, 0, size)
      const peak = across ? mix(light, dark, 0.35) : light
      g.addColorStop(0, css(dark))
      g.addColorStop(0.5, css(peak))
      g.addColorStop(1, css(dark))
      t.fillStyle = g
      t.fillRect(0, 0, size, size)
      return canvas
    })
    for (const j of range(f.r, c)) {
      for (const i of range(f.r, c)) {
        const a = fadeAt(f, (i + 0.5) * c, (j + 0.5) * c)
        if (a <= 0) continue
        ctx.globalAlpha = a
        ctx.drawImage(tiles[(((i + j) % 4) + 4) % 4 < 2 ? 0 : 1]!, i * c, j * c, c + 0.5, c + 0.5)
      }
    }
    ctx.globalAlpha = 1
  },

  gradient(f) {
    const { ctx } = f
    const half = (Math.abs(f.w * f.cos) + Math.abs(f.h * f.sin)) / 2
    const soft = Math.max(0.02, f.fill.weight)
    const g = ctx.createLinearGradient(-half, 0, half, 0)
    const color = rgb(f.color)
    g.addColorStop(0.5 - soft / 2, css(color, 1))
    g.addColorStop(0.5 + soft / 2, css(color, 0))
    ctx.fillStyle = g
    ctx.fillRect(-f.r, -f.r, f.r * 2, f.r * 2)
  },
}

/** Colour (0..255 RGBA) of one pixel of a generated pattern; null leaves it empty. */
type Shader = (u: number, v: number, x: number) => [number, number, number, number] | null

function tones(f: Frame) {
  const fg = rgb(f.color)
  const bg = rgb(f.fill.background)
  // without a background the middle tone is a shade of the pattern colour:
  // lighter for dark colours, darker for light ones
  const light = (fg[0] * 0.3 + fg[1] * 0.59 + fg[2] * 0.11) / 255 < 0.4
  const mid = f.fill.transparent
    ? mix(fg, light ? [255, 255, 255] : [0, 0, 0], 0.35)
    : mix(fg, bg, 0.5)
  return { fg: [...fg, 255] as const, mid: [...mid, 255] as const }
}

/** Thresholds of the noise for the pattern and middle tones, raised where it fades. */
function thresholds(f: Frame, x: number): [number, number] {
  const fade = fadeFactor(f.fill.fade, x)
  const t1 = 0.6 - (f.fill.weight - 0.5) * 0.3
  const t2 = t1 - 0.11
  return [t1 + (1 - fade) * (1.01 - t1), t2 + (1 - fade) * (1.01 - t2)]
}

const SHADERS: Partial<Record<PatternFill['pattern'], (f: Frame) => Shader>> = {
  camo(f) {
    const { fg, mid } = tones(f)
    const seed = f.fill.seed
    return (u, v, x) => {
      // warp the field so the blobs get ragged, organic edges
      const wu = u / f.c + (fbm(u / f.c + 5.2, v / f.c + 1.3, seed + 31, 1) - 0.5) * 0.9
      const wv = v / f.c + (fbm(u / f.c - 7.1, v / f.c + 9.4, seed + 57, 1) - 0.5) * 0.9
      const n = fbm(wu, wv, seed, 4)
      const [t1, t2] = thresholds(f, x)
      return n > t1 ? [...fg] : n > t2 ? [...mid] : null
    }
  },

  digital(f) {
    const { fg, mid } = tones(f)
    const b = f.c / 6
    return (u, v) => {
      const qu = Math.floor(u / b) + 0.5
      const qv = Math.floor(v / b) + 0.5
      const n = fbm((qu * b) / f.c, (qv * b) / f.c, f.fill.seed, 3)
      const [t1, t2] = thresholds(f, canvasX(f, qu * b, qv * b))
      return n > t1 ? [...fg] : n > t2 ? [...mid] : null
    }
  },

  tiger(f) {
    const fg = rgb(f.color)
    const seed = f.fill.seed
    return (u, v, x) => {
      // stripes run along v and waver; each one swells and tapers to points
      const p = u / f.c + (fbm(u / (f.c * 2), v / (f.c * 1.4), seed, 2) - 0.5) * 1.8
      const k = Math.round(p)
      const d = Math.abs(p - k) * 2
      const swell = fbm(k * 3.7 + 0.5, v / (f.c * 1.1), seed + 7, 2)
      const th = f.fill.weight * 2.2 * (swell - 0.36) * fadeFactor(f.fill.fade, x)
      return d < th ? [...fg, 255] : null
    }
  },
}

function shade(f: Frame, shader: Shader): void {
  const k = Math.min(1, Math.sqrt(PIXEL_BUDGET / (f.w * f.h)))
  const pw = Math.max(1, Math.round(f.w * k))
  const ph = Math.max(1, Math.round(f.h * k))
  const image = new ImageData(pw, ph)
  const data = image.data
  for (let py = 0; py < ph; py++) {
    const dy = (py + 0.5) / k - f.h / 2
    for (let px = 0; px < pw; px++) {
      const dx = (px + 0.5) / k - f.w / 2
      const u = dx * f.cos + dy * f.sin
      const v = -dx * f.sin + dy * f.cos
      const c = shader(u, v, (px + 0.5) / pw)
      if (!c) continue
      const o = (py * pw + px) * 4
      data[o] = c[0]
      data[o + 1] = c[1]
      data[o + 2] = c[2]
      data[o + 3] = c[3]
    }
  }
  const small = document.createElement('canvas')
  small.width = pw
  small.height = ph
  small.getContext('2d')!.putImageData(image, 0, 0)
  f.ctx.setTransform(1, 0, 0, 1, 0, 0)
  f.ctx.imageSmoothingEnabled = true
  f.ctx.imageSmoothingQuality = 'high'
  f.ctx.drawImage(small, 0, 0, f.w, f.h)
}

/**
 * Draws the pattern in `color` over a w x h canvas (the background colour is
 * not drawn: the caller fills the shape with it first).
 */
export function drawPattern(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fill: PatternFill,
  color: string,
): void {
  const angle = (fill.angle * Math.PI) / 180
  const f: Frame = {
    ctx,
    w,
    h,
    c: Math.max(2, fill.size * Math.min(w, h)),
    r: Math.hypot(w, h) / 2,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    fill,
    color,
  }
  f.r += f.c
  ctx.save()
  const shader = SHADERS[fill.pattern]
  if (shader) {
    shade(f, shader(f))
  } else {
    ctx.setTransform(
      Math.cos(angle),
      Math.sin(angle),
      -Math.sin(angle),
      Math.cos(angle),
      w / 2,
      h / 2,
    )
    ctx.fillStyle = color
    ctx.strokeStyle = color
    VECTOR[fill.pattern]?.(f)
  }
  ctx.restore()
}

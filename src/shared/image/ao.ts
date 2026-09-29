// Extracting baked shading (ambient occlusion, panel lines, vents) from a stock
// skin so it can be laid over a new livery with multiply.
//
// The stock texture is roughly `paint colour x shading`. The local paint
// colour is estimated as a blurred local maximum of luminance ("envelope");
// dividing by it leaves the shading. Areas brighter than their surroundings
// clamp to 1, so only darkening is carried over.

export interface AoOptions {
  /** Envelope radius in texels; defaults to ~1/160 of the texture size. */
  radius?: number
}

function luminance(rgba: Uint8Array, count: number): Float32Array {
  const l = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    l[i] = (0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!) / 255
  }
  return l
}

/** Sliding-window maximum along rows (horizontal = true) or columns. */
function maxFilter(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
): Float32Array {
  const out = new Float32Array(src.length)
  const lines = horizontal ? h : w
  const len = horizontal ? w : h
  const idx = (line: number, i: number) => (horizontal ? line * w + i : i * w + line)
  const deque = new Int32Array(len)
  for (let line = 0; line < lines; line++) {
    let head = 0
    let tail = 0
    // window [i - r, i + r]; push elements up to i + r
    let next = 0
    for (let i = 0; i < len; i++) {
      const hi = Math.min(len - 1, i + r)
      while (next <= hi) {
        const v = src[idx(line, next)]!
        while (tail > head && src[idx(line, deque[tail - 1]!)]! <= v) tail--
        deque[tail++] = next
        next++
      }
      while (deque[head]! < i - r) head++
      out[idx(line, i)] = src[idx(line, deque[head]!)]!
    }
  }
  return out
}

/** Box blur along rows or columns using a running sum (edge-clamped). */
function boxBlur(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
): Float32Array {
  const out = new Float32Array(src.length)
  const lines = horizontal ? h : w
  const len = horizontal ? w : h
  const idx = (line: number, i: number) => (horizontal ? line * w + i : i * w + line)
  const at = (line: number, i: number) => src[idx(line, Math.min(len - 1, Math.max(0, i)))]!
  const size = 2 * r + 1
  for (let line = 0; line < lines; line++) {
    let sum = 0
    for (let i = -r; i <= r; i++) sum += at(line, i)
    for (let i = 0; i < len; i++) {
      out[idx(line, i)] = sum / size
      sum += at(line, i + r + 1) - at(line, i - r)
    }
  }
  return out
}

/** Returns one byte per texel: 255 = no darkening, 0 = black. */
export function extractAoDetail(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: AoOptions = {},
): Uint8Array {
  const count = width * height
  const r = Math.max(2, Math.round(options.radius ?? Math.max(width, height) / 160))
  const l = luminance(rgba, count)
  let env = maxFilter(maxFilter(l, width, height, r, true), width, height, r, false)
  env = boxBlur(boxBlur(env, width, height, r, true), width, height, r, false)
  const out = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const d = l[i]! / Math.max(env[i]!, 0.04)
    out[i] = Math.round(Math.min(1, Math.max(0, d)) * 255)
  }
  return out
}

/**
 * How suitable a skin is as the AO source: bright, unsaturated paint (a white
 * or grey livery) keeps the fewest colour artefacts. Only texels where
 * `mask` is non-zero are considered. Higher is better.
 */
export function aoSourceScore(rgba: Uint8Array, mask: Uint8Array | null): number {
  let lum = 0
  let sat = 0
  let n = 0
  const count = rgba.length / 4
  for (let i = 0; i < count; i++) {
    if (mask && !mask[i]) continue
    const r = rgba[i * 4]! / 255
    const g = rgba[i * 4 + 1]! / 255
    const b = rgba[i * 4 + 2]! / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    lum += 0.299 * r + 0.587 * g + 0.114 * b
    sat += max > 0 ? (max - min) / max : 0
    n++
  }
  if (n === 0) return -Infinity
  return lum / n - 1.5 * (sat / n)
}

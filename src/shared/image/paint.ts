// Finds the paint colour of a part texture (rims, calipers) so a recolour can
// keep its shading and leave logos alone.

export interface PaintReference {
  /** Normalised RGB of the dominant hue. */
  direction: [number, number, number]
  luminance: number
}

/**
 * Dominant hue of an RGBA8 image and the median luminance of its pixels.
 * The hue is re-estimated twice from the pixels close to it, so logos and
 * lettering do not pull it away.
 */
export function measurePaint(rgba: Uint8Array): PaintReference {
  const pixels: { d: [number, number, number]; lum: number }[] = []
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]! / 255
    const g = rgba[i + 1]! / 255
    const b = rgba[i + 2]! / 255
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    const len = Math.hypot(r, g, b)
    if (lum < 0.06 || len < 1e-4) continue
    pixels.push({ d: [r / len, g / len, b / len], lum })
  }
  const grey: [number, number, number] = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]
  if (!pixels.length) return { direction: grey, luminance: 0.08 }
  const average = (list: typeof pixels): [number, number, number] => {
    const s = [0, 0, 0]
    for (const p of list) for (let k = 0; k < 3; k++) s[k]! += p.d[k]!
    const len = Math.hypot(s[0]!, s[1]!, s[2]!) || 1
    return [s[0]! / len, s[1]! / len, s[2]! / len]
  }
  const near = (d: [number, number, number], cos: number) =>
    pixels.filter((p) => p.d[0] * d[0] + p.d[1] * d[1] + p.d[2] * d[2] >= cos)
  let direction = average(pixels)
  for (const cos of [0.9, 0.95]) {
    const close = near(direction, cos)
    if (close.length) direction = average(close)
  }
  const values = near(direction, 0.95)
    .map((p) => p.lum)
    .sort((a, b) => a - b)
  const median = values.length ? values[Math.floor(values.length / 2)]! : 0.5
  // very dark sources would blow every highlight up to white
  return { direction, luminance: Math.max(0.08, median) }
}

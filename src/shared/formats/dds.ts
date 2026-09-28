// DirectDraw Surface (.dds) reading, CPU decoding and writing.
//
// Decoding covers what Assetto Corsa content commonly uses (BC1/2/3, BC4/5,
// 8-bit uncompressed). BC7 and anything else is left to the GPU: the renderer
// uploads the compressed data as-is and reads pixels back when needed.

import { FormatError } from './binary'

export type DdsFormat =
  | 'BC1'
  | 'BC2'
  | 'BC3'
  | 'BC4'
  | 'BC5'
  | 'BC6H'
  | 'BC7'
  | 'BGRA8'
  | 'BGRX8'
  | 'RGBA8'
  | 'BGR8'
  | 'L8'
  | 'A8'
  | 'L8A8'

export interface DdsMip {
  width: number
  height: number
  data: Uint8Array
}

export interface DdsImage {
  format: DdsFormat
  width: number
  height: number
  srgb: boolean
  /** Mip levels of the first face / array slice, largest first. */
  mips: DdsMip[]
}

const DDS_MAGIC = 0x20534444
const DDPF_ALPHAPIXELS = 0x1
const DDPF_ALPHA = 0x2
const DDPF_FOURCC = 0x4
const DDPF_RGB = 0x40
const DDPF_LUMINANCE = 0x20000
const DDSCAPS2_CUBEMAP = 0x200

function fourCC(s: string): number {
  return (
    s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)
  )
}

const FOURCC_FORMATS: Record<number, DdsFormat> = {
  [fourCC('DXT1')]: 'BC1',
  [fourCC('DXT2')]: 'BC2',
  [fourCC('DXT3')]: 'BC2',
  [fourCC('DXT4')]: 'BC3',
  [fourCC('DXT5')]: 'BC3',
  [fourCC('ATI1')]: 'BC4',
  [fourCC('BC4U')]: 'BC4',
  [fourCC('ATI2')]: 'BC5',
  [fourCC('BC5U')]: 'BC5',
}

const DXGI_FORMATS: Record<number, [DdsFormat, boolean]> = {
  28: ['RGBA8', false],
  29: ['RGBA8', true],
  61: ['L8', false],
  65: ['A8', false],
  71: ['BC1', false],
  72: ['BC1', true],
  74: ['BC2', false],
  75: ['BC2', true],
  77: ['BC3', false],
  78: ['BC3', true],
  80: ['BC4', false],
  83: ['BC5', false],
  87: ['BGRA8', false],
  88: ['BGRX8', false],
  91: ['BGRA8', true],
  93: ['BGRX8', true],
  95: ['BC6H', false],
  96: ['BC6H', false],
  98: ['BC7', false],
  99: ['BC7', true],
}

export function isBlockCompressed(format: DdsFormat): boolean {
  return format.startsWith('BC')
}

export function blockBytes(format: DdsFormat): number {
  return format === 'BC1' || format === 'BC4' ? 8 : 16
}

export function bytesPerPixel(format: DdsFormat): number {
  switch (format) {
    case 'BGRA8':
    case 'BGRX8':
    case 'RGBA8':
      return 4
    case 'BGR8':
      return 3
    case 'L8A8':
      return 2
    default:
      return 1
  }
}

export function mipByteSize(format: DdsFormat, width: number, height: number): number {
  if (isBlockCompressed(format)) {
    return (
      Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * blockBytes(format)
    )
  }
  return width * height * bytesPerPixel(format)
}

export function isDds(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) === DDS_MAGIC
  )
}

function legacyFormat(
  flags: number,
  cc: number,
  bits: number,
  r: number,
  g: number,
  b: number,
  a: number,
): DdsFormat {
  if (flags & DDPF_FOURCC) {
    const f = FOURCC_FORMATS[cc]
    if (!f) {
      const s = String.fromCharCode(cc & 0xff, (cc >> 8) & 0xff, (cc >> 16) & 0xff, cc >>> 24)
      throw new FormatError(`Unsupported DDS FourCC "${s}"`)
    }
    return f
  }
  if (flags & DDPF_RGB) {
    if (bits === 32) {
      if (r === 0x00ff0000 && g === 0x0000ff00 && b === 0x000000ff) {
        return flags & DDPF_ALPHAPIXELS && a === 0xff000000 ? 'BGRA8' : 'BGRX8'
      }
      if (r === 0x000000ff && g === 0x0000ff00 && b === 0x00ff0000) return 'RGBA8'
    }
    if (bits === 24 && r === 0xff0000 && g === 0x00ff00 && b === 0x0000ff) return 'BGR8'
  }
  if (flags & DDPF_LUMINANCE) {
    if (bits === 8) return 'L8'
    if (bits === 16 && flags & DDPF_ALPHAPIXELS) return 'L8A8'
  }
  if (flags & DDPF_ALPHA && bits === 8) return 'A8'
  throw new FormatError(
    `Unsupported DDS pixel format (flags=0x${flags.toString(16)}, bits=${bits}, masks=` +
      `${[r, g, b, a].map((m) => m.toString(16)).join('/')})`,
  )
}

export function parseDds(bytes: Uint8Array): DdsImage {
  if (bytes.byteLength < 128 || !isDds(bytes)) throw new FormatError('Not a DDS file')
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u32 = (o: number) => v.getUint32(o, true)
  const height = u32(12)
  const width = u32(16)
  const mipCount = Math.max(1, u32(28))
  const pfFlags = u32(80)
  const cc = u32(84)
  const caps2 = u32(112)
  let offset = 128
  let format: DdsFormat
  let srgb = false
  if (pfFlags & DDPF_FOURCC && cc === fourCC('DX10')) {
    if (bytes.byteLength < 148) throw new FormatError('Truncated DX10 header')
    const dxgi = u32(128)
    const entry = DXGI_FORMATS[dxgi]
    if (!entry) throw new FormatError(`Unsupported DXGI format ${dxgi}`)
    ;[format, srgb] = entry
    offset = 148
  } else {
    format = legacyFormat(pfFlags, cc, u32(88), u32(92), u32(96), u32(100), u32(104))
  }
  if (width === 0 || height === 0 || width > 32768 || height > 32768) {
    throw new FormatError(`Invalid DDS size ${width}x${height}`)
  }

  const mips: DdsMip[] = []
  let w = width
  let h = height
  for (let i = 0; i < mipCount; i++) {
    const size = mipByteSize(format, w, h)
    if (offset + size > bytes.byteLength) {
      if (i === 0) throw new FormatError('Truncated DDS data')
      break // tolerate files that declare more mips than they contain
    }
    mips.push({ width: w, height: h, data: bytes.subarray(offset, offset + size) })
    offset += size
    w = Math.max(1, w >> 1)
    h = Math.max(1, h >> 1)
  }
  void (caps2 & DDSCAPS2_CUBEMAP) // cubemaps: only the first face is exposed
  return { format, width, height, srgb, mips }
}

// ---------------------------------------------------------------------------
// CPU decoding to RGBA8

export function canDecodeOnCpu(format: DdsFormat): boolean {
  return format !== 'BC6H' && format !== 'BC7'
}

/** Decodes one mip level into tightly packed RGBA8. */
export function decodeDdsMip(format: DdsFormat, mip: DdsMip): Uint8Array {
  const { width, height, data } = mip
  const out = new Uint8Array(width * height * 4)
  switch (format) {
    case 'BC1':
    case 'BC2':
    case 'BC3':
    case 'BC4':
    case 'BC5':
      decodeBlocks(format, width, height, data, out)
      return out
    case 'BGRA8':
    case 'BGRX8':
      for (let i = 0; i < width * height; i++) {
        out[i * 4] = data[i * 4 + 2]!
        out[i * 4 + 1] = data[i * 4 + 1]!
        out[i * 4 + 2] = data[i * 4]!
        out[i * 4 + 3] = format === 'BGRA8' ? data[i * 4 + 3]! : 255
      }
      return out
    case 'RGBA8':
      out.set(data.subarray(0, out.length))
      return out
    case 'BGR8':
      for (let i = 0; i < width * height; i++) {
        out[i * 4] = data[i * 3 + 2]!
        out[i * 4 + 1] = data[i * 3 + 1]!
        out[i * 4 + 2] = data[i * 3]!
        out[i * 4 + 3] = 255
      }
      return out
    case 'L8':
    case 'A8':
      for (let i = 0; i < width * height; i++) {
        const l = data[i]!
        if (format === 'L8') {
          out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = l
          out[i * 4 + 3] = 255
        } else {
          out[i * 4 + 3] = l
        }
      }
      return out
    case 'L8A8':
      for (let i = 0; i < width * height; i++) {
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = data[i * 2]!
        out[i * 4 + 3] = data[i * 2 + 1]!
      }
      return out
    default:
      throw new FormatError(`CPU decoding of ${format} is not supported`)
  }
}

function unpack565(c: number, out: number[], o: number): void {
  const r = (c >> 11) & 31
  const g = (c >> 5) & 63
  const b = c & 31
  out[o] = (r << 3) | (r >> 2)
  out[o + 1] = (g << 2) | (g >> 4)
  out[o + 2] = (b << 3) | (b >> 2)
}

/** Decodes a BC1 color block into 16 RGBA pixels. */
function decodeColorBlock(
  data: Uint8Array,
  o: number,
  pixels: Uint8Array,
  forceFourColor: boolean,
): void {
  const c0 = data[o]! | (data[o + 1]! << 8)
  const c1 = data[o + 2]! | (data[o + 3]! << 8)
  const pal: number[] = new Array(16).fill(255)
  unpack565(c0, pal, 0)
  unpack565(c1, pal, 4)
  if (c0 > c1 || forceFourColor) {
    for (let k = 0; k < 3; k++) {
      pal[8 + k] = Math.round((2 * pal[k]! + pal[4 + k]!) / 3)
      pal[12 + k] = Math.round((pal[k]! + 2 * pal[4 + k]!) / 3)
    }
  } else {
    for (let k = 0; k < 3; k++) {
      pal[8 + k] = Math.round((pal[k]! + pal[4 + k]!) / 2)
      pal[12 + k] = 0
    }
    pal[15] = 0
  }
  const bits = data[o + 4]! | (data[o + 5]! << 8) | (data[o + 6]! << 16) | (data[o + 7]! << 24)
  for (let i = 0; i < 16; i++) {
    const idx = (bits >>> (i * 2)) & 3
    pixels[i * 4] = pal[idx * 4]!
    pixels[i * 4 + 1] = pal[idx * 4 + 1]!
    pixels[i * 4 + 2] = pal[idx * 4 + 2]!
    pixels[i * 4 + 3] = pal[idx * 4 + 3]!
  }
}

/** Decodes a BC4 single-channel block into 16 values written with the given stride. */
function decodeAlphaBlock(data: Uint8Array, o: number, pixels: Uint8Array, channel: number): void {
  const a0 = data[o]!
  const a1 = data[o + 1]!
  const pal = [a0, a1, 0, 0, 0, 0, 0, 0]
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) pal[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7)
  } else {
    for (let i = 1; i < 5; i++) pal[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5)
    pal[6] = 0
    pal[7] = 255
  }
  // 48 bits of 3-bit indices
  let lo = data[o + 2]! | (data[o + 3]! << 8) | (data[o + 4]! << 16)
  let hi = data[o + 5]! | (data[o + 6]! << 8) | (data[o + 7]! << 16)
  for (let i = 0; i < 16; i++) {
    let idx: number
    if (i < 8) {
      idx = lo & 7
      lo >>= 3
    } else {
      idx = hi & 7
      hi >>= 3
    }
    pixels[i * 4 + channel] = pal[idx]!
  }
}

function decodeBlocks(
  format: DdsFormat,
  width: number,
  height: number,
  data: Uint8Array,
  out: Uint8Array,
): void {
  const bw = Math.max(1, Math.ceil(width / 4))
  const bh = Math.max(1, Math.ceil(height / 4))
  const size = blockBytes(format)
  const px = new Uint8Array(64)
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * size
      switch (format) {
        case 'BC1':
          decodeColorBlock(data, o, px, false)
          break
        case 'BC2':
          decodeColorBlock(data, o + 8, px, true)
          for (let i = 0; i < 16; i++) {
            const nib = (data[o + (i >> 1)]! >> ((i & 1) * 4)) & 15
            px[i * 4 + 3] = nib * 17
          }
          break
        case 'BC3':
          decodeColorBlock(data, o + 8, px, true)
          decodeAlphaBlock(data, o, px, 3)
          break
        case 'BC4':
          decodeAlphaBlock(data, o, px, 0)
          for (let i = 0; i < 16; i++) {
            px[i * 4 + 1] = px[i * 4 + 2] = px[i * 4]!
            px[i * 4 + 3] = 255
          }
          break
        case 'BC5':
          decodeAlphaBlock(data, o, px, 0)
          decodeAlphaBlock(data, o + 8, px, 1)
          for (let i = 0; i < 16; i++) {
            px[i * 4 + 2] = 0
            px[i * 4 + 3] = 255
          }
          break
        default:
          throw new FormatError(`Unexpected block format ${format}`)
      }
      for (let y = 0; y < 4; y++) {
        const py = by * 4 + y
        if (py >= height) break
        for (let x = 0; x < 4; x++) {
          const pxX = bx * 4 + x
          if (pxX >= width) break
          const src = (y * 4 + x) * 4
          const dst = (py * width + pxX) * 4
          out[dst] = px[src]!
          out[dst + 1] = px[src + 1]!
          out[dst + 2] = px[src + 2]!
          out[dst + 3] = px[src + 3]!
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mipmaps

/** Box-filters RGBA8 down by two (handles odd sizes). */
export function downsampleRgba(src: Uint8Array, width: number, height: number): DdsMip {
  const w = Math.max(1, width >> 1)
  const h = Math.max(1, height >> 1)
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(height - 1, y * 2)
    const y1 = Math.min(height - 1, y * 2 + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(width - 1, x * 2)
      const x1 = Math.min(width - 1, x * 2 + 1)
      const a = (y0 * width + x0) * 4
      const b = (y0 * width + x1) * 4
      const c = (y1 * width + x0) * 4
      const d = (y1 * width + x1) * 4
      const o = (y * w + x) * 4
      for (let k = 0; k < 4; k++) {
        out[o + k] = (src[a + k]! + src[b + k]! + src[c + k]! + src[d + k]! + 2) >> 2
      }
    }
  }
  return { width: w, height: h, data: out }
}

export function buildMipChain(rgba: Uint8Array, width: number, height: number): DdsMip[] {
  const mips: DdsMip[] = [{ width, height, data: rgba }]
  let cur = mips[0]!
  while (cur.width > 1 || cur.height > 1) {
    cur = downsampleRgba(cur.data, cur.width, cur.height)
    mips.push(cur)
  }
  return mips
}

// ---------------------------------------------------------------------------
// Encoding (fallback when texconv is not available)

function pack565(r: number, g: number, b: number): number {
  return (
    (Math.round((r * 31) / 255) << 11) |
    (Math.round((g * 63) / 255) << 5) |
    Math.round((b * 31) / 255)
  )
}

/**
 * Encodes one 4x4 block of RGBA pixels into BC1 color data (always 4-color mode).
 * Endpoints come from the extremes along the principal axis of the block colors.
 */
function encodeColorBlock(px: Uint8Array, out: Uint8Array, o: number): void {
  let mr = 0
  let mg = 0
  let mb = 0
  for (let i = 0; i < 16; i++) {
    mr += px[i * 4]!
    mg += px[i * 4 + 1]!
    mb += px[i * 4 + 2]!
  }
  mr /= 16
  mg /= 16
  mb /= 16
  // covariance
  let rr = 0
  let rg = 0
  let rb = 0
  let gg = 0
  let gb = 0
  let bb = 0
  for (let i = 0; i < 16; i++) {
    const r = px[i * 4]! - mr
    const g = px[i * 4 + 1]! - mg
    const b = px[i * 4 + 2]! - mb
    rr += r * r
    rg += r * g
    rb += r * b
    gg += g * g
    gb += g * b
    bb += b * b
  }
  // power iteration for the dominant axis
  let ax = 1
  let ay = 1
  let az = 1
  for (let k = 0; k < 8; k++) {
    const nx = rr * ax + rg * ay + rb * az
    const ny = rg * ax + gg * ay + gb * az
    const nz = rb * ax + gb * ay + bb * az
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-6) break
    ax = nx / len
    ay = ny / len
    az = nz / len
  }
  let minT = Infinity
  let maxT = -Infinity
  for (let i = 0; i < 16; i++) {
    const t = (px[i * 4]! - mr) * ax + (px[i * 4 + 1]! - mg) * ay + (px[i * 4 + 2]! - mb) * az
    if (t < minT) minT = t
    if (t > maxT) maxT = t
  }
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  let c0 = pack565(clamp(mr + ax * maxT), clamp(mg + ay * maxT), clamp(mb + az * maxT))
  let c1 = pack565(clamp(mr + ax * minT), clamp(mg + ay * minT), clamp(mb + az * minT))
  if (c0 < c1) [c0, c1] = [c1, c0]
  const pal: number[] = new Array(16).fill(0)
  unpack565(c0, pal, 0)
  unpack565(c1, pal, 4)
  for (let k = 0; k < 3; k++) {
    pal[8 + k] = Math.round((2 * pal[k]! + pal[4 + k]!) / 3)
    pal[12 + k] = Math.round((pal[k]! + 2 * pal[4 + k]!) / 3)
  }
  let bits = 0
  if (c0 !== c1) {
    for (let i = 0; i < 16; i++) {
      let best = 0
      let bestD = Infinity
      for (let p = 0; p < 4; p++) {
        const dr = px[i * 4]! - pal[p * 4]!
        const dg = px[i * 4 + 1]! - pal[p * 4 + 1]!
        const db = px[i * 4 + 2]! - pal[p * 4 + 2]!
        const d = dr * dr + dg * dg + db * db
        if (d < bestD) {
          bestD = d
          best = p
        }
      }
      bits |= best << (i * 2)
    }
  }
  out[o] = c0 & 0xff
  out[o + 1] = c0 >> 8
  out[o + 2] = c1 & 0xff
  out[o + 3] = c1 >> 8
  out[o + 4] = bits & 0xff
  out[o + 5] = (bits >>> 8) & 0xff
  out[o + 6] = (bits >>> 16) & 0xff
  out[o + 7] = (bits >>> 24) & 0xff
}

function encodeAlphaBlock(px: Uint8Array, out: Uint8Array, o: number): void {
  let a0 = 0
  let a1 = 255
  for (let i = 0; i < 16; i++) {
    const a = px[i * 4 + 3]!
    if (a > a0) a0 = a
    if (a < a1) a1 = a
  }
  out[o] = a0
  out[o + 1] = a1
  const pal = [a0, a1, 0, 0, 0, 0, 0, 0]
  for (let i = 1; i < 7; i++) pal[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7)
  let lo = 0
  let hi = 0
  for (let i = 0; i < 16; i++) {
    const a = px[i * 4 + 3]!
    let best = 0
    let bestD = Infinity
    if (a0 !== a1) {
      for (let p = 0; p < 8; p++) {
        const d = Math.abs(a - pal[p]!)
        if (d < bestD) {
          bestD = d
          best = p
        }
      }
    }
    if (i < 8) lo |= best << (i * 3)
    else hi |= best << ((i - 8) * 3)
  }
  out[o + 2] = lo & 0xff
  out[o + 3] = (lo >> 8) & 0xff
  out[o + 4] = (lo >> 16) & 0xff
  out[o + 5] = hi & 0xff
  out[o + 6] = (hi >> 8) & 0xff
  out[o + 7] = (hi >> 16) & 0xff
}

/** Encodes RGBA8 into BC1 (no alpha) or BC3 (with alpha). */
export function encodeBc(
  format: 'BC1' | 'BC3',
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const bw = Math.max(1, Math.ceil(width / 4))
  const bh = Math.max(1, Math.ceil(height / 4))
  const size = format === 'BC1' ? 8 : 16
  const out = new Uint8Array(bw * bh * size)
  const px = new Uint8Array(64)
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      for (let y = 0; y < 4; y++) {
        const sy = Math.min(height - 1, by * 4 + y)
        for (let x = 0; x < 4; x++) {
          const sx = Math.min(width - 1, bx * 4 + x)
          const s = (sy * width + sx) * 4
          const d = (y * 4 + x) * 4
          px[d] = rgba[s]!
          px[d + 1] = rgba[s + 1]!
          px[d + 2] = rgba[s + 2]!
          px[d + 3] = rgba[s + 3]!
        }
      }
      const o = (by * bw + bx) * size
      if (format === 'BC1') {
        encodeColorBlock(px, out, o)
      } else {
        encodeAlphaBlock(px, out, o)
        encodeColorBlock(px, out, o + 8)
      }
    }
  }
  return out
}

export type DdsWriteFormat = 'BC1' | 'BC3' | 'BGRA8'

/**
 * Writes a 2D texture with a full mip chain generated from RGBA8 input.
 * Uses the legacy header (no DX10 extension) for maximum compatibility.
 */
export function writeDds(
  rgba: Uint8Array,
  width: number,
  height: number,
  format: DdsWriteFormat,
  withMips = true,
): Uint8Array {
  const chain = withMips ? buildMipChain(rgba, width, height) : [{ width, height, data: rgba }]
  const payloads = chain.map((m) => {
    if (format === 'BGRA8') {
      const d = new Uint8Array(m.width * m.height * 4)
      for (let i = 0; i < m.width * m.height; i++) {
        d[i * 4] = m.data[i * 4 + 2]!
        d[i * 4 + 1] = m.data[i * 4 + 1]!
        d[i * 4 + 2] = m.data[i * 4]!
        d[i * 4 + 3] = m.data[i * 4 + 3]!
      }
      return d
    }
    return encodeBc(format, m.data, m.width, m.height)
  })
  const total = 128 + payloads.reduce((s, p) => s + p.byteLength, 0)
  const out = new Uint8Array(total)
  const v = new DataView(out.buffer)
  const set = (o: number, x: number) => v.setUint32(o, x >>> 0, true)
  const compressed = format !== 'BGRA8'
  set(0, DDS_MAGIC)
  set(4, 124)
  // CAPS | HEIGHT | WIDTH | PIXELFORMAT | (LINEARSIZE or PITCH) | MIPMAPCOUNT
  set(8, 0x1 | 0x2 | 0x4 | 0x1000 | (compressed ? 0x80000 : 0x8) | (chain.length > 1 ? 0x20000 : 0))
  set(12, height)
  set(16, width)
  set(20, compressed ? payloads[0]!.byteLength : width * 4)
  set(24, 0)
  set(28, chain.length)
  set(76, 32)
  if (compressed) {
    set(80, DDPF_FOURCC)
    set(84, fourCC(format === 'BC1' ? 'DXT1' : 'DXT5'))
  } else {
    set(80, DDPF_RGB | DDPF_ALPHAPIXELS)
    set(88, 32)
    set(92, 0x00ff0000)
    set(96, 0x0000ff00)
    set(100, 0x000000ff)
    set(104, 0xff000000)
  }
  // TEXTURE | (COMPLEX | MIPMAP if mips)
  set(108, 0x1000 | (chain.length > 1 ? 0x8 | 0x400000 : 0))
  let o = 128
  for (const p of payloads) {
    out.set(p, o)
    o += p.byteLength
  }
  return out
}

/** True if any pixel is not fully opaque. */
export function hasTransparency(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return true
  return false
}

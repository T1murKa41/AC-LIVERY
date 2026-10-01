// Draws vinyl layers (shapes, text, images) into canvases that become the
// textures of their projectors.

import { FLAG_PREFIX } from '@shared/design/params'
import { normalizeFill } from '@shared/design/patterns'
import { dataUrlToBytes } from '@shared/design/project'
import { flagDataUrl } from './flags'
import { drawPattern } from './patterns'
import {
  fontAssetId,
  type Asset,
  type Layer,
  type ShapeKind,
  type TextLayer,
} from '@shared/design/types'

const SHAPE_SIZE = 1024
/** Patterns have fine detail: their shapes get more pixels. */
const PATTERN_SIZE = 2048
const TEXT_PX = 256
const IMAGE_MAX = 2048

const images = new Map<string, Promise<HTMLImageElement>>()
const fonts = new Map<string, Promise<string>>()

function loadImage(asset: Asset): Promise<HTMLImageElement> {
  return loadImageUrl(asset.data, asset.name)
}

function loadImageUrl(url: string, name: string): Promise<HTMLImageElement> {
  let p = images.get(url)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Cannot decode image ${name}`))
      img.src = url
    })
    images.set(url, p)
  }
  return p
}

/** CSS font-family for a layer font, registering imported fonts on first use. */
export async function fontFamily(font: string, assets: Record<string, Asset>): Promise<string> {
  const id = fontAssetId(font)
  if (!id) return `"${font}"`
  const asset = assets[id]
  if (!asset) return 'sans-serif'
  let p = fonts.get(asset.data)
  if (!p) {
    const family = `acl-${id}`
    p = (async () => {
      const buffer = dataUrlToBytes(asset.data)
      const face = new FontFace(family, buffer)
      await face.load()
      document.fonts.add(face)
      return `"${family}"`
    })()
    fonts.set(asset.data, p)
  }
  return p
}

function textFont(layer: TextLayer, family: string): string {
  return `${layer.italic ? 'italic ' : ''}${layer.bold ? '700 ' : '400 '}${TEXT_PX}px ${family}, sans-serif`
}

function textPadding(layer: TextLayer): number {
  return Math.ceil(TEXT_PX * (0.12 + layer.outline))
}

function measureText(layer: TextLayer, family: string): { width: number; height: number } {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = textFont(layer, family)
  const m = ctx.measureText(layer.text || ' ')
  const ascent = m.actualBoundingBoxAscent || TEXT_PX * 0.8
  const descent = m.actualBoundingBoxDescent || TEXT_PX * 0.2
  const pad = textPadding(layer)
  return {
    width:
      Math.ceil(Math.max(m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight)) + pad * 2,
    height: Math.ceil(ascent + descent) + pad * 2,
  }
}

/** Width / height of a text layer as it will be drawn. */
export async function textAspect(layer: TextLayer, assets: Record<string, Asset>): Promise<number> {
  const size = measureText(layer, await fontFamily(layer.font, assets))
  return size.width / size.height
}

export async function imageAspect(asset: Asset): Promise<number> {
  const img = await loadImage(asset)
  return (img.naturalWidth || 1) / (img.naturalHeight || 1)
}

function shapePath(shape: ShapeKind, w: number, h: number): Path2D {
  const p = new Path2D()
  const cx = w / 2
  const cy = h / 2
  switch (shape) {
    case 'rect':
      p.rect(0, 0, w, h)
      break
    case 'roundrect':
      p.roundRect(0, 0, w, h, Math.min(w, h) * 0.22)
      break
    case 'circle':
      p.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
      break
    case 'ring':
      p.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
      p.ellipse(cx, cy, w * 0.34, h * 0.34, 0, 0, Math.PI * 2, true)
      break
    case 'triangle':
      p.moveTo(cx, 0)
      p.lineTo(w, h)
      p.lineTo(0, h)
      p.closePath()
      break
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 0.5 : 0.2
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const x = cx + Math.cos(a) * r * w
        const y = cy + Math.sin(a) * r * h + h * 0.05
        if (i === 0) p.moveTo(x, y)
        else p.lineTo(x, y)
      }
      p.closePath()
      break
    }
    case 'arrow':
      p.moveTo(0, h * 0.35)
      p.lineTo(w * 0.6, h * 0.35)
      p.lineTo(w * 0.6, 0)
      p.lineTo(w, cy)
      p.lineTo(w * 0.6, h)
      p.lineTo(w * 0.6, h * 0.65)
      p.lineTo(0, h * 0.65)
      p.closePath()
      break
    case 'chevron':
      p.moveTo(0, 0)
      p.lineTo(w * 0.45, 0)
      p.lineTo(w, cy)
      p.lineTo(w * 0.45, h)
      p.lineTo(0, h)
      p.lineTo(w * 0.55, cy)
      p.closePath()
      break
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3
        const x = cx + (Math.cos(a) * w) / 2
        const y = cy + (Math.sin(a) * h) / 2
        if (i === 0) p.moveTo(x, y)
        else p.lineTo(x, y)
      }
      p.closePath()
      break
  }
  return p
}

/**
 * Everything that changes how a layer looks, but not where it is: two
 * layers with the same key share the same raster.
 */
export function rasterKey(layer: Layer, assets: Record<string, Asset>): string {
  const aspect = (layer.placement.width / layer.placement.height).toFixed(3)
  switch (layer.kind) {
    case 'shape':
      return `shape|${layer.shape}|${layer.color}|${aspect}|${layer.fill ? JSON.stringify(layer.fill) : ''}`
    case 'text':
      return `text|${layer.text}|${layer.font}|${layer.bold}|${layer.italic}|${layer.color}|${layer.outline}|${layer.outlineColor}|${assets[fontAssetId(layer.font) ?? '']?.data.length ?? 0}|${aspect}`
    case 'image':
      return `image|${layer.asset}|${assets[layer.asset]?.data.length ?? 0}|${aspect}`
  }
}

/**
 * Canvas holding content of size w x h centred in a box with the layer's
 * aspect ratio. Text and images keep their proportions when the box does
 * not match them (a template's number slot filled with "7" or "127").
 */
function fitInBox(w: number, h: number, aspect: number) {
  const a = Math.max(0.02, Math.min(50, aspect))
  let width = w
  let height = h
  if (w / h > a) height = w / a
  else width = h * a
  const k = Math.min(1, 8192 / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
    x: ((width - w) / 2) * k,
    y: ((height - h) / 2) * k,
    scale: k,
  }
}

export async function rasterize(
  layer: Layer,
  assets: Record<string, Asset>,
  /** Longest side of shapes in pixels (thumbnails need far fewer). */
  options: { maxSize?: number } = {},
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  switch (layer.kind) {
    case 'shape': {
      const fill = normalizeFill(layer.fill)
      const aspect = Math.max(0.05, Math.min(20, layer.placement.width / layer.placement.height))
      const size = Math.min(fill ? PATTERN_SIZE : SHAPE_SIZE, options.maxSize ?? Infinity)
      canvas.width = aspect >= 1 ? size : Math.max(8, Math.round(size * aspect))
      canvas.height = aspect >= 1 ? Math.max(8, Math.round(size / aspect)) : size
      const path = shapePath(layer.shape, canvas.width, canvas.height)
      if (!fill) {
        ctx.fillStyle = layer.color
        ctx.fill(path, 'evenodd')
        break
      }
      if (!fill.transparent) {
        ctx.fillStyle = fill.background
        ctx.fill(path, 'evenodd')
      }
      const pattern = document.createElement('canvas')
      pattern.width = canvas.width
      pattern.height = canvas.height
      const pctx = pattern.getContext('2d')!
      drawPattern(pctx, canvas.width, canvas.height, fill, layer.color)
      // keep the pattern inside the shape
      pctx.globalCompositeOperation = 'destination-in'
      pctx.fillStyle = '#000'
      pctx.fill(path, 'evenodd')
      ctx.drawImage(pattern, 0, 0)
      break
    }
    case 'text': {
      const family = await fontFamily(layer.font, assets)
      await document.fonts.load(textFont(layer, family), layer.text).catch(() => undefined)
      const size = measureText(layer, family)
      const box = fitInBox(size.width, size.height, layer.placement.width / layer.placement.height)
      canvas.width = box.width
      canvas.height = box.height
      ctx.setTransform(box.scale, 0, 0, box.scale, box.x, box.y)
      ctx.font = textFont(layer, family)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      const x = size.width / 2
      // centre the actual glyph box (not the em box) vertically
      const m = ctx.measureText(layer.text || ' ')
      const baseline =
        size.height / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
      if (layer.outline > 0) {
        ctx.lineJoin = 'round'
        ctx.lineWidth = layer.outline * TEXT_PX * 2
        ctx.strokeStyle = layer.outlineColor
        ctx.strokeText(layer.text, x, baseline)
      }
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, baseline)
      break
    }
    case 'image': {
      const flag = layer.asset.startsWith(FLAG_PREFIX)
      const asset: Asset | undefined = flag
        ? { name: layer.asset, mime: 'image/svg+xml', data: await flagDataUrl(layer.asset) }
        : assets[layer.asset]
      if (!asset) throw new Error(`Missing image ${layer.asset}`)
      const img = await loadImage(asset)
      const w = img.naturalWidth || 512
      const h = img.naturalHeight || 512
      const k = Math.min(1, IMAGE_MAX / Math.max(w, h))
      // vector images are drawn at full size to stay sharp
      const svg = asset.mime.includes('svg')
      const scale = svg ? IMAGE_MAX / Math.max(w, h) : k
      const iw = Math.max(1, Math.round(w * scale))
      const ih = Math.max(1, Math.round(h * scale))
      const box = fitInBox(iw, ih, layer.placement.width / layer.placement.height)
      canvas.width = box.width
      canvas.height = box.height
      ctx.drawImage(img, box.x, box.y, iw * box.scale, ih * box.scale)
      break
    }
  }
  return canvas
}

/** Reads a file into a data: URL. */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

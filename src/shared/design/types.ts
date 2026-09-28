// Livery design: an ordered list of vinyl layers projected onto the car.
//
// Placements are stored relative to the car body (see placement.ts), so the
// same design can be applied to another car.

export type V3 = [number, number, number]

export type ShapeKind =
  'rect' | 'roundrect' | 'circle' | 'ring' | 'triangle' | 'star' | 'arrow' | 'chevron' | 'hexagon'

export const SHAPES: ShapeKind[] = [
  'rect',
  'roundrect',
  'circle',
  'ring',
  'triangle',
  'star',
  'arrow',
  'chevron',
  'hexagon',
]

export type MirrorMode = 'none' | 'readable' | 'flipped'

/**
 * Where a vinyl sits on the car. Everything is expressed in the car frame
 * (left, up, forward) so it survives a change of car:
 * - position: body-normalised coordinates, -1..1 across the body extents
 * - direction: projection direction (from the projector into the car)
 * - width/height: fractions of the body length
 * - depth: how far the projector reaches, as a fraction of the body width
 */
export interface Placement {
  position: V3
  direction: V3
  /** Roll around the projection direction, degrees, counter-clockwise as seen by the projector. */
  rotation: number
  width: number
  height: number
  depth: number
  mirror: MirrorMode
}

interface LayerBase {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  placement: Placement
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape'
  shape: ShapeKind
  color: string
}

export interface TextLayer extends LayerBase {
  kind: 'text'
  text: string
  font: string
  bold: boolean
  italic: boolean
  color: string
  outlineColor: string
  /** Outline width relative to the font size (0 = none). */
  outline: number
}

export interface ImageLayer extends LayerBase {
  kind: 'image'
  asset: string
}

export type Layer = ShapeLayer | TextLayer | ImageLayer

export interface Asset {
  name: string
  mime: string
  /** data: URL, so designs are self-contained JSON */
  data: string
}

export interface Design {
  layers: Layer[]
  assets: Record<string, Asset>
}

export const EMPTY_DESIGN: Design = { layers: [], assets: {} }

let counter = 0
export function newId(prefix = 'l'): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`
}

export const DEFAULT_PLACEMENT: Placement = {
  // on the left side, a bit behind the middle and slightly below the waist
  position: [1, 0, 0],
  direction: [-1, 0, 0],
  rotation: 0,
  width: 0.2,
  height: 0.2,
  depth: 0.5,
  mirror: 'none',
}

export const SYSTEM_FONTS = [
  'Bahnschrift',
  'Arial',
  'Arial Black',
  'Impact',
  'Segoe UI',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Consolas',
]

export function newShapeLayer(
  shape: ShapeKind,
  placement: Placement,
  color = '#ffffff',
): ShapeLayer {
  return {
    id: newId(),
    name: shape,
    kind: 'shape',
    shape,
    color,
    visible: true,
    locked: false,
    opacity: 1,
    placement: { ...placement, height: placement.width },
  }
}

export function newTextLayer(text: string, placement: Placement, aspect: number): TextLayer {
  return {
    id: newId(),
    name: text,
    kind: 'text',
    text,
    font: 'Bahnschrift',
    bold: true,
    italic: false,
    color: '#ffffff',
    outlineColor: '#000000',
    outline: 0,
    visible: true,
    locked: false,
    opacity: 1,
    placement: { ...placement, height: placement.width / aspect },
  }
}

export function newImageLayer(
  asset: string,
  name: string,
  placement: Placement,
  aspect: number,
): ImageLayer {
  return {
    id: newId(),
    name,
    kind: 'image',
    asset,
    visible: true,
    locked: false,
    opacity: 1,
    placement: { ...placement, height: placement.width / aspect },
  }
}

export function duplicateLayer(layer: Layer): Layer {
  const p = layer.placement
  return {
    ...layer,
    id: newId(),
    name: `${layer.name} copy`,
    // nudge the copy so it is visible
    placement: { ...p, position: [p.position[0], p.position[1] - 0.08, p.position[2] + 0.04] },
  }
}

/** Font of a text layer: a system family name or `asset:<id>` for an imported font. */
export const FONT_ASSET_PREFIX = 'asset:'

export function fontAssetId(font: string): string | null {
  return font.startsWith(FONT_ASSET_PREFIX) ? font.slice(FONT_ASSET_PREFIX.length) : null
}

/** Assets referenced by layers (images and imported fonts); everything else is dropped. */
export function pruneAssets(design: Design): Design {
  const used = new Set<string>()
  for (const l of design.layers) {
    if (l.kind === 'image') used.add(l.asset)
    if (l.kind === 'text') {
      const id = fontAssetId(l.font)
      if (id) used.add(id)
    }
  }
  const assets = Object.fromEntries(Object.entries(design.assets).filter(([id]) => used.has(id)))
  return { ...design, assets }
}

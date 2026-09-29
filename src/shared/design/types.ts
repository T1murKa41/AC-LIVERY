// Livery design: an ordered list of vinyl layers projected onto the car.
//
// Placements are stored relative to the car body (see placement.ts), so the
// same design can be applied to another car.

import type { LayerBindings } from './params'

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

/**
 * Surface finish, written into the car's material map (txMaps). The values
 * scale the material's own coefficients: R specular, G glossiness,
 * B reflection.
 */
export type Finish = 'gloss' | 'satin' | 'matte' | 'metallic'
/** Finish of the base paint; 'stock' keeps the map of the base skin. */
export type BaseFinish = 'stock' | Finish
/** Finish of a vinyl; 'base' leaves the map as the base paint has it. */
export type LayerFinish = 'base' | Finish

export const FINISHES: Finish[] = ['gloss', 'satin', 'matte', 'metallic']

export const FINISH_MAPS: Record<Finish, [number, number, number]> = {
  gloss: [1, 1, 1],
  satin: [0.45, 0.35, 0.3],
  matte: [0.1, 0.08, 0.03],
  // broad, strong highlight with full reflections
  metallic: [1, 0.55, 1],
}

interface LayerBase {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  /** Missing in designs saved before finishes existed: same as 'base'. */
  finish?: LayerFinish
  /** Group id; members of a group are always next to each other in the stack. */
  group?: string
  /** Template parameters some properties follow (see params.ts). */
  bindings?: LayerBindings
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

/** Recolour of a separate part (rims, calipers), keeping its shading. */
export interface PartTint {
  enabled: boolean
  color: string
  /** Leave strongly coloured pixels (logos, lettering) as they are. */
  keepLogos: boolean
}

export interface RimsPaint extends PartTint {
  finish: BaseFinish
}

export interface GlassTint {
  enabled: boolean
  color: string
  /** 0 keeps the stock transparency, 1 makes the glass opaque. */
  darkness: number
  /** Also tint glass that is only seen from the cockpit. */
  interior: boolean
}

export interface PartsPaint {
  rims: RimsPaint
  calipers: PartTint
  glass: GlassTint
}

export const DEFAULT_PARTS: PartsPaint = {
  rims: { enabled: false, color: '#1b1c1f', keepLogos: true, finish: 'stock' },
  calipers: { enabled: false, color: '#d7261e', keepLogos: true },
  glass: { enabled: false, color: '#10151c', darkness: 0.45, interior: false },
}

/** Car paint effects of Custom Shaders Patch, written to the skin's ext_config.ini. */
export type CspEffect = 'none' | 'metallic' | 'pearl' | 'chameleon' | 'chrome' | 'matte'
export const CSP_EFFECTS: CspEffect[] = [
  'none',
  'metallic',
  'pearl',
  'chameleon',
  'chrome',
  'matte',
]

export interface CspPaint {
  effect: CspEffect
  /** Metallic flakes, 0..1 (CSP FlakesK). */
  flakes: number
  /** Pearlescent specular, 0..1. */
  pearl: number
  /** Chameleon colours: facing the viewer and at glancing angles. */
  colorA: string
  colorB: string
}

export const DEFAULT_CSP: CspPaint = {
  effect: 'none',
  flakes: 0.3,
  pearl: 0.8,
  colorA: '#33007f',
  colorB: '#ffcc00',
}

export interface LayerGroup {
  name: string
}

export interface Design {
  /** Bottom first. */
  layers: Layer[]
  assets: Record<string, Asset>
  groups?: Record<string, LayerGroup>
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

/**
 * Assets referenced by layers (images and imported fonts) or listed in
 * `keep` (template parameter values); everything else is dropped.
 */
export function pruneAssets(design: Design, keep: Iterable<string> = []): Design {
  const used = new Set<string>(keep)
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

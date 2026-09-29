// Template parameters. A design becomes a template when some of its
// properties are bound to parameters: texts take {placeholders}, colours and
// images take bindings. Filling the parameters (a form now, a table row of a
// league later) resolves the design into plain values.

import type { Asset, Design, Layer, PartsPaint } from './types'

export type ParamKind = 'text' | 'color' | 'image' | 'flag'

/** Value of a flag parameter: `flag:` and an ISO 3166 code (flag-icons naming). */
export const FLAG_PREFIX = 'flag:'

/** English country name for ui_skin.json (what Content Manager shows). */
export function countryName(value: string): string {
  const code = value.startsWith(FLAG_PREFIX) ? value.slice(FLAG_PREFIX.length) : value
  if (!code) return ''
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code.toUpperCase()
  }
}

export interface TemplateParam {
  /** Used in {placeholders} and bindings; the standard ids map to league columns. */
  id: string
  kind: ParamKind
  label: string
  /** Text, #rrggbb colour, an asset id or flag:<code> (empty: no image). */
  default: string
}

export const STANDARD_PARAMS: readonly TemplateParam[] = [
  { id: 'number', kind: 'text', label: 'Number', default: '27' },
  { id: 'driver', kind: 'text', label: 'Driver', default: 'Driver Name' },
  { id: 'team', kind: 'text', label: 'Team', default: 'Team' },
  { id: 'primary', kind: 'color', label: 'Primary colour', default: '#d7261e' },
  { id: 'secondary', kind: 'color', label: 'Secondary colour', default: '#f4f4f2' },
  { id: 'accent', kind: 'color', label: 'Accent colour', default: '#16181b' },
  { id: 'sponsor1', kind: 'image', label: 'Sponsor 1', default: '' },
  { id: 'sponsor2', kind: 'image', label: 'Sponsor 2', default: '' },
  { id: 'sponsor3', kind: 'image', label: 'Sponsor 3', default: '' },
  { id: 'country', kind: 'flag', label: 'Country', default: '' },
]

/** Properties of a layer that can follow a parameter. */
export type LayerBindings = Partial<Record<'color' | 'outlineColor' | 'asset', string>>

/** Draft-level colours that can follow a parameter. */
export type DraftBindingTarget =
  'baseColor' | 'rims' | 'calipers' | 'glass' | 'cspColorA' | 'cspColorB'
export type DraftBindings = Partial<Record<DraftBindingTarget, string>>

const PLACEHOLDER = /\{([a-z0-9_.-]+)\}/gi
const HEX = /^#[0-9a-f]{6}$/i

/** Parameter ids used in a text. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!.toLowerCase())
}

/** Replaces {id} with the parameter's value; unknown placeholders stay as they are. */
export function fillText(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (all, id: string) => values[id.toLowerCase()] ?? all)
}

/** Current value of every parameter: the given value, or its default. */
export function paramValues(
  params: readonly TemplateParam[],
  values: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of params) {
    const v = values[p.id]
    out[p.id] = v !== undefined && (p.kind !== 'color' || HEX.test(v)) ? v : p.default
  }
  return out
}

function boundColor(
  current: string,
  paramId: string | undefined,
  values: Readonly<Record<string, string>>,
): string {
  const v = paramId ? values[paramId] : undefined
  return v && HEX.test(v) ? v : current
}

/** Parameter values as they read inside texts: a flag becomes its country name. */
export function textValues(
  params: readonly TemplateParam[],
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const texts = paramValues(params, values)
  for (const p of params) if (p.kind === 'flag') texts[p.id] = countryName(texts[p.id] ?? '')
  return texts
}

/** A layer with its parameters filled in. */
export function resolveLayer(
  layer: Layer,
  values: Readonly<Record<string, string>>,
  assets: Readonly<Record<string, Asset>>,
): Layer {
  const b = layer.bindings ?? {}
  switch (layer.kind) {
    case 'shape':
      return { ...layer, color: boundColor(layer.color, b.color, values) }
    case 'text':
      return {
        ...layer,
        text: fillText(layer.text, values),
        color: boundColor(layer.color, b.color, values),
        outlineColor: boundColor(layer.outlineColor, b.outlineColor, values),
      }
    case 'image': {
      const asset = b.asset ? values[b.asset] : undefined
      const known = !!asset && (!!assets[asset] || asset.startsWith(FLAG_PREFIX))
      // an empty image parameter hides the slot
      if (b.asset && !known) return { ...layer, visible: false }
      return asset ? { ...layer, asset } : layer
    }
  }
}

export interface ResolvableDraft {
  baseColor: string
  design: Design
  parts: PartsPaint
  csp: { colorA: string; colorB: string }
  meta: Record<string, string>
  params?: TemplateParam[]
  values?: Record<string, string>
  bindings?: DraftBindings
}

/**
 * The draft with every binding and placeholder replaced by the current
 * parameter values: what gets baked and exported.
 */
export function resolveDraft<D extends ResolvableDraft>(draft: D): D {
  const params = draft.params ?? []
  if (!params.length) return draft
  const values = paramValues(params, draft.values)
  const texts = textValues(params, values)
  const b = draft.bindings ?? {}
  const assets = draft.design.assets
  return {
    ...draft,
    baseColor: boundColor(draft.baseColor, b.baseColor, values),
    design: {
      ...draft.design,
      layers: draft.design.layers.map((l) => {
        const r = resolveLayer(l, values, assets)
        return r.kind === 'text' && l.kind === 'text' ? { ...r, text: fillText(l.text, texts) } : r
      }),
    },
    parts: {
      rims: { ...draft.parts.rims, color: boundColor(draft.parts.rims.color, b.rims, values) },
      calipers: {
        ...draft.parts.calipers,
        color: boundColor(draft.parts.calipers.color, b.calipers, values),
      },
      glass: { ...draft.parts.glass, color: boundColor(draft.parts.glass.color, b.glass, values) },
    },
    csp: {
      ...draft.csp,
      colorA: boundColor(draft.csp.colorA, b.cspColorA, values),
      colorB: boundColor(draft.csp.colorB, b.cspColorB, values),
    },
    meta: Object.fromEntries(
      Object.entries(draft.meta).map(([k, v]) => [k, fillText(v, texts)]),
    ) as D['meta'],
  }
}

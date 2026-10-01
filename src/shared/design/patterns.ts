// Pattern fills for shape layers: the shape is filled with a repeating or
// generated pattern instead of a flat colour. The layer colour draws the
// pattern; the background is a second colour or the car showing through.
//
// Sizes are relative to the layer (its shorter side), so a pattern scales
// with its shape like any other vinyl.

export type PatternKind =
  | 'stripes'
  | 'checker'
  | 'dots'
  | 'hex'
  | 'honeycomb'
  | 'triangles'
  | 'pixels'
  | 'zigzag'
  | 'waves'
  | 'speed'
  | 'camo'
  | 'digital'
  | 'tiger'
  | 'splatter'
  | 'carbon'
  | 'gradient'

export const PATTERNS: PatternKind[] = [
  'stripes',
  'checker',
  'dots',
  'hex',
  'honeycomb',
  'triangles',
  'pixels',
  'zigzag',
  'waves',
  'speed',
  'camo',
  'digital',
  'tiger',
  'splatter',
  'carbon',
  'gradient',
]

export interface PatternFill {
  pattern: PatternKind
  /** Second colour, behind the pattern; unused while `transparent`. */
  background: string
  /** Show the paint under the layer instead of the background colour. */
  transparent: boolean
  /** One cell of the pattern, as a fraction of the layer's shorter side. */
  size: number
  /** Line thickness, element size or density (see PATTERN_INFO), 0..1. */
  weight: number
  /** Turn of the pattern inside the shape, degrees. */
  angle: number
  /**
   * -1..1: elements shrink and vanish towards the left (negative) or the
   * right (positive) edge of the layer: halftone, dissolve, fading stripes.
   */
  fade: number
  /** Variant of the generated patterns (camo, splatter, dissolve...). */
  seed: number
}

export interface PatternInfo {
  /** What `weight` changes; null when it changes nothing. */
  weight: 'thickness' | 'size' | 'density' | 'softness' | null
  /** Whether `seed` picks another variant. */
  random: boolean
  /** Whether `size` and `fade` apply. */
  sized: boolean
  fades: boolean
}

const info = (
  weight: PatternInfo['weight'],
  random = false,
  sized = true,
  fades = true,
): PatternInfo => ({ weight, random, sized, fades })

export const PATTERN_INFO: Record<PatternKind, PatternInfo> = {
  stripes: info('thickness'),
  checker: info(null),
  dots: info('size'),
  hex: info('size'),
  honeycomb: info('thickness'),
  triangles: info('density', true),
  pixels: info('density', true),
  zigzag: info('thickness'),
  waves: info('thickness'),
  speed: info('thickness', true),
  camo: info('density', true),
  digital: info('density', true),
  tiger: info('thickness', true),
  splatter: info('density', true),
  carbon: info(null),
  gradient: info('softness', false, false, false),
}

const DEFAULTS: Record<PatternKind, Partial<PatternFill>> = {
  stripes: { size: 0.25, weight: 0.5 },
  checker: { size: 0.25 },
  dots: { size: 0.12, weight: 0.75 },
  hex: { size: 0.2, weight: 0.85 },
  honeycomb: { size: 0.2, weight: 0.25 },
  triangles: { size: 0.22, weight: 0.5 },
  pixels: { size: 0.08, weight: 0.6 },
  zigzag: { size: 0.3, weight: 0.35 },
  waves: { size: 0.3, weight: 0.35 },
  speed: { size: 0.2, weight: 0.3 },
  camo: { size: 0.5, weight: 0.5, transparent: false, background: '#3b4a2f' },
  digital: { size: 0.4, weight: 0.5, transparent: false, background: '#5d6b4a' },
  tiger: { size: 0.35, weight: 0.4 },
  splatter: { size: 0.3, weight: 0.5 },
  carbon: { size: 0.06, transparent: false, background: '#0d0d0f' },
  gradient: { size: 1, weight: 1 },
}

/** A fresh fill of the given pattern with its own sensible defaults. */
export function newFill(pattern: PatternKind): PatternFill {
  return {
    pattern,
    background: '#16181b',
    transparent: true,
    size: 0.25,
    weight: 0.5,
    angle: 0,
    fade: 0,
    seed: 1,
    ...DEFAULTS[pattern],
  }
}

const HEX = /^#[0-9a-f]{6}$/i

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

/** A stored fill made safe to draw; null for anything that is not a known pattern. */
export function normalizeFill(raw: unknown): PatternFill | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Record<keyof PatternFill, unknown>>
  if (typeof r.pattern !== 'string' || !PATTERNS.includes(r.pattern as PatternKind)) return null
  const base = newFill(r.pattern as PatternKind)
  return {
    pattern: base.pattern,
    background:
      typeof r.background === 'string' && HEX.test(r.background) ? r.background : base.background,
    transparent: typeof r.transparent === 'boolean' ? r.transparent : base.transparent,
    size: num(r.size, 0.01, 4, base.size),
    weight: num(r.weight, 0, 1, base.weight),
    angle: num(r.angle, -360, 360, base.angle),
    fade: num(r.fade, -1, 1, base.fade),
    seed: Math.round(num(r.seed, 0, 1e9, base.seed)),
  }
}

/**
 * How big an element at `x` (0 = left edge, 1 = right edge of the layer) is
 * drawn, 0..1, for a fade of -1..1.
 */
export function fadeFactor(fade: number, x: number): number {
  if (!fade) return 1
  const t = fade > 0 ? x : 1 - x
  return Math.min(1, Math.max(0, 1 - Math.abs(fade) * Math.min(1, Math.max(0, t))))
}

/** Small seeded generator (mulberry32): the same seed always draws the same pattern. */
export function random(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable random number in 0..1 for a grid cell. */
export function cellRandom(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Value noise in 0..1, smooth between whole-number lattice points. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const tx = smooth(x - xi)
  const ty = smooth(y - yi)
  const a = cellRandom(xi, yi, seed)
  const b = cellRandom(xi + 1, yi, seed)
  const c = cellRandom(xi, yi + 1, seed)
  const d = cellRandom(xi + 1, yi + 1, seed)
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
}

/** Fractal noise (a few octaves of value noise), about 0..1 with a mean of 0.5. */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, y, seed + i * 101) * amp
    norm += amp
    x = x * 2.03 + 17.1
    y = y * 2.03 - 9.7
    amp *= 0.5
  }
  return sum / norm
}

/** Ready-made pattern vinyls for the "add" gallery. */
export interface PatternPreset {
  id: string
  fill: PatternFill
  /** Pattern colour (the layer colour); white when not given. */
  color?: string
  /** Layer width and height (fractions of the body length). */
  width: number
  height: number
}

function preset(
  id: string,
  pattern: PatternKind,
  patch: Partial<PatternFill> = {},
  extra: Partial<Omit<PatternPreset, 'id' | 'fill'>> = {},
): PatternPreset {
  return { id, fill: { ...newFill(pattern), ...patch }, width: 0.45, height: 0.2, ...extra }
}

export const PATTERN_PRESETS: PatternPreset[] = [
  preset('stripes', 'stripes', { size: 0.34, weight: 0.3 }),
  preset('pinstripes', 'stripes', { size: 0.12, weight: 0.15 }),
  preset('checker', 'checker', { size: 0.34 }),
  preset('checker-fade', 'checker', { size: 0.2, fade: 1 }),
  preset('halftone', 'dots', { size: 0.1, weight: 1, fade: 1 }),
  preset('dots', 'dots', { size: 0.16, weight: 0.6 }),
  preset('hex-fade', 'hex', { size: 0.18, weight: 0.9, fade: 1 }),
  preset('honeycomb', 'honeycomb', { size: 0.22, weight: 0.2 }),
  preset('triangles', 'triangles', { size: 0.25, weight: 0.55 }),
  preset('pixel-fade', 'pixels', { size: 0.07, weight: 0.9, fade: 1 }),
  preset('zigzag', 'zigzag', { size: 0.4, weight: 0.3 }),
  preset('waves', 'waves', { size: 0.4, weight: 0.3 }),
  preset('speed', 'speed', { size: 0.12, weight: 0.35, fade: 0.8 }),
  preset('camo', 'camo', {}, { height: 0.25, color: '#a39a6e' }),
  preset('digital', 'digital', {}, { height: 0.25, color: '#a9ab8c' }),
  preset('tiger', 'tiger', { size: 0.3, angle: 15 }, { height: 0.25, color: '#16181b' }),
  preset('splatter', 'splatter', {}, { width: 0.4, height: 0.25 }),
  preset('carbon', 'carbon', {}, { height: 0.12, color: '#5a5e66' }),
  preset('gradient', 'gradient'),
]

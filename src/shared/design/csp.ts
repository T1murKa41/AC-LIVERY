// Car paint effects for Custom Shaders Patch. A skin can carry its own
// ext_config.ini; the sections below use the car paint templates CSP ships in
// extension/config/cars/common/materials_carpaint.ini, which replace the
// shader of the car paint material with CSP's smCarPaint.

import type { CspEffect, CspPaint } from './types'

export const SKIN_CONFIG_FILE = 'ext_config.ini'

const TEMPLATES: Record<Exclude<CspEffect, 'none'>, string> = {
  metallic: 'Material_CarPaint_Metallic',
  pearl: 'Material_CarPaint_Pearl',
  chameleon: 'Material_CarPaint_Chameleon',
  chrome: 'Material_CarPaint_Chrome',
  matte: 'Material_CarPaint_Matte',
}

const MARKER = '; --- AC Livery: car paint (Custom Shaders Patch) ---'

export interface CspConfigInput {
  paint: CspPaint
  /** Car paint materials of the repainted textures (multimap shaders). */
  materials: string[]
  /**
   * The paint is where the texture's alpha is black (Kunos cars keep the
   * alpha for the detail map): limit the effect to it.
   */
  alphaMask: boolean
  /** ext_config.ini of the base skin, kept above the generated part. */
  base?: string | null
}

const num = (v: number) => (Math.round(Math.min(1, Math.max(0, v)) * 100) / 100).toString()

/** The skin's ext_config.ini, or null when there is nothing to write. */
export function buildCspConfig({
  paint,
  materials,
  alphaMask,
  base,
}: CspConfigInput): string | null {
  if (paint.effect === 'none' || !materials.length) return null
  const lines = [
    MARKER,
    '[INCLUDE: common/materials_carpaint.ini]',
    '',
    `[${TEMPLATES[paint.effect]}]`,
    `Materials = ${materials.join(', ')}`,
  ]
  if (alphaMask) lines.push('UseDiffuseAlphaAsMask = 1')
  if (paint.effect === 'metallic') lines.push(`FlakesK = ${num(paint.flakes)}`)
  if (paint.effect === 'pearl') lines.push(`PearlescentSpecular = ${num(paint.pearl)}`)
  if (paint.effect === 'chameleon') {
    lines.push(`ChameleonColorA = ${paint.colorA}, 0.6`)
    lines.push(`ChameleonColorB = ${paint.colorB}, 1`)
    if (alphaMask) lines.push('UseDiffuseAlphaAsChameleonMask = 1')
  }
  const ours = lines.join('\n') + '\n'
  const kept = base ? stripGenerated(base).trimEnd() : ''
  return kept ? `${kept}\n\n${ours}` : ours
}

/** Removes a part generated earlier, so re-exporting a skin does not stack them. */
export function stripGenerated(config: string): string {
  const i = config.indexOf(MARKER)
  return i < 0 ? config : config.slice(0, i)
}

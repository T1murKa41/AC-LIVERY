import { describe, expect, it } from 'vitest'
import { buildCspConfig } from './csp'
import { DEFAULT_CSP } from './types'

describe('buildCspConfig', () => {
  it('writes nothing without an effect or car paint', () => {
    expect(
      buildCspConfig({ paint: DEFAULT_CSP, materials: ['EXT_Carpaint'], alphaMask: false }),
    ).toBeNull()
    expect(
      buildCspConfig({
        paint: { ...DEFAULT_CSP, effect: 'chrome' },
        materials: [],
        alphaMask: false,
      }),
    ).toBeNull()
  })

  it('uses the CSP car paint templates', () => {
    const ini = buildCspConfig({
      paint: { ...DEFAULT_CSP, effect: 'metallic', flakes: 0.456 },
      materials: ['EXT_Carpaint', 'EXT_Carbon_Carpaint'],
      alphaMask: true,
    })!
    expect(ini).toContain('[INCLUDE: common/materials_carpaint.ini]')
    expect(ini).toContain(
      '[Material_CarPaint_Metallic]\nMaterials = EXT_Carpaint, EXT_Carbon_Carpaint',
    )
    expect(ini).toContain('UseDiffuseAlphaAsMask = 1')
    expect(ini).toContain('FlakesK = 0.46')
  })

  it('sets chameleon colours', () => {
    const ini = buildCspConfig({
      paint: { ...DEFAULT_CSP, effect: 'chameleon', colorA: '#112233', colorB: '#445566' },
      materials: ['Carpaint'],
      alphaMask: false,
    })!
    expect(ini).toContain('[Material_CarPaint_Chameleon]')
    expect(ini).toContain('ChameleonColorA = #112233, 0.6')
    expect(ini).toContain('ChameleonColorB = #445566, 1')
    expect(ini).not.toContain('UseDiffuseAlphaAsMask')
  })

  it('keeps the base skin config and replaces an earlier generated part', () => {
    const base = '[LIGHT_1]\nPOSITION = 0, 1, 2\n'
    const first = buildCspConfig({
      paint: { ...DEFAULT_CSP, effect: 'chrome' },
      materials: ['Carpaint'],
      alphaMask: false,
      base,
    })!
    expect(first.startsWith('[LIGHT_1]')).toBe(true)
    const second = buildCspConfig({
      paint: { ...DEFAULT_CSP, effect: 'matte' },
      materials: ['Carpaint'],
      alphaMask: false,
      base: first,
    })!
    expect(second).toContain('[Material_CarPaint_Matte]')
    expect(second).not.toContain('Material_CarPaint_Chrome')
    expect(second.match(/AC Livery/g)).toHaveLength(1)
  })
})

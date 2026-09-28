import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExportRequest } from '@shared/api'
import { buildSyntheticCar, SYNTHETIC_CAR_ID } from '@shared/fixtures/syntheticCar'
import { parseDds } from '@shared/formats/dds'
import { parseRegValue } from './acRoot'
import { getCar, listCars } from './cars'
import { exportSkin, skinStatus, type Encoders } from './exportSkin'
import { resolveInside } from './paths'
import { builtinDdsEncoder } from './texconv'

let root: string

async function writeCar(): Promise<void> {
  const car = buildSyntheticCar()
  for (const [rel, data] of Object.entries(car.files)) {
    const abs = join(root, 'content', 'cars', SYNTHETIC_CAR_ID, ...rel.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, data)
  }
  // a LOD file and a car without ui json
  await writeFile(join(root, 'content', 'cars', SYNTHETIC_CAR_ID, 'other_lod_b.kn5'), 'x')
  await mkdir(join(root, 'content', 'cars', 'bare_car', 'skins', 'default'), { recursive: true })
}

const encoders: Encoders = {
  dds: builtinDdsEncoder,
  png: () => new Uint8Array([0x89, 0x50]),
  jpeg: () => new Uint8Array([0xff, 0xd8]),
}

function request(overrides: Partial<ExportRequest> = {}): ExportRequest {
  const rgba = new Uint8Array(8 * 8 * 4).fill(255)
  return {
    carId: SYNTHETIC_CAR_ID,
    skinId: 'my_livery',
    textures: [{ name: 'Skin_00.dds', width: 8, height: 8, rgba }],
    encoding: 'auto',
    uiSkin: { skinname: 'Mine', number: '12' },
    previewJpg: new Uint8Array([1, 2, 3]),
    overwrite: 'never',
    ...overrides,
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aclivery-test-'))
  await writeCar()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('cars', () => {
  it('lists cars with names from ui_car.json', async () => {
    const cars = await listCars(root)
    expect(cars.map((c) => c.id).sort()).toEqual(['aclivery_test_coupe', 'bare_car'])
    const coupe = cars.find((c) => c.id === SYNTHETIC_CAR_ID)!
    expect(coupe).toMatchObject({ name: 'AC Livery Test Coupe', kn5: `${SYNTHETIC_CAR_ID}.kn5`, skinCount: 2 })
    expect(cars.find((c) => c.id === 'bare_car')).toMatchObject({ name: 'bare_car', kn5: undefined })
  })

  it('reads skins with their ui_skin.json', async () => {
    const car = await getCar(root, SYNTHETIC_CAR_ID)
    expect(car.skins.map((s) => s.id)).toEqual(['00_white', '01_red_stripe'])
    expect(car.skins[1]!.ui).toMatchObject({ skinname: 'Red Stripe', number: '7' })
    expect(car.skins[0]!.files).toContain('Skin_00.dds')
    expect(car.skins[0]!.ours).toBe(false)
  })
})

describe('exportSkin', () => {
  it('writes textures, metadata and the marker', async () => {
    const result = await exportSkin(root, request(), encoders, '0.1.0')
    expect(result).toMatchObject({ ok: true, encoder: 'builtin' })
    const dir = join(root, 'content', 'cars', SYNTHETIC_CAR_ID, 'skins', 'my_livery')
    expect((await readdir(dir)).sort()).toEqual(
      ['.aclivery.json', 'Skin_00.dds', 'preview.jpg', 'ui_skin.json'].sort(),
    )
    const dds = parseDds(new Uint8Array(await readFile(join(dir, 'Skin_00.dds'))))
    expect(dds.format).toBe('BC1')
    expect(JSON.parse(await readFile(join(dir, 'ui_skin.json'), 'utf8'))).toEqual({
      skinname: 'Mine',
      number: '12',
    })
    expect(await skinStatus(root, SYNTHETIC_CAR_ID, 'my_livery')).toEqual({ exists: true, ours: true })
    // no staging folders left behind
    const skins = await readdir(join(root, 'content', 'cars', SYNTHETIC_CAR_ID, 'skins'))
    expect(skins.filter((s) => s.startsWith('.'))).toEqual([])
  })

  it('uses BC3 when the texture has transparency', async () => {
    const rgba = new Uint8Array(8 * 8 * 4).fill(255)
    rgba[3] = 0
    await exportSkin(root, request({ textures: [{ name: 'Skin_00.dds', width: 8, height: 8, rgba }] }), encoders, '0')
    const file = join(root, 'content', 'cars', SYNTHETIC_CAR_ID, 'skins', 'my_livery', 'Skin_00.dds')
    expect(parseDds(new Uint8Array(await readFile(file))).format).toBe('BC3')
  })

  it('protects existing skins according to the overwrite mode', async () => {
    const foreign = request({ skinId: '00_white' })
    expect(await exportSkin(root, foreign, encoders, '0')).toMatchObject({ ok: false, error: 'exists' })
    expect(await exportSkin(root, { ...foreign, overwrite: 'ours' }, encoders, '0')).toMatchObject({
      ok: false,
      error: 'not-ours',
    })
    expect(await exportSkin(root, request(), encoders, '0')).toMatchObject({ ok: true })
    expect(await exportSkin(root, request({ overwrite: 'ours' }), encoders, '0')).toMatchObject({ ok: true })
    expect(await exportSkin(root, { ...foreign, overwrite: 'always' }, encoders, '0')).toMatchObject({
      ok: true,
    })
  })

  it('rejects unsafe names', async () => {
    expect(await exportSkin(root, request({ skinId: '../evil' }), encoders, '0')).toMatchObject({
      ok: false,
      error: 'invalid-skin-id',
    })
    const bad = request({ textures: [{ name: '../x.dds', width: 1, height: 1, rgba: new Uint8Array(4) }] })
    expect(await exportSkin(root, bad, encoders, '0')).toMatchObject({ ok: false, error: 'io' })
    const skins = await readdir(join(root, 'content', 'cars', SYNTHETIC_CAR_ID, 'skins'))
    expect(skins.sort()).toEqual(['00_white', '01_red_stripe'])
  })

  it('writes png textures through the image encoder', async () => {
    const rgba = new Uint8Array(4 * 4 * 4)
    const result = await exportSkin(root, request({ textures: [{ name: 'decal.png', width: 4, height: 4, rgba }] }), encoders, '0')
    expect(result.ok).toBe(true)
    const file = join(root, 'content', 'cars', SYNTHETIC_CAR_ID, 'skins', 'my_livery', 'decal.png')
    expect([...(await readFile(file))]).toEqual([0x89, 0x50])
  })
})

describe('paths', () => {
  it('keeps paths inside the root', () => {
    expect(resolveInside('/ac', 'content/cars/x/x.kn5')).toBe('/ac/content/cars/x/x.kn5')
    expect(resolveInside('/ac', '/content/cars')).toBe('/ac/content/cars')
    expect(resolveInside('/ac', 'content/../../etc/passwd')).toBeNull()
    expect(resolveInside('/ac', '..\\secret')).toBeNull()
  })
})

describe('registry output', () => {
  it('extracts REG_SZ values', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n'
    expect(parseRegValue(out, 'SteamPath')).toBe('c:/program files (x86)/steam')
    expect(parseRegValue(out, 'Missing')).toBeNull()
  })
})

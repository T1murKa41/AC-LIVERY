// Reading cars and skins from content/cars.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SKIN_MARKER_FILE, type CarDetails, type CarSummary, type SkinInfo } from '@shared/api'
import { asRecord, asString, parseLenientJson } from '@shared/formats/json'
import { parseUiSkin } from '@shared/formats/uiSkin'

interface DirEntry {
  name: string
  dir: boolean
}

async function list(path: string): Promise<DirEntry[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.map((e) => ({ name: e.name, dir: e.isDirectory() }))
  } catch {
    return []
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

const LOD_RE = /_lod_?[b-z]\.kn5$/i

/** Picks the main visual model among the kn5 files of a car folder. */
export async function pickMainKn5(
  carPath: string,
  carId: string,
  kn5Files: string[],
): Promise<string | undefined> {
  const exact = kn5Files.find((f) => f.toLowerCase() === `${carId.toLowerCase()}.kn5`)
  if (exact) return exact
  const candidates = kn5Files.filter((f) => !LOD_RE.test(f) && !/collider/i.test(f))
  let best: string | undefined
  let bestSize = -1
  for (const f of candidates) {
    try {
      const { size } = await stat(join(carPath, f))
      if (size > bestSize) {
        best = f
        bestSize = size
      }
    } catch {
      // ignore unreadable files
    }
  }
  return best
}

async function readCarUi(
  carPath: string,
): Promise<{ name?: string; brand?: string; carClass?: string }> {
  const text = await readText(join(carPath, 'ui', 'ui_car.json'))
  if (!text) return {}
  try {
    const ui = asRecord(parseLenientJson(text))
    return { name: asString(ui.name), brand: asString(ui.brand), carClass: asString(ui.class) }
  } catch {
    return {}
  }
}

async function summarize(root: string, carId: string): Promise<CarDetails> {
  const carPath = join(root, 'content', 'cars', carId)
  const entries = await list(carPath)
  const kn5Files = entries.filter((e) => !e.dir && /\.kn5$/i.test(e.name)).map((e) => e.name)
  const skinDirs = (await list(join(carPath, 'skins'))).filter((e) => e.dir).map((e) => e.name)
  const ui = await readCarUi(carPath)
  return {
    id: carId,
    name: ui.name?.trim() || carId,
    brand: ui.brand,
    carClass: ui.carClass,
    kn5: await pickMainKn5(carPath, carId, kn5Files),
    kn5Files,
    skinCount: skinDirs.length,
    skins: skinDirs.map((id) => ({ id, ui: null, files: [], ours: false })),
  }
}

export async function listCars(root: string): Promise<CarSummary[]> {
  const ids = (await list(join(root, 'content', 'cars'))).filter((e) => e.dir).map((e) => e.name)
  const cars: CarSummary[] = []
  // bounded parallelism keeps big mod folders responsive
  const queue = [...ids]
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const { skins: _skins, kn5Files: _kn5Files, ...summary } = await summarize(root, id)
      cars.push(summary)
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker))
  return cars.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readSkin(skinPath: string, id: string): Promise<SkinInfo> {
  const entries = await list(skinPath)
  const files = entries.filter((e) => !e.dir).map((e) => e.name)
  let ui: SkinInfo['ui'] = null
  const uiName = files.find((f) => f.toLowerCase() === 'ui_skin.json')
  if (uiName) {
    const text = await readText(join(skinPath, uiName))
    try {
      ui = text ? parseUiSkin(text) : null
    } catch {
      ui = null
    }
  }
  return { id, ui, files, ours: files.includes(SKIN_MARKER_FILE) }
}

export async function getCar(root: string, carId: string): Promise<CarDetails> {
  const details = await summarize(root, carId)
  const skinsPath = join(root, 'content', 'cars', carId, 'skins')
  details.skins = await Promise.all(details.skins.map((s) => readSkin(join(skinsPath, s.id), s.id)))
  details.skins.sort((a, b) => a.id.localeCompare(b.id))
  return details
}

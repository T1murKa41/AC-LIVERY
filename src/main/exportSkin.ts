// Writing a finished skin into content/cars/<car>/skins/<skin>/.
//
// The folder is assembled next to the target and swapped in at the end, so a
// failed export never leaves a half-written skin behind. Folders that were not
// created by AC Livery are only replaced with an explicit 'always'.

import { randomBytes } from 'node:crypto'
import { access, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isValidSkinId,
  SKIN_MARKER_FILE,
  type ExportRequest,
  type ExportResult,
  type SkinStatus,
  type TextureEncoding,
} from '@shared/api'
import { hasTransparency } from '@shared/formats/dds'
import { serializeUiSkin } from '@shared/formats/uiSkin'
import { isSafeSegment } from './paths'

export type DdsFormat = 'BC1' | 'BC3' | 'BGRA8'

export interface Encoders {
  dds: {
    name: 'texconv' | 'builtin'
    encode(rgba: Uint8Array, width: number, height: number, format: DdsFormat): Promise<Uint8Array>
  }
  png(rgba: Uint8Array, width: number, height: number): Uint8Array
  jpeg(rgba: Uint8Array, width: number, height: number, quality: number): Uint8Array
}

export interface MarkerFile {
  app: 'AC Livery'
  version: string
  createdAt: string
  car: string
  project?: unknown
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function skinStatus(root: string, carId: string, skinId: string): Promise<SkinStatus> {
  if (!isSafeSegment(carId) || !isValidSkinId(skinId)) return { exists: false, ours: false }
  const dir = join(root, 'content', 'cars', carId, 'skins', skinId)
  const present = await exists(dir)
  return { exists: present, ours: present && (await exists(join(dir, SKIN_MARKER_FILE))) }
}

function pickFormat(encoding: TextureEncoding, rgba: Uint8Array): DdsFormat {
  if (encoding !== 'auto') return encoding
  return hasTransparency(rgba) ? 'BC3' : 'BC1'
}

export async function exportSkin(
  root: string,
  request: ExportRequest,
  encoders: Encoders,
  appVersion: string,
): Promise<ExportResult> {
  const { carId, skinId } = request
  if (!isSafeSegment(carId) || !isValidSkinId(skinId)) {
    return { ok: false, error: 'invalid-skin-id', message: `Invalid skin folder name "${skinId}"` }
  }
  const carPath = join(root, 'content', 'cars', carId)
  if (!(await exists(carPath))) {
    return { ok: false, error: 'io', message: `Car folder not found: ${carId}` }
  }
  const target = join(carPath, 'skins', skinId)
  const status = await skinStatus(root, carId, skinId)
  if (status.exists) {
    if (request.overwrite === 'never') {
      return { ok: false, error: 'exists', message: `Skin "${skinId}" already exists` }
    }
    if (request.overwrite === 'ours' && !status.ours) {
      return {
        ok: false,
        error: 'not-ours',
        message: `Skin "${skinId}" was not created by AC Livery`,
      }
    }
  }

  const warnings: string[] = []
  const suffix = randomBytes(4).toString('hex')
  const staging = join(carPath, 'skins', `.${skinId}.aclivery-${suffix}`)
  try {
    await mkdir(staging, { recursive: true })
    if (request.copyFiles) {
      const { fromSkin, files } = request.copyFiles
      if (!isSafeSegment(fromSkin)) throw new Error(`Invalid source skin "${fromSkin}"`)
      for (const file of files) {
        if (!isSafeSegment(file)) throw new Error(`Invalid file name "${file}"`)
        await copyFile(join(carPath, 'skins', fromSkin, file), join(staging, file))
      }
    }
    for (const tex of request.textures) {
      if (!isSafeSegment(tex.name)) throw new Error(`Invalid texture name "${tex.name}"`)
      if (tex.rgba.byteLength !== tex.width * tex.height * 4) {
        throw new Error(`Texture ${tex.name}: pixel data does not match ${tex.width}x${tex.height}`)
      }
      const ext = tex.name.toLowerCase().split('.').pop()
      let bytes: Uint8Array
      if (ext === 'png') bytes = encoders.png(tex.rgba, tex.width, tex.height)
      else if (ext === 'jpg' || ext === 'jpeg')
        bytes = encoders.jpeg(tex.rgba, tex.width, tex.height, 95)
      else {
        if (ext !== 'dds') warnings.push(`${tex.name}: unknown extension, written as DDS`)
        bytes = await encoders.dds.encode(
          tex.rgba,
          tex.width,
          tex.height,
          pickFormat(request.encoding, tex.rgba),
        )
      }
      await writeFile(join(staging, tex.name), bytes)
    }
    await writeFile(join(staging, 'ui_skin.json'), serializeUiSkin(request.uiSkin))
    if (request.previewJpg) await writeFile(join(staging, 'preview.jpg'), request.previewJpg)
    if (request.liveryPng) await writeFile(join(staging, 'livery.png'), request.liveryPng)
    const marker: MarkerFile = {
      app: 'AC Livery',
      version: appVersion,
      createdAt: new Date().toISOString(),
      car: carId,
      project: request.project,
    }
    await writeFile(join(staging, SKIN_MARKER_FILE), JSON.stringify(marker, null, 2))

    if (status.exists) {
      const old = join(carPath, 'skins', `.${skinId}.aclivery-old-${suffix}`)
      await rename(target, old)
      try {
        await rename(staging, target)
      } catch (err) {
        await rename(old, target)
        throw err
      }
      await rm(old, { recursive: true, force: true })
    } else {
      await rename(staging, target)
    }
    return {
      ok: true,
      path: `content/cars/${carId}/skins/${skinId}`,
      encoder: encoders.dds.name,
      warnings,
    }
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    return { ok: false, error: 'io', message: err instanceof Error ? err.message : String(err) }
  }
}

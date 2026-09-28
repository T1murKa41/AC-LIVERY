// .aclivery project files: a ZIP with project.json and the design's assets
// (images, fonts) stored as plain files instead of data: URLs.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import type { Asset, Design } from './types'

export const PROJECT_EXTENSION = 'aclivery'
export const PROJECT_VERSION = 1
const PROJECT_JSON = 'project.json'
const ASSET_DIR = 'assets/'
const FILE_REF = 'file:'

/** What a project stores: the car it was made on and the editor draft. */
export interface ProjectDoc<D extends { design: Design }> {
  carId: string | null
  draft: D
}

interface StoredProject {
  app: 'AC Livery'
  kind: 'project'
  version: number
  carId: string | null
  draft: unknown
}

/** Decodes a data: URL without fetch(), which the app's CSP blocks for data: URLs. */
export function dataUrlToBytes(url: string): Uint8Array<ArrayBuffer> {
  const comma = url.indexOf(',')
  const meta = url.slice(0, comma)
  const payload = url.slice(comma + 1)
  if (!meta.endsWith(';base64')) return new TextEncoder().encode(decodeURIComponent(payload))
  const bin = atob(payload)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime || 'application/octet-stream'};base64,${btoa(bin)}`
}

function assetFileName(id: string, asset: Asset): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(asset.name)?.[1]?.toLowerCase() ?? 'bin'
  return `${ASSET_DIR}${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`
}

export function packProject<D extends { design: Design }>(doc: ProjectDoc<D>): Uint8Array {
  const files: Zippable = {}
  const assets: Record<string, Asset> = {}
  for (const [id, asset] of Object.entries(doc.draft.design.assets)) {
    if (!asset.data.startsWith('data:')) {
      assets[id] = asset
      continue
    }
    const file = assetFileName(id, asset)
    // images and fonts are compressed already
    files[file] = [dataUrlToBytes(asset.data), { level: 0 }]
    assets[id] = { ...asset, data: `${FILE_REF}${file}` }
  }
  const stored: StoredProject = {
    app: 'AC Livery',
    kind: 'project',
    version: PROJECT_VERSION,
    carId: doc.carId,
    draft: { ...doc.draft, design: { ...doc.draft.design, assets } },
  }
  files[PROJECT_JSON] = strToU8(JSON.stringify(stored, null, 2))
  return zipSync(files, { level: 6 })
}

export class ProjectFormatError extends Error {}

/**
 * Reads a project. The draft comes back as stored (older versions may lack
 * newer fields), with assets turned back into data: URLs.
 */
export function unpackProject(
  bytes: Uint8Array,
): ProjectDoc<{ design: Design } & Record<string, unknown>> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new ProjectFormatError('Not an AC Livery project (not a ZIP archive)')
  }
  const json = files[PROJECT_JSON]
  if (!json) throw new ProjectFormatError('Not an AC Livery project (project.json is missing)')
  let stored: Partial<StoredProject>
  try {
    stored = JSON.parse(strFromU8(json)) as Partial<StoredProject>
  } catch {
    throw new ProjectFormatError('project.json is damaged')
  }
  if (stored.kind !== 'project' || typeof stored.version !== 'number') {
    throw new ProjectFormatError('Not an AC Livery project')
  }
  if (stored.version > PROJECT_VERSION) {
    throw new ProjectFormatError('The project was saved by a newer version of AC Livery')
  }
  const draft = (stored.draft ?? {}) as Record<string, unknown>
  const design = (draft.design ?? {}) as Partial<Design>
  const assets: Record<string, Asset> = {}
  for (const [id, asset] of Object.entries(design.assets ?? {})) {
    if (!asset || typeof asset.data !== 'string') continue
    if (!asset.data.startsWith(FILE_REF)) {
      assets[id] = asset
      continue
    }
    const data = files[asset.data.slice(FILE_REF.length)]
    if (!data) continue
    assets[id] = { ...asset, data: bytesToDataUrl(data, asset.mime) }
  }
  return {
    carId: typeof stored.carId === 'string' ? stored.carId : null,
    draft: {
      ...draft,
      design: { layers: Array.isArray(design.layers) ? design.layers : [], assets },
    },
  }
}

/** File name for a project, derived from the livery name. */
export function projectFileName(name: string): string {
  const base =
    name
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'livery'
  return `${base.slice(0, 80)}.${PROJECT_EXTENSION}`
}

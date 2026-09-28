// Contract between the renderer and the backend (Electron main process or the
// in-browser mock). Paths in this API are relative to the Assetto Corsa root
// and always use forward slashes.

import type { UiSkin } from './formats/uiSkin'

export type Language = 'ru' | 'en'

export interface AppSettings {
  acRoot: string | null
  language: Language
}

export interface CarSummary {
  id: string
  name: string
  brand?: string
  carClass?: string
  /** Main model file name inside the car folder, if one was found. */
  kn5?: string
  skinCount: number
}

export interface SkinInfo {
  id: string
  ui: UiSkin | null
  /** File names directly inside the skin folder. */
  files: string[]
  /** Created by AC Livery (has the marker file). */
  ours: boolean
}

export interface CarDetails extends CarSummary {
  kn5Files: string[]
  skins: SkinInfo[]
}

export type TextureEncoding = 'auto' | 'BC1' | 'BC3' | 'BGRA8'

export interface ExportTexture {
  /** Texture file name exactly as referenced by the model, e.g. Skin_00.dds */
  name: string
  width: number
  height: number
  /** Tightly packed RGBA8, top row first. */
  rgba: Uint8Array
}

/** What to do when the skin folder already exists. */
export type OverwriteMode = 'never' | 'ours' | 'always'

export interface ExportRequest {
  carId: string
  skinId: string
  textures: ExportTexture[]
  encoding: TextureEncoding
  uiSkin: UiSkin
  previewJpg?: Uint8Array
  liveryPng?: Uint8Array
  overwrite: OverwriteMode
  /**
   * Files copied unchanged from another skin of the same car, e.g. textures
   * that are not repainted. Written before `textures`, which win on conflict.
   */
  copyFiles?: { fromSkin: string; files: string[] }
  /**
   * Small files written as they are (e.g. the skin's ext_config.ini for
   * Custom Shaders Patch), after the copied files.
   */
  extraFiles?: { name: string; data: Uint8Array }[]
  /** Stored in the marker file to allow reopening the design later. */
  project?: unknown
}

export type ExportError = 'invalid-skin-id' | 'exists' | 'not-ours' | 'no-ac-root' | 'io'

export type ExportResult =
  | { ok: true; path: string; encoder: 'texconv' | 'builtin'; warnings: string[] }
  | { ok: false; error: ExportError; message: string }

export interface SkinStatus {
  exists: boolean
  ours: boolean
}

export interface ProjectFile {
  /** Where the project lives (an absolute path in the desktop app). */
  path: string
  bytes: Uint8Array
}

export interface Backend {
  readonly kind: 'electron' | 'mock'
  getSettings(): Promise<AppSettings>
  setLanguage(language: Language): Promise<AppSettings>
  /** Validates and stores the game folder; returns the updated settings or an error message. */
  setAcRoot(path: string | null): Promise<{ settings: AppSettings; error?: string }>
  detectAcRoot(): Promise<string | null>
  pickAcRoot(): Promise<string | null>
  listCars(): Promise<CarSummary[]>
  getCar(carId: string): Promise<CarDetails>
  /** Reads a file below the game root, e.g. content/cars/x/x.kn5 */
  readFile(relPath: string): Promise<ArrayBuffer>
  checkSkin(carId: string, skinId: string): Promise<SkinStatus>
  exportSkin(request: ExportRequest): Promise<ExportResult>
  revealPath(relPath: string): Promise<void>
  /**
   * Writes a project file and returns its path, or null when cancelled.
   * Asks where to save unless `path` is a project opened or saved earlier in
   * this session.
   */
  saveProject(
    bytes: Uint8Array,
    options: { path?: string; suggestedName: string },
  ): Promise<string | null>
  /** Lets the user pick a project file; null when cancelled. */
  openProject(): Promise<ProjectFile | null>
  /** Unsaved work kept across sessions (one slot); null when there is none. */
  readAutosave(): Promise<string | null>
  /** Replaces the autosave; null deletes it. */
  writeAutosave(data: string | null): Promise<void>
}

export const SKIN_MARKER_FILE = '.aclivery.json'

/** Skin folder names that work everywhere (game, servers, Content Manager). */
export const SKIN_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/

export function isValidSkinId(id: string): boolean {
  return SKIN_ID_RE.test(id) && !id.endsWith('.')
}

/** Turns free text into a valid skin folder name. */
export function slugifySkinId(text: string): string {
  const translit: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  }
  const s = [...text.toLowerCase()]
    .map((ch) => translit[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 64)
  return s || 'livery'
}

export const carDir = (carId: string) => `content/cars/${carId}`
export const skinDir = (carId: string, skinId: string) => `${carDir(carId)}/skins/${skinId}`

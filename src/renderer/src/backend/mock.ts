// In-memory backend for running the UI in a plain browser (npm run dev:web)
// and for end-to-end tests. Serves the synthetic test car.

import {
  isValidSkinId,
  SKIN_MARKER_FILE,
  type AppSettings,
  type Backend,
  type CarDetails,
  type CarSummary,
  type SkinInfo,
  type StickerFile,
} from '@shared/api'
import { buildSyntheticCar, type SyntheticCarOptions } from '@shared/fixtures/syntheticCar'
import { peekTemplate } from '@shared/design/project'
import { hasTransparency, writeDds } from '@shared/formats/dds'
import { asRecord, asString, parseLenientJson } from '@shared/formats/json'
import { parseUiSkin, serializeUiSkin } from '@shared/formats/uiSkin'

const MOCK_PROJECTS = 'projects/'
const AUTOSAVE_KEY = 'aclivery.autosave'
const enc = new TextEncoder()
const dec = new TextDecoder()

export function createMockBackend(): Backend {
  const files = new Map<string, Uint8Array>()
  const addCar = (id: string, name: string, options: SyntheticCarOptions = {}) => {
    const car = buildSyntheticCar(options)
    for (const [rel, data] of Object.entries(car.files)) {
      const renamed = rel.replace(car.id, id)
      files.set(
        `content/cars/${id}/${renamed}`,
        rel === 'ui/ui_car.json'
          ? enc.encode(JSON.stringify({ name, brand: 'AC Livery', class: 'race' }))
          : data,
      )
    }
  }
  addCar('aclivery_test_coupe', 'AC Livery Test Coupe')
  addCar('aclivery_test_shared_uv', 'AC Livery Test Coupe (shared UV)', { sharedSideUv: true })
  addCar('aclivery_test_overlay', 'AC Livery Test Coupe (livery overlay)', {
    overlayLivery: true,
  })
  addCar('aclivery_test_fin', 'AC Livery Test Coupe (fin)', { fin: true })

  if (import.meta.env.DEV) {
    // lets end-to-end scripts inspect exported files
    ;(window as unknown as { __aclMockFiles?: Map<string, Uint8Array> }).__aclMockFiles = files
  }

  let settings: AppSettings = { acRoot: 'mock://assettocorsa', language: 'ru' }
  let lastProject: string | null = null
  const templates = new Map<string, { bytes: Uint8Array; savedAt: number }>()
  let templateCounter = 0
  const stickers = new Map<string, StickerFile>()
  let stickerCounter = 0

  const children = (prefix: string) => {
    const dirs = new Set<string>()
    const plain: string[] = []
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash >= 0) dirs.add(rest.slice(0, slash))
      else plain.push(rest)
    }
    return { dirs: [...dirs].sort(), files: plain.sort() }
  }

  const summary = (id: string): CarDetails => {
    const base = `content/cars/${id}/`
    const top = children(base)
    const uiBytes = files.get(`${base}ui/ui_car.json`)
    const ui = uiBytes ? asRecord(parseLenientJson(dec.decode(uiBytes))) : {}
    const kn5Files = top.files.filter((f) => f.endsWith('.kn5'))
    const skinIds = children(`${base}skins/`).dirs
    const skins: SkinInfo[] = skinIds.map((sid) => {
      const skinFiles = children(`${base}skins/${sid}/`).files
      const uiSkin = files.get(`${base}skins/${sid}/ui_skin.json`)
      return {
        id: sid,
        files: skinFiles,
        ui: uiSkin ? parseUiSkin(dec.decode(uiSkin)) : null,
        ours: skinFiles.includes(SKIN_MARKER_FILE),
      }
    })
    return {
      id,
      name: asString(ui.name) ?? id,
      brand: asString(ui.brand),
      carClass: asString(ui.class),
      kn5: kn5Files[0],
      kn5Files,
      skinCount: skins.length,
      skins,
    }
  }

  return {
    kind: 'mock',
    async getSettings() {
      return settings
    },
    async setLanguage(language) {
      settings = { ...settings, language }
      return settings
    },
    async setAcRoot(path) {
      settings = { ...settings, acRoot: path }
      return { settings }
    },
    async detectAcRoot() {
      return 'mock://assettocorsa'
    },
    async pickAcRoot() {
      return 'mock://assettocorsa'
    },
    async listCars(): Promise<CarSummary[]> {
      return children('content/cars/').dirs.map((id) => {
        const { skins: _s, kn5Files: _k, ...rest } = summary(id)
        return rest
      })
    },
    async getCar(carId) {
      return summary(carId)
    },
    async readFile(relPath) {
      const data = files.get(relPath)
      if (!data) throw new Error(`Cannot read ${relPath} (404)`)
      return data.slice().buffer
    },
    async checkSkin(carId, skinId) {
      const skinFiles = children(`content/cars/${carId}/skins/${skinId}/`).files
      return { exists: skinFiles.length > 0, ours: skinFiles.includes(SKIN_MARKER_FILE) }
    },
    async exportSkin(req) {
      if (!isValidSkinId(req.skinId)) {
        return {
          ok: false,
          error: 'invalid-skin-id',
          message: `Invalid skin folder name "${req.skinId}"`,
        }
      }
      const dir = `content/cars/${req.carId}/skins/${req.skinId}/`
      const existing = children(dir).files
      if (existing.length) {
        const ours = existing.includes(SKIN_MARKER_FILE)
        if (req.overwrite === 'never') return { ok: false, error: 'exists', message: 'exists' }
        if (req.overwrite === 'ours' && !ours)
          return { ok: false, error: 'not-ours', message: 'not ours' }
        for (const f of existing) files.delete(dir + f)
      }
      if (req.copyFiles) {
        const from = `content/cars/${req.carId}/skins/${req.copyFiles.fromSkin}/`
        for (const f of req.copyFiles.files) {
          const data = files.get(from + f)
          if (!data) return { ok: false, error: 'io', message: `Cannot copy ${f}` }
          files.set(dir + f, data)
        }
      }
      for (const f of req.extraFiles ?? []) files.set(dir + f.name, f.data)
      for (const t of req.textures) {
        const format =
          req.encoding === 'auto' ? (hasTransparency(t.rgba) ? 'BC3' : 'BC1') : req.encoding
        files.set(dir + t.name, writeDds(t.rgba, t.width, t.height, format))
      }
      files.set(dir + 'ui_skin.json', enc.encode(serializeUiSkin(req.uiSkin)))
      if (req.previewJpg) files.set(dir + 'preview.jpg', req.previewJpg)
      if (req.liveryPng) files.set(dir + 'livery.png', req.liveryPng)
      files.set(
        dir + SKIN_MARKER_FILE,
        enc.encode(JSON.stringify({ app: 'AC Livery', project: req.project })),
      )
      return { ok: true, path: dir.slice(0, -1), encoder: 'builtin', warnings: [] }
    },
    async revealPath() {
      // nothing to reveal in the browser
    },
    // projects live next to the game files, under a folder the game never sees
    async saveProject(bytes, { path, suggestedName }) {
      const target = path?.startsWith(MOCK_PROJECTS) ? path : MOCK_PROJECTS + suggestedName
      files.set(target, bytes)
      lastProject = target
      return target
    },
    async openProject() {
      const bytes = lastProject ? files.get(lastProject) : undefined
      return lastProject && bytes ? { path: lastProject, bytes } : null
    },
    async listStickers() {
      return [...stickers.values()]
    },
    async addSticker(name, mime, data) {
      const sticker = { id: `s${++stickerCounter}`, name, mime, data }
      stickers.set(sticker.id, sticker)
      return sticker
    },
    async deleteSticker(id) {
      stickers.delete(id)
    },
    async listTemplates() {
      return [...templates.entries()]
        .map(([id, t]) => {
          const peek = peekTemplate(t.bytes)
          return { id, name: peek?.name ?? id, savedAt: t.savedAt, preview: peek?.preview }
        })
        .sort((a, b) => b.savedAt - a.savedAt)
    },
    async readTemplate(id) {
      const t = templates.get(id)
      if (!t) throw new Error(`No template ${id}`)
      return t.bytes
    },
    async saveTemplate(bytes) {
      const peek = peekTemplate(bytes)
      if (!peek) throw new Error('Not an AC Livery project')
      const id = `t${++templateCounter}`
      const savedAt = Date.now()
      templates.set(id, { bytes, savedAt })
      return { id, name: peek.name ?? id, savedAt, preview: peek.preview }
    },
    async deleteTemplate(id) {
      templates.delete(id)
    },
    async readAutosave() {
      try {
        return localStorage.getItem(AUTOSAVE_KEY)
      } catch {
        return null
      }
    },
    async writeAutosave(data) {
      try {
        if (data === null) localStorage.removeItem(AUTOSAVE_KEY)
        else localStorage.setItem(AUTOSAVE_KEY, data)
      } catch {
        // storage unavailable: nothing to keep
      }
    },
  }
}

import { create } from 'zustand'
import {
  isValidSkinId,
  slugifySkinId,
  type AppSettings,
  type Backend,
  type CarDetails,
  type CarSummary,
  type Language,
  type OverwriteMode,
} from '@shared/api'
import type { CarAnalysis } from '@shared/car/analysis'
import { asRecord, parseLenientJson } from '@shared/formats/json'
import { createBackend } from '../backend'
import {
  EngineController,
  encodeImage,
  renderLiveryIcon,
  type AoSource,
  type SkinTextureStatus,
} from '../engine/controller'
import { buildReport, describeMesh } from '../engine/report'
import type { ViewMode } from '../engine/viewer'
import i18n from '../i18n'

export interface LiveryMeta {
  skinname: string
  drivername: string
  team: string
  number: string
  country: string
}

export interface LiveryDraft {
  baseColor: string
  aoSource: AoSource
  aoStrength: number
  skinId: string
  /** The user edited the folder name by hand; stop deriving it from the name. */
  skinIdTouched: boolean
  meta: LiveryMeta
}

export type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; kind: 'format' | 'no-model' | 'other'; message: string }

export type ExportState =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'confirm'; mode: OverwriteMode; foreign: boolean }
  | { status: 'done'; path: string; builtinEncoder: boolean }
  | { status: 'error'; message: string }

export type PanelTab = 'skins' | 'livery' | 'info'

export const DEFAULT_DRAFT: LiveryDraft = {
  baseColor: '#d7261e',
  aoSource: 'auto',
  aoStrength: 0.85,
  skinId: 'my_livery',
  skinIdTouched: false,
  meta: { skinname: 'My Livery', drivername: '', team: '', number: '', country: '' },
}

interface State {
  backend: Backend
  settings: AppSettings | null
  setupMessage: string | null
  cars: CarSummary[]
  carsStatus: 'idle' | 'loading' | 'ready' | 'error'
  carFilter: string
  car: CarDetails | null
  load: LoadState
  analysis: CarAnalysis | null
  loadWarnings: string[]
  tab: PanelTab
  shownSkin: string | null
  draft: LiveryDraft
  aoStatus: 'idle' | 'working' | 'ready'
  aoUsed: AoSource | null
  exportState: ExportState
  view: ViewMode
  highlight: boolean
  skinStatus: SkinTextureStatus[]
  pickedMesh: number | null
  showHidden: boolean
}

interface Actions {
  init(): Promise<void>
  setLanguage(language: Language): Promise<void>
  detectRoot(): Promise<void>
  pickRoot(): Promise<void>
  resetRoot(): Promise<void>
  loadCars(): Promise<void>
  setCarFilter(filter: string): void
  selectCar(carId: string): Promise<void>
  setTab(tab: PanelTab): void
  showSkin(skinId: string | null): Promise<void>
  editSkin(skinId: string): Promise<void>
  updateDraft(patch: Partial<Omit<LiveryDraft, 'meta'>> & { meta?: Partial<LiveryMeta> }): void
  exportLivery(mode?: OverwriteMode): Promise<void>
  dismissExport(): void
  setView(view: ViewMode): void
  setHighlight(on: boolean): void
  setShowHidden(show: boolean): void
  clearPick(): void
  diagnosticsReport(): string
  describePicked(): string[]
  attachEngine(controller: EngineController | null): void
}

let engine: EngineController | null = null
let bakeQueued = false
let bakeRunning: Promise<void> | null = null

export const useStore = create<State & Actions>((set, get) => {
  const bakeOnce = async (): Promise<void> => {
    const { draft, analysis, tab } = get()
    if (!engine || !analysis?.bodyTexture || tab !== 'livery') return
    const needsAo = draft.aoSource !== 'none' && draft.aoStrength > 0
    if (needsAo) set({ aoStatus: 'working' })
    try {
      const ao = needsAo ? await engine.resolveAo(draft.aoSource) : { used: 'none', texture: null }
      // the draft may have changed while AO was computed
      const latest = get().draft
      await engine.bakeLivery(
        { baseColor: latest.baseColor, aoSource: latest.aoSource, aoStrength: latest.aoStrength },
        ao,
      )
      set({ aoStatus: 'ready', aoUsed: ao.used })
    } catch (err) {
      console.error(err)
      set({ aoStatus: 'ready', aoUsed: 'none' })
    }
  }

  /** Bakes after the current frame; rapid changes collapse into one bake. Resolves when idle. */
  const rebake = (): Promise<void> => {
    bakeQueued = true
    if (!bakeRunning) {
      bakeRunning = (async () => {
        while (bakeQueued) {
          bakeQueued = false
          await new Promise((r) => requestAnimationFrame(r))
          await bakeOnce()
        }
      })().finally(() => {
        bakeRunning = null
      })
    }
    return bakeRunning
  }

  return {
    backend: createBackend(),
    settings: null,
    setupMessage: null,
    cars: [],
    carsStatus: 'idle',
    carFilter: '',
    car: null,
    load: { status: 'idle' },
    analysis: null,
    loadWarnings: [],
    tab: 'skins',
    shownSkin: null,
    draft: DEFAULT_DRAFT,
    aoStatus: 'idle',
    aoUsed: null,
    exportState: { status: 'idle' },
    view: 'perspective',
    highlight: false,
    skinStatus: [],
    pickedMesh: null,
    showHidden: false,

    async init() {
      const settings = await get().backend.getSettings()
      await i18n.changeLanguage(settings.language)
      set({ settings })
      if (settings.acRoot) await get().loadCars()
    },

    async setLanguage(language) {
      const settings = await get().backend.setLanguage(language)
      await i18n.changeLanguage(language)
      set({ settings })
    },

    async detectRoot() {
      const { backend } = get()
      const found = await backend.detectAcRoot()
      if (!found) {
        set({ setupMessage: 'setup.notFound' })
        return
      }
      const { settings, error } = await backend.setAcRoot(found)
      set({ settings, setupMessage: error ? 'setup.notAcRoot' : null })
      if (!error) await get().loadCars()
    },

    async pickRoot() {
      const { backend } = get()
      const picked = await backend.pickAcRoot()
      if (!picked) return
      const { settings, error } = await backend.setAcRoot(picked)
      set({ settings, setupMessage: error ? 'setup.notAcRoot' : null })
      if (!error) await get().loadCars()
    },

    async resetRoot() {
      const { settings } = await get().backend.setAcRoot(null)
      set({
        settings,
        cars: [],
        car: null,
        carsStatus: 'idle',
        load: { status: 'idle' },
        analysis: null,
      })
    },

    async loadCars() {
      set({ carsStatus: 'loading' })
      try {
        set({ cars: await get().backend.listCars(), carsStatus: 'ready' })
      } catch (err) {
        console.error(err)
        set({ carsStatus: 'error' })
      }
    },

    setCarFilter(carFilter) {
      set({ carFilter })
    },

    async selectCar(carId) {
      const { backend } = get()
      set({
        load: { status: 'loading' },
        analysis: null,
        loadWarnings: [],
        shownSkin: null,
        exportState: { status: 'idle' },
        highlight: false,
        skinStatus: [],
        pickedMesh: null,
        showHidden: false,
        view: 'perspective',
        aoUsed: null,
        aoStatus: 'idle',
      })
      try {
        const car = await backend.getCar(carId)
        set({ car })
        if (!engine) throw new Error('Viewer is not ready')
        const { analysis, warnings } = await engine.loadCar(car)
        const firstSkin = car.skins.find((s) => !s.ours)?.id ?? car.skins[0]?.id ?? null
        set({ analysis, loadWarnings: warnings, load: { status: 'ready' } })
        if (get().tab === 'livery') void rebake()
        else await get().showSkin(firstSkin)
      } catch (err) {
        const kind = (err as { kind?: string }).kind
        if (kind === 'cancelled') return
        console.error(err)
        set({
          load: {
            status: 'error',
            kind: kind === 'no-model' || kind === 'format' ? kind : 'other',
            message: err instanceof Error ? err.message : String(err),
          },
        })
      }
    },

    setTab(tab) {
      const prev = get().tab
      set({ tab })
      if (tab !== 'info' && get().pickedMesh !== null) get().clearPick()
      if (tab === 'livery' && prev !== 'livery') void rebake()
      if (tab !== 'livery' && prev === 'livery') void get().showSkin(get().shownSkin)
    },

    async showSkin(skinId) {
      set({ shownSkin: skinId })
      if (get().tab === 'livery') set({ tab: 'skins' })
      const status = (await engine?.showSkin(skinId)) ?? []
      if (get().shownSkin === skinId) set({ skinStatus: status })
    },

    async editSkin(skinId) {
      const { car, backend } = get()
      if (!car) return
      try {
        const bytes = await backend.readFile(
          `content/cars/${car.id}/skins/${skinId}/.aclivery.json`,
        )
        const marker = asRecord(parseLenientJson(new TextDecoder().decode(bytes)))
        const project = asRecord(marker.project)
        const draft = { ...DEFAULT_DRAFT, ...(project.draft as Partial<LiveryDraft>) }
        set({
          draft: { ...draft, skinId, skinIdTouched: true },
          tab: 'livery',
          exportState: { status: 'idle' },
        })
        void rebake()
      } catch (err) {
        console.error(err)
      }
    },

    updateDraft(patch) {
      const prev = get().draft
      const meta = { ...prev.meta, ...patch.meta }
      const next: LiveryDraft = { ...prev, ...patch, meta }
      if (patch.skinId !== undefined) next.skinIdTouched = true
      if (!next.skinIdTouched && patch.meta?.skinname !== undefined) {
        next.skinId = slugifySkinId(meta.skinname)
      }
      set({ draft: next, exportState: { status: 'idle' } })
      if (
        patch.baseColor !== undefined ||
        patch.aoSource !== undefined ||
        patch.aoStrength !== undefined
      ) {
        void rebake()
      }
    },

    async exportLivery(mode = 'never') {
      const { car, draft, backend } = get()
      if (!engine || !car) return
      if (!isValidSkinId(draft.skinId)) {
        set({ exportState: { status: 'error', message: i18n.t('livery.invalidId') } })
        return
      }
      if (mode === 'never') {
        const status = await backend.checkSkin(car.id, draft.skinId)
        if (status.exists) {
          set({
            exportState: {
              status: 'confirm',
              mode: status.ours ? 'ours' : 'always',
              foreign: !status.ours,
            },
          })
          return
        }
      }
      set({ exportState: { status: 'working' } })
      try {
        // make sure the texture on screen is the one that gets saved
        if (bakeRunning || !engine.hasLivery) await rebake()
        const textures = engine.exportTextures()
        if (!textures.length) throw new Error(i18n.t('livery.noTexture'))
        const preview = await engine.previewSize()
        const previewJpg = await encodeImage(
          engine.capturePreview(preview.width, preview.height),
          preview.width,
          preview.height,
          'image/jpeg',
        )
        const icon = await engine.liveryIconSize()
        const liveryPng = await renderLiveryIcon(icon.width, icon.height, draft.baseColor)
        const meta = Object.fromEntries(
          Object.entries(draft.meta).filter(([, v]) => v.trim() !== ''),
        )
        const result = await backend.exportSkin({
          carId: car.id,
          skinId: draft.skinId,
          textures,
          encoding: 'auto',
          uiSkin: { skinname: draft.skinId, ...meta },
          previewJpg,
          liveryPng,
          overwrite: mode,
          project: { version: 1, draft },
        })
        if (!result.ok) {
          set({ exportState: { status: 'error', message: result.message } })
          return
        }
        const updated = await backend.getCar(car.id)
        engine.updateCarDetails(updated)
        set({
          car: updated,
          shownSkin: draft.skinId,
          exportState: {
            status: 'done',
            path: result.path,
            builtinEncoder: result.encoder === 'builtin',
          },
        })
        void get().loadCars()
      } catch (err) {
        console.error(err)
        set({
          exportState: {
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          },
        })
      }
    },

    dismissExport() {
      set({ exportState: { status: 'idle' } })
    },

    setView(view) {
      engine?.setView(view)
      set({ view })
    },

    setHighlight(on) {
      engine?.highlightLivery(on)
      set({ highlight: on })
    },

    setShowHidden(show) {
      engine?.setShowHidden(show)
      set({ showHidden: show })
    },

    clearPick() {
      engine?.highlightMesh(null)
      set({ pickedMesh: null })
    },

    diagnosticsReport() {
      const { car, shownSkin, skinStatus } = get()
      const loaded = engine?.viewer.loadedCar
      if (!car || !loaded) return ''
      return buildReport({ car, loaded, shownSkin, skinStatus })
    },

    describePicked() {
      const loaded = engine?.viewer.loadedCar
      const index = get().pickedMesh
      return loaded && index !== null ? describeMesh(loaded, index) : []
    },

    attachEngine(controller) {
      engine = controller
      if (controller) {
        controller.onPick = (index) => {
          // picking is a diagnostics tool of the Model tab for now
          if (get().tab !== 'info') return
          controller.highlightMesh(index)
          set({ pickedMesh: index })
        }
      }
    },
  }
})

export function filteredCars(cars: CarSummary[], filter: string): CarSummary[] {
  const q = filter.trim().toLowerCase()
  if (!q) return cars
  return cars.filter((c) => `${c.name} ${c.brand ?? ''} ${c.id}`.toLowerCase().includes(q))
}

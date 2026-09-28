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
  type LiveryCandidate,
  type SkinTextureStatus,
} from '../engine/controller'
import { logEntries } from '../engine/log'
import { buildReport, describeMesh } from '../engine/report'
import { fileToDataUrl, fontFamily, imageAspect, textAspect } from '../engine/vinyl'
import { packProject, projectFileName, unpackProject } from '@shared/design/project'
import { worldToPosition } from '@shared/design/placement'
import {
  DEFAULT_PLACEMENT,
  EMPTY_DESIGN,
  FONT_ASSET_PREFIX,
  duplicateLayer,
  newId,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
  pruneAssets,
  type Asset,
  type BaseFinish,
  type Design,
  type ImageLayer,
  type Layer,
  type Placement,
  type ShapeKind,
  type ShapeLayer,
  type TextLayer,
} from '@shared/design/types'
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
  /** Textures to repaint: 'auto' follows the detected livery texture. */
  liveryTextures: 'auto' | string[]
  /** Skin for the remaining textures: 'auto' = the skin shown on the Skins tab. */
  baseSkin: 'auto' | 'model' | string
  /** Textures from the base skin to blank out, e.g. stock sponsor decals. */
  clearedTextures: string[]
  baseColor: string
  /** Missing in drafts saved before finishes existed: 'stock'. */
  baseFinish?: BaseFinish
  aoSource: AoSource
  aoStrength: number
  skinId: string
  /** The user edited the folder name by hand; stop deriving it from the name. */
  skinIdTouched: boolean
  meta: LiveryMeta
  design: Design
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
  liveryTextures: 'auto',
  baseSkin: 'auto',
  clearedTextures: [],
  baseColor: '#d7261e',
  baseFinish: 'stock',
  aoSource: 'auto',
  aoStrength: 0.85,
  skinId: 'my_livery',
  skinIdTouched: false,
  meta: { skinname: 'My Livery', drivername: '', team: '', number: '', country: '' },
  design: EMPTY_DESIGN,
}

/** Part of the draft covered by undo/redo. */
interface Snapshot {
  baseColor: string
  baseFinish: BaseFinish
  design: Design
}

const snapshot = (d: LiveryDraft): Snapshot => ({
  baseColor: d.baseColor,
  baseFinish: d.baseFinish ?? 'stock',
  design: d.design,
})

export type LiveryPanel = 'design' | 'base' | 'save'

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
  liveryCandidates: LiveryCandidate[]
  autoLivery: string[]
  liveryPanel: LiveryPanel
  selectedLayer: string | null
  past: Snapshot[]
  future: Snapshot[]
  designError: string | null
  /** The selected vinyl does not reach any repainted surface. */
  selectedOffPaint: boolean
  /** Material maps the finishes are written to (empty: finishes have no effect). */
  finishMaps: string[]
  /** Project file the draft was last opened from or saved to. */
  projectPath: string | null
  /** The draft changed since it was last saved, exported or opened. */
  dirty: boolean
  /** Unsaved work found at start-up, offered for restoring. */
  recovery: Recovery | null
  projectError: string | null
}

export interface Recovery {
  savedAt: number
  carId: string | null
  projectPath: string | null
  draft: LiveryDraft
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
  /** Textures that will actually be repainted with the current draft. */
  paintedTextures(): string[]
  /** Skin whose textures are kept for everything else (null = model). */
  baseSkinId(): string | null
  setLiveryPanel(panel: LiveryPanel): void
  // design editing
  addShape(shape: ShapeKind): void
  addText(text?: string): Promise<void>
  addImage(file: File): Promise<void>
  importFont(file: File): Promise<string | null>
  selectLayer(id: string | null): void
  updateLayer(id: string, patch: LayerPatch): Promise<void>
  updatePlacement(id: string, patch: Partial<Placement>, historyTag?: string): void
  removeLayer(id: string): void
  duplicateLayer(id: string): void
  moveLayer(id: string, delta: number): void
  clearDesign(): void
  undo(): void
  redo(): void
  attachEngine(controller: EngineController | null): void
  // projects
  saveProject(saveAs?: boolean): Promise<void>
  openProject(): Promise<void>
  restoreRecovery(): Promise<void>
  discardRecovery(): void
  dismissProjectError(): void
}

/** Visual properties of any layer kind that can be edited. */
export type LayerPatch = Partial<
  Omit<ShapeLayer, 'kind' | 'id' | 'placement'> &
    Omit<TextLayer, 'kind' | 'id' | 'placement'> &
    Omit<ImageLayer, 'kind' | 'id' | 'placement'>
>

let engine: EngineController | null = null
let lastHistoryTag: string | null = null
let lastHistoryAt = 0
let drag: { id: string; offset: [number, number, number] } | null = null
let bakeQueued = false
let bakeRunning: Promise<void> | null = null
/** Draft as last saved, exported or opened; anything else is unsaved work. */
let cleanDraft: LiveryDraft = DEFAULT_DRAFT
const AUTOSAVE_DELAY = 1500

export const useStore = create<State & Actions>((set, get) => {
  const bakeOnce = async (): Promise<void> => {
    const { analysis, tab } = get()
    if (!engine || !analysis || tab !== 'livery') return
    const draft = get().draft
    const needsAo = draft.aoSource !== 'none' && draft.aoStrength > 0
    if (needsAo) set({ aoStatus: 'working' })
    try {
      const { aoUsed } = await engine.bakeLivery({
        baseColor: draft.baseColor,
        baseFinish: draft.baseFinish ?? 'stock',
        aoSource: draft.aoSource,
        aoStrength: draft.aoStrength,
        textures: get().paintedTextures(),
        baseSkin: get().baseSkinId(),
        design: draft.design,
        cleared: draft.clearedTextures ?? [],
      })
      set({ aoStatus: 'ready', aoUsed })
      const maps = engine.mapsTextures(get().paintedTextures())
      if (maps.join('|') !== get().finishMaps.join('|')) set({ finishMaps: maps })
      refreshOutline()
      if (get().highlight) engine.highlightTextures(get().paintedTextures())
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

  /**
   * Saves the current design for undo. Repeated changes with the same tag in
   * quick succession (slider drags, wheel steps) form one undo step.
   */
  const pushHistory = (tag: string | null = null): void => {
    const now = Date.now()
    if (tag && tag === lastHistoryTag && now - lastHistoryAt < 700) {
      lastHistoryAt = now
      return
    }
    lastHistoryTag = tag
    lastHistoryAt = now
    const { draft, past } = get()
    set({
      past: [...past, snapshot(draft)].slice(-100),
      future: [],
    })
  }

  const refreshOutline = (): void => {
    const { tab, selectedLayer, draft } = get()
    const layer = draft.design.layers.find((l) => l.id === selectedLayer) ?? null
    engine?.showOutline(tab === 'livery' ? layer : null)
    const offPaint = !!layer && !!engine && !engine.layerReachesPaint(layer)
    if (offPaint !== get().selectedOffPaint) set({ selectedOffPaint: offPaint })
  }

  const setDesign = (design: Design): void => {
    set({ draft: { ...get().draft, design }, exportState: { status: 'idle' } })
    refreshOutline()
    void rebake()
  }

  const mapLayer = (id: string, fn: (l: Layer) => Layer): void => {
    const design = get().draft.design
    setDesign({ ...design, layers: design.layers.map((l) => (l.id === id ? fn(l) : l)) })
  }

  /** Where a new vinyl goes: the spot on the car in the middle of the view. */
  const initialPlacement = (width: number): Placement => {
    const base = { ...DEFAULT_PLACEMENT, width }
    const hit = engine?.centerHit()
    return (hit && engine?.placeAtHit(base, hit)) || base
  }

  const addLayer = (layer: Layer): void => {
    pushHistory()
    const design = get().draft.design
    set({ selectedLayer: layer.id })
    setDesign({ ...design, layers: [...design.layers, layer] })
  }

  const markClean = (): void => {
    cleanDraft = get().draft
    set({ dirty: false })
  }

  /** Puts a draft from a project, the autosave or a skin into the editor. */
  const applyLoadedDraft = async (raw: unknown, carId: string | null): Promise<void> => {
    let draft = normalizeDraft(raw)
    const { car, cars } = get()
    if (carId && carId !== car?.id && cars.some((c) => c.id === carId)) {
      await get().selectCar(carId)
    }
    // texture choices only make sense on the car they were made for
    if (carId && carId !== get().car?.id) {
      draft = { ...draft, liveryTextures: 'auto', baseSkin: 'auto', clearedTextures: [] }
    }
    set({
      draft,
      selectedLayer: null,
      past: [],
      future: [],
      exportState: { status: 'idle' },
      projectError: null,
    })
    if (get().car) get().setTab('livery')
    refreshOutline()
    void rebake()
  }

  const addAsset = (id: string, asset: Asset): void => {
    const draft = get().draft
    set({
      draft: {
        ...draft,
        design: { ...draft.design, assets: { ...draft.design.assets, [id]: asset } },
      },
    })
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
    liveryCandidates: [],
    autoLivery: [],
    liveryPanel: 'design',
    selectedLayer: null,
    past: [],
    future: [],
    designError: null,
    selectedOffPaint: false,
    finishMaps: [],
    projectPath: null,
    dirty: false,
    recovery: null,
    projectError: null,

    async init() {
      const settings = await get().backend.getSettings()
      await i18n.changeLanguage(settings.language)
      set({
        settings,
        recovery: parseAutosave(
          await get()
            .backend.readAutosave()
            .catch(() => null),
        ),
      })
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
        liveryCandidates: [],
        autoLivery: [],
      })
      try {
        const car = await backend.getCar(carId)
        set({ car })
        if (!engine) throw new Error('Viewer is not ready')
        const { analysis, warnings } = await engine.loadCar(car)
        const firstSkin = car.skins.find((s) => !s.ours)?.id ?? car.skins[0]?.id ?? null
        // candidates are measured with a stock skin on, so overlays have their real alpha
        const skinStatus = await engine.showSkin(firstSkin)
        const liveryCandidates = engine.detectLiveryCandidates()
        set({
          analysis,
          loadWarnings: warnings,
          load: { status: 'ready' },
          shownSkin: firstSkin,
          skinStatus,
          liveryCandidates,
          autoLivery: engine.autoLiveryTextures(),
        })
        engine.setPaintFilter(get().paintedTextures())
        if (get().tab === 'livery') void rebake()
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
      refreshOutline()
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
        const draft = normalizeDraft(project.draft)
        set({
          draft: { ...draft, skinId, skinIdTouched: true },
          tab: 'livery',
          exportState: { status: 'idle' },
          selectedLayer: null,
          past: [],
          future: [],
          projectPath: null,
        })
        markClean()
        refreshOutline()
        void rebake()
      } catch (err) {
        console.error(err)
      }
    },

    updateDraft(patch) {
      if (patch.baseColor !== undefined) pushHistory('baseColor')
      if (patch.baseFinish !== undefined) pushHistory()
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
        patch.baseFinish !== undefined ||
        patch.aoSource !== undefined ||
        patch.aoStrength !== undefined ||
        patch.liveryTextures !== undefined ||
        patch.baseSkin !== undefined ||
        patch.clearedTextures !== undefined
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
        const { textures, copyFiles } = engine.exportPayload()
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
          copyFiles,
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
        markClean()
        void backend.writeAutosave(null)
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
      engine?.highlightTextures(on ? get().paintedTextures() : null)
      set({ highlight: on })
    },

    paintedTextures() {
      const { draft, liveryCandidates, autoLivery } = get()
      return resolvePaintedTextures(draft, liveryCandidates, autoLivery)
    },

    baseSkinId() {
      const { draft, car, shownSkin } = get()
      if (draft.baseSkin === 'model') return null
      const wanted = draft.baseSkin === 'auto' ? shownSkin : draft.baseSkin
      return car?.skins.some((s) => s.id === wanted) ? wanted : null
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
      return buildReport({
        car,
        loaded,
        shownSkin,
        skinStatus,
        candidates: get().liveryCandidates,
        painted: get().paintedTextures(),
        gpu: engine?.gpuInfo(),
        log: logEntries(),
      })
    },

    describePicked() {
      const loaded = engine?.viewer.loadedCar
      const index = get().pickedMesh
      return loaded && index !== null ? describeMesh(loaded, index) : []
    },

    setLiveryPanel(liveryPanel) {
      set({ liveryPanel })
    },

    addShape(shape) {
      addLayer(newShapeLayer(shape, initialPlacement(0.18), '#ffffff'))
    },

    async addText(text = '00') {
      const layer = newTextLayer(text, initialPlacement(0.2), 1)
      try {
        const aspect = await textAspect(layer, get().draft.design.assets)
        layer.placement = { ...layer.placement, height: layer.placement.width / aspect }
      } catch (err) {
        console.error(err)
      }
      addLayer(layer)
    },

    async addImage(file) {
      try {
        const data = await fileToDataUrl(file)
        const asset: Asset = { name: file.name, mime: file.type || 'image/png', data }
        const aspect = await imageAspect(asset)
        const id = newId('a')
        addAsset(id, asset)
        const name = file.name.replace(/\.[^.]+$/, '')
        addLayer(newImageLayer(id, name, initialPlacement(0.2), aspect))
        set({ designError: null })
      } catch (err) {
        set({ designError: err instanceof Error ? err.message : String(err) })
      }
    },

    async importFont(file) {
      try {
        const data = await fileToDataUrl(file)
        const id = newId('f')
        const name = file.name.replace(/\.[^.]+$/, '')
        const asset: Asset = { name, mime: file.type || 'font/ttf', data }
        await fontFamily(`${FONT_ASSET_PREFIX}${id}`, { [id]: asset })
        addAsset(id, asset)
        set({ designError: null })
        return `${FONT_ASSET_PREFIX}${id}`
      } catch (err) {
        set({ designError: err instanceof Error ? err.message : String(err) })
        return null
      }
    },

    selectLayer(id) {
      set({ selectedLayer: id })
      refreshOutline()
    },

    async updateLayer(id, patch) {
      const layer = get().draft.design.layers.find((l) => l.id === id)
      if (!layer) return
      pushHistory(`${id}:${Object.keys(patch).sort().join(',')}`)
      let next = { ...layer, ...patch } as Layer
      const reshapes = ['text', 'font', 'bold', 'italic', 'outline'].some((k) => k in patch)
      if (next.kind === 'text' && reshapes) {
        if ('text' in patch && layer.name === (layer as TextLayer).text) {
          next = { ...next, name: next.text || '…' }
        }
        try {
          const aspect = await textAspect(next, get().draft.design.assets)
          next = {
            ...next,
            placement: { ...next.placement, height: next.placement.width / aspect },
          }
        } catch (err) {
          console.error(err)
        }
      }
      mapLayer(id, () => next)
    },

    updatePlacement(id, patch, historyTag) {
      pushHistory(historyTag ?? `${id}:placement:${Object.keys(patch).sort().join(',')}`)
      mapLayer(id, (l) => ({ ...l, placement: { ...l.placement, ...patch } }))
    },

    removeLayer(id) {
      pushHistory()
      const design = get().draft.design
      if (get().selectedLayer === id) set({ selectedLayer: null })
      setDesign(pruneAssets({ ...design, layers: design.layers.filter((l) => l.id !== id) }))
    },

    duplicateLayer(id) {
      const design = get().draft.design
      const index = design.layers.findIndex((l) => l.id === id)
      if (index < 0) return
      pushHistory()
      const copy = duplicateLayer(design.layers[index]!)
      const layers = [...design.layers]
      layers.splice(index + 1, 0, copy)
      set({ selectedLayer: copy.id })
      setDesign({ ...design, layers })
    },

    moveLayer(id, delta) {
      const design = get().draft.design
      const index = design.layers.findIndex((l) => l.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= design.layers.length) return
      pushHistory()
      const layers = [...design.layers]
      const [layer] = layers.splice(index, 1)
      layers.splice(target, 0, layer!)
      setDesign({ ...design, layers })
    },

    clearDesign() {
      pushHistory()
      set({ selectedLayer: null })
      setDesign(EMPTY_DESIGN)
    },

    undo() {
      const { past, future, draft } = get()
      const prev = past.at(-1)
      if (!prev) return
      lastHistoryTag = null
      set({
        past: past.slice(0, -1),
        future: [snapshot(draft), ...future],
        draft: { ...draft, ...prev },
      })
      if (!prev.design.layers.some((l) => l.id === get().selectedLayer))
        set({ selectedLayer: null })
      refreshOutline()
      void rebake()
    },

    redo() {
      const { past, future, draft } = get()
      const next = future[0]
      if (!next) return
      lastHistoryTag = null
      set({
        past: [...past, snapshot(draft)],
        future: future.slice(1),
        draft: { ...draft, ...next },
      })
      if (!next.design.layers.some((l) => l.id === get().selectedLayer))
        set({ selectedLayer: null })
      refreshOutline()
      void rebake()
    },

    async saveProject(saveAs = false) {
      const { draft, car, projectPath, backend } = get()
      try {
        const bytes = packProject({ carId: car?.id ?? null, draft })
        const path = await backend.saveProject(bytes, {
          path: saveAs ? undefined : (projectPath ?? undefined),
          suggestedName: projectFileName(draft.meta.skinname),
        })
        if (!path) return
        set({ projectPath: path, projectError: null })
        markClean()
        await backend.writeAutosave(null)
      } catch (err) {
        console.error(err)
        set({ projectError: err instanceof Error ? err.message : String(err) })
      }
    },

    async openProject() {
      const { backend, dirty } = get()
      if (dirty && !window.confirm(i18n.t('project.discardChanges'))) return
      try {
        const file = await backend.openProject()
        if (!file) return
        const doc = unpackProject(file.bytes)
        await applyLoadedDraft(doc.draft, doc.carId)
        set({ projectPath: file.path, recovery: null })
        markClean()
        await backend.writeAutosave(null)
      } catch (err) {
        console.error(err)
        set({ projectError: err instanceof Error ? err.message : String(err) })
      }
    },

    async restoreRecovery() {
      const recovery = get().recovery
      if (!recovery) return
      set({ recovery: null })
      await applyLoadedDraft(recovery.draft, recovery.carId)
      // still unsaved: it stays dirty and keeps being autosaved
      set({ projectPath: recovery.projectPath })
    },

    discardRecovery() {
      set({ recovery: null })
      if (!get().dirty) void get().backend.writeAutosave(null)
    },

    dismissProjectError() {
      set({ projectError: null })
    },

    attachEngine(controller) {
      engine = controller
      if (controller) {
        controller.setInteraction({
          down(hit) {
            const st = get()
            if (st.tab !== 'livery' || !hit) return false
            const id = controller.layerAt(hit.point, st.draft.design)
            if (!id) return false
            st.selectLayer(id)
            const layer = st.draft.design.layers.find((l) => l.id === id)!
            if (layer.locked) return false
            const frame = controller.displayFrame()
            const grabbed = frame ? worldToPosition(frame, hit.point) : layer.placement.position
            const p = layer.placement.position
            drag = { id, offset: [p[0] - grabbed[0], p[1] - grabbed[1], p[2] - grabbed[2]] }
            lastHistoryTag = null
            pushHistory(`drag:${id}`)
            return true
          },
          move(hit) {
            const current = drag
            if (!current || !hit) return
            const layer = get().draft.design.layers.find((l) => l.id === current.id)
            const placed = layer && controller.placeAtHit(layer.placement, hit)
            if (!placed) return
            const o = current.offset
            const position: [number, number, number] = [
              placed.position[0] + o[0],
              placed.position[1] + o[1],
              placed.position[2] + o[2],
            ]
            get().updatePlacement(
              current.id,
              { position, direction: placed.direction },
              `drag:${current.id}`,
            )
          },
          up() {
            drag = null
          },
          wheel(e) {
            const st = get()
            if (st.tab !== 'livery' || !(e.shiftKey || e.altKey)) return false
            const layer = st.draft.design.layers.find((l) => l.id === st.selectedLayer)
            if (!layer || layer.locked) return false
            const up = e.deltaY < 0
            if (e.shiftKey) {
              const k = up ? 1.06 : 1 / 1.06
              st.updatePlacement(
                layer.id,
                { width: layer.placement.width * k, height: layer.placement.height * k },
                `wheel-scale:${layer.id}`,
              )
            } else {
              st.updatePlacement(
                layer.id,
                { rotation: (layer.placement.rotation + (up ? 5 : -5) + 360) % 360 },
                `wheel-rotate:${layer.id}`,
              )
            }
            return true
          },
        })
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

// Autosave: shortly after the draft changes, unsaved work goes to the
// backend's autosave slot so a crash or a closed window does not lose it.
let autosaveTimer: ReturnType<typeof setTimeout> | null = null

useStore.subscribe((state, prev) => {
  if (state.draft === prev.draft) return
  const dirty = state.draft !== cleanDraft
  if (dirty !== state.dirty) useStore.setState({ dirty })
  if (!dirty) return
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    const st = useStore.getState()
    if (!st.dirty) return
    const data = JSON.stringify({
      app: 'AC Livery',
      kind: 'autosave',
      version: 1,
      savedAt: Date.now(),
      carId: st.car?.id ?? null,
      projectPath: st.projectPath,
      draft: st.draft,
    })
    st.backend.writeAutosave(data).catch((err) => console.error(err))
  }, AUTOSAVE_DELAY)
})

function parseAutosave(raw: string | null): Recovery | null {
  if (!raw) return null
  try {
    const data = asRecord(JSON.parse(raw))
    if (data.kind !== 'autosave') return null
    return {
      savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
      carId: typeof data.carId === 'string' ? data.carId : null,
      projectPath: typeof data.projectPath === 'string' ? data.projectPath : null,
      draft: normalizeDraft(data.draft),
    }
  } catch {
    return null
  }
}

/** Fills a stored draft (older versions may lack fields) up to the current shape. */
export function normalizeDraft(raw: unknown): LiveryDraft {
  const stored = asRecord(raw) as Partial<LiveryDraft>
  const design = asRecord(stored.design) as Partial<Design>
  return {
    ...DEFAULT_DRAFT,
    ...stored,
    meta: { ...DEFAULT_DRAFT.meta, ...asRecord(stored.meta) },
    design: {
      layers: Array.isArray(design.layers) ? design.layers : [],
      assets: asRecord(design.assets) as Design['assets'],
    },
  }
}

/** Textures repainted for a draft: an explicit choice, or the automatic pick. */
export function resolvePaintedTextures(
  draft: LiveryDraft,
  candidates: LiveryCandidate[],
  autoLivery: string[],
): string[] {
  if (draft.liveryTextures === 'auto') return autoLivery
  const known = new Set(candidates.map((c) => c.name.toLowerCase()))
  const chosen = draft.liveryTextures.filter((t) => known.has(t.toLowerCase()))
  return chosen.length ? chosen : autoLivery
}

export function filteredCars(cars: CarSummary[], filter: string): CarSummary[] {
  const q = filter.trim().toLowerCase()
  if (!q) return cars
  return cars.filter((c) => `${c.name} ${c.brand ?? ''} ${c.id}`.toLowerCase().includes(q))
}

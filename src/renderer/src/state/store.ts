import { create } from 'zustand'
import {
  isValidSkinId,
  slugifySkinId,
  type AppSettings,
  type Backend,
  type CarDetails,
  type CarSummary,
  type ExportResult,
  type Language,
  type OverwriteMode,
} from '@shared/api'
import type { CarAnalysis } from '@shared/car/analysis'
import type { CarParts } from '@shared/car/parts'
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
import { bytesToDataUrl, packProject, projectFileName, unpackProject } from '@shared/design/project'
import { BUILTIN_STICKERS, stickerAssetId, type Sticker } from '@shared/design/stickers'
import { SKIN_CONFIG_FILE } from '@shared/design/csp'
import { readTable } from '@shared/league/sheet'
import {
  DEFAULT_LEAGUE,
  guessMapping,
  newRowId,
  rowsFromCells,
  skinFolders,
  type LeagueRow,
  type LeagueTable,
} from '@shared/league/table'
import {
  fillText,
  paramValues,
  resolveDraft,
  textValues,
  resolveLayer,
  STANDARD_PARAMS,
  type DraftBindings,
  type DraftBindingTarget,
  type LayerBindings,
  type ParamKind,
  type TemplateParam,
} from '@shared/design/params'
import {
  duplicateLayers,
  groupLayers,
  groupMembers,
  moveLayers,
  removeLayers,
  ungroup,
} from '@shared/design/layers'
import { basis, positionToWorld, worldToPosition } from '@shared/design/placement'
import {
  moveSelection,
  rotateSelection,
  scaleSelection,
  selectionBounds,
  snapAngle,
  type SelectionBounds,
} from '@shared/design/transform'
import {
  DEFAULT_CSP,
  DEFAULT_PARTS,
  DEFAULT_PLACEMENT,
  EMPTY_DESIGN,
  FONT_ASSET_PREFIX,
  newId,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
  pruneAssets,
  type Asset,
  type BaseFinish,
  type CspPaint,
  type Design,
  type PartsPaint,
  type ImageLayer,
  type Layer,
  type Placement,
  type ShapeKind,
  type ShapeLayer,
  type TextLayer,
  type V3,
} from '@shared/design/types'
import type { ViewMode } from '../engine/viewer'
import i18n from '../i18n'

// a type (not an interface) so it fits Record<string, string>
export type LiveryMeta = {
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
  /** Rims, calipers and glass (missing in older drafts). */
  parts?: PartsPaint
  /** Custom Shaders Patch car paint (missing in older drafts). */
  csp?: CspPaint
  /** Template parameters, their current values and the draft colours bound to them. */
  params?: TemplateParam[]
  values?: Record<string, string>
  bindings?: DraftBindings
  /** Name of the template the design came from, if any. */
  template?: string
  /** Drivers of a league and how their skins are named (missing in older drafts). */
  league?: LeagueTable
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

export type PanelTab = 'skins' | 'livery' | 'league' | 'info'

export const DEFAULT_DRAFT: LiveryDraft = {
  liveryTextures: 'auto',
  baseSkin: 'auto',
  clearedTextures: [],
  baseColor: '#d7261e',
  baseFinish: 'stock',
  parts: DEFAULT_PARTS,
  csp: DEFAULT_CSP,
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
  parts: PartsPaint
  csp: CspPaint
  design: Design
  params: TemplateParam[]
  values: Record<string, string>
  bindings: DraftBindings
  template: string | undefined
}

const snapshot = (d: LiveryDraft): Snapshot => ({
  baseColor: d.baseColor,
  baseFinish: d.baseFinish ?? 'stock',
  parts: d.parts ?? DEFAULT_PARTS,
  csp: d.csp ?? DEFAULT_CSP,
  design: d.design,
  params: d.params ?? [],
  values: d.values ?? {},
  bindings: d.bindings ?? {},
  template: d.template,
})

/** A template as it is applied: a draft's design side plus its parameters. */
export interface TemplateDraft {
  name: string
  baseColor: string
  baseFinish?: BaseFinish
  parts?: PartsPaint
  csp?: CspPaint
  design: Design
  params: TemplateParam[]
  values?: Record<string, string>
  bindings?: DraftBindings
  meta?: Partial<LiveryMeta>
}

export type LiveryPanel = 'design' | 'base' | 'parts' | 'template' | 'save'

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
  /** Primary selected layer: its properties are shown and transforms pivot on its plane. */
  selectedLayer: string | null
  /** Every selected layer, including the primary one. */
  selection: string[]
  past: Snapshot[]
  future: Snapshot[]
  designError: string | null
  /** The selected vinyl does not reach any repainted surface. */
  selectedOffPaint: boolean
  /** Material maps the finishes are written to (empty: finishes have no effect). */
  finishMaps: string[]
  /** Rims, calipers and glass textures found on the loaded car. */
  carParts: CarParts | null
  /** Car paint materials a CSP effect applies to (empty: not available). */
  cspMaterials: string[]
  /** Templates saved by the user, newest first. */
  userTemplates: UserTemplate[]
  /** Built-in stickers first, then the user's library. */
  stickers: Sticker[]
  /** A table file being matched to parameters before it becomes league rows. */
  leagueImport: LeagueImport | null
  leagueRun: LeagueRun
  /** Row shown on the car in the league table. */
  leaguePreview: string | null
  /** The league table is open over the viewport. */
  leagueTableOpen: boolean
  templateMessage: { kind: 'ok' | 'error'; text: string } | null
  /** Project file the draft was last opened from or saved to. */
  projectPath: string | null
  /** The draft changed since it was last saved, exported or opened. */
  dirty: boolean
  /** Unsaved work found at start-up, offered for restoring. */
  recovery: Recovery | null
  projectError: string | null
}

export interface LeagueImport {
  fileName: string
  cells: string[][]
  /** Parameter id per column, null to ignore it. */
  mapping: (string | null)[]
  header: boolean
}

export interface LeagueResult {
  car: string
  skin: string
  driver: string
  ok: boolean
  message?: string
}

export interface LeagueRun {
  status: 'idle' | 'running' | 'done' | 'cancelled'
  done: number
  total: number
  current: string | null
  results: LeagueResult[]
  /** Cells a table import could not read. */
  problems: { row: number; column: string; value: string }[]
}

const IDLE_RUN: LeagueRun = {
  status: 'idle',
  done: 0,
  total: 0,
  current: null,
  results: [],
  problems: [],
}

export interface UserTemplate {
  id: string
  name: string
  savedAt: number
  /** blob: URL of the thumbnail. */
  previewUrl?: string
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
  updatePart<K extends keyof PartsPaint>(part: K, patch: Partial<PartsPaint[K]>): void
  updateCsp(patch: Partial<CspPaint>): void
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
  selectLayer(id: string | null, mode?: SelectMode): void
  selectGroup(groupId: string): void
  selectAll(): void
  updateLayer(id: string, patch: LayerPatch): Promise<void>
  updatePlacement(id: string, patch: Partial<Placement>, historyTag?: string): void
  setLayersFlag(ids: string[], patch: { visible?: boolean; locked?: boolean }): void
  removeSelection(): void
  duplicateSelection(): void
  moveSelection(delta: 1 | -1): void
  groupSelection(): void
  ungroupSelection(): void
  renameGroup(groupId: string, name: string): void
  alignSelection(mode: AlignMode): void
  centerSelection(axis: 'width' | 'length'): void
  nudgeSelection(dx: number, dy: number): void
  transformSelection(op: { scale?: number; rotate?: number }, historyTag: string): void
  /** Rectangle around the selection in the plane of the primary layer (display space). */
  selectionBounds(): SelectionBounds | null
  beginGizmo(): void
  /** Scale factor and/or screen rotation (degrees, counter-clockwise) since beginGizmo. */
  gizmoUpdate(op: { scale?: number; rotate?: number; snap?: boolean }): void
  endGizmo(): void
  clearDesign(): void
  // template parameters
  setParamValue(id: string, value: string): void
  setParamImage(id: string, file: File): Promise<void>
  addParam(kind: ParamKind): void
  addStandardParams(): void
  updateParam(id: string, patch: Partial<Pick<TemplateParam, 'label' | 'default'>>): void
  removeParam(id: string): void
  bindLayer(id: string, prop: keyof LayerBindings, paramId: string | null): void
  bindDraft(target: DraftBindingTarget, paramId: string | null): void
  /** Replaces the design with a template; texture choices of the car stay. */
  applyTemplate(template: TemplateDraft): void
  /** Shows a template on the car without applying it; null goes back to the draft. */
  previewTemplate(template: TemplateDraft | null): void
  updateLeague(patch: Partial<Omit<LeagueTable, 'rows'>>): void
  addLeagueRow(): void
  updateLeagueRow(id: string, values: Record<string, string>): void
  removeLeagueRow(id: string): void
  clearLeague(): void
  /** Reads a CSV/XLSX file and proposes a column mapping. */
  openLeagueFile(file: File): Promise<void>
  setImportMapping(column: number, paramId: string | null): void
  setImportHeader(header: boolean): void
  confirmImport(mode: 'replace' | 'append'): void
  cancelImport(): void
  previewLeagueRow(id: string | null): void
  /** Generates a skin for every row (and every chosen car). */
  runLeague(): Promise<void>
  cancelLeague(): void
  dismissLeagueRun(): void
  setLeagueTableOpen(open: boolean): void
  loadStickers(): Promise<void>
  addToLibrary(files: File[]): Promise<void>
  removeFromLibrary(id: string): Promise<void>
  /** Copies a sticker into the design (once) and returns its asset id. */
  stickerAsset(sticker: Sticker): Promise<string>
  addStickerLayer(sticker: Sticker): Promise<void>
  loadTemplates(): Promise<void>
  userTemplate(id: string): Promise<TemplateDraft | null>
  saveAsTemplate(name: string): Promise<void>
  deleteTemplate(id: string): Promise<void>
  importTemplate(): Promise<void>
  exportTemplate(id: string): Promise<void>
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

export type SelectMode = 'replace' | 'toggle' | 'range'
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** How close (in body-normalised units) a selection snaps to the car's centre line. */
const CENTRE_SNAP = 0.03

const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const vscale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Tabs that show the livery being made on the car. */
function showsLivery(tab: PanelTab): boolean {
  return tab === 'livery' || tab === 'league'
}

/** The draft with its template parameters filled in: what gets baked and exported. */
function resolved(d: LiveryDraft): LiveryDraft {
  return resolveDraft({ ...d, parts: d.parts ?? DEFAULT_PARTS, csp: d.csp ?? DEFAULT_CSP })
}

/** Asset ids a draft's parameters point to; they survive removing layers. */
function paramAssets(d: LiveryDraft): string[] {
  const imageParams = (d.params ?? []).filter((p) => p.kind === 'image')
  const rows = d.league?.rows ?? []
  return imageParams
    .flatMap((p) => [p.default, d.values?.[p.id] ?? '', ...rows.map((r) => r.values[p.id] ?? '')])
    .filter(Boolean)
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
let drag: {
  id: string
  offset: V3
  /** Placements of every moved layer when the drag started. */
  start: Map<string, Placement>
  startOrigin: V3
  startDir: V3
} | null = null
let gizmo: {
  ids: string[]
  placements: Placement[]
  bounds: SelectionBounds
  primaryRotation: number
} | null = null
let bakeQueued = false
let bakeRunning: Promise<void> | null = null
/** Draft as last saved, exported or opened; anything else is unsaved work. */
let cleanDraft: LiveryDraft = DEFAULT_DRAFT
/** A template shown on the car while the pointer rests on it in the gallery. */
let previewDraft: LiveryDraft | null = null
let leagueCancelled = false
/** User templates already read from disk, by id. */
const templateCache = new Map<string, TemplateDraft>()
const AUTOSAVE_DELAY = 1500

export const useStore = create<State & Actions>((set, get) => {
  const bakeOnce = async (): Promise<void> => {
    const { analysis, tab } = get()
    if (!engine || !analysis || (tab !== 'livery' && tab !== 'league')) return
    const active = previewDraft ?? get().draft
    const draft = resolved(active)
    const needsAo = draft.aoSource !== 'none' && draft.aoStrength > 0
    if (needsAo) set({ aoStatus: 'working' })
    try {
      const { aoUsed } = await engine.bakeLivery({
        baseColor: draft.baseColor,
        baseFinish: draft.baseFinish ?? 'stock',
        parts: draft.parts ?? DEFAULT_PARTS,
        csp: draft.csp ?? DEFAULT_CSP,
        aoSource: draft.aoSource,
        aoStrength: draft.aoStrength,
        textures: paintedFor(active),
        baseSkin: baseSkinFor(active),
        design: draft.design,
        cleared: draft.clearedTextures ?? [],
      })
      set({ aoStatus: 'ready', aoUsed })
      const maps = engine.mapsTextures(get().paintedTextures())
      if (maps.join('|') !== get().finishMaps.join('|')) set({ finishMaps: maps })
      const cspMaterials = engine.cspMaterials(get().paintedTextures())
      if (cspMaterials.join('|') !== get().cspMaterials.join('|')) set({ cspMaterials })
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

  const paintedFor = (d: LiveryDraft): string[] =>
    resolvePaintedTextures(d, get().liveryCandidates, get().autoLivery)

  const baseSkinFor = (d: LiveryDraft): string | null => {
    const { car, shownSkin } = get()
    if (d.baseSkin === 'model') return null
    const wanted = d.baseSkin === 'auto' ? shownSkin : d.baseSkin
    return car?.skins.some((s) => s.id === wanted) ? wanted : null
  }

  /**
   * Bakes a draft (the one being edited unless another is given) and writes
   * it to the game as `skinId` of the car that is open.
   */
  const exportDraft = async (
    d: LiveryDraft,
    skinId: string,
    mode: OverwriteMode,
  ): Promise<ExportResult> => {
    const { car, backend } = get()
    if (!engine || !car) throw new Error('No car is open')
    const isDraft = d === get().draft
    // make sure the texture on screen is the one that gets saved
    if (!isDraft || previewDraft || bakeRunning || !engine.hasLivery) {
      previewDraft = isDraft ? null : d
      await rebake()
    }
    const r = resolved(d)
    const painted = paintedFor(d)
    const extConfig = await engine.cspConfig(r.csp ?? DEFAULT_CSP, painted, baseSkinFor(d))
    const extraFiles = extConfig
      ? [{ name: SKIN_CONFIG_FILE, data: new TextEncoder().encode(extConfig) }]
      : []
    const { textures, copyFiles } = engine.exportPayload(extraFiles.map((f) => f.name))
    if (!textures.length) throw new Error(i18n.t('livery.noTexture'))
    const preview = await engine.previewSize()
    const previewJpg = await encodeImage(
      engine.capturePreview(preview.width, preview.height),
      preview.width,
      preview.height,
      'image/jpeg',
    )
    const icon = await engine.liveryIconSize()
    const liveryPng = await renderLiveryIcon(icon.width, icon.height, r.baseColor)
    const meta = Object.fromEntries(Object.entries(r.meta).filter(([, v]) => v.trim() !== ''))
    return backend.exportSkin({
      carId: car.id,
      skinId,
      textures,
      copyFiles,
      extraFiles,
      encoding: 'auto',
      uiSkin: { skinname: skinId, ...meta },
      previewJpg,
      liveryPng,
      overwrite: mode,
      project: { version: 1, draft: d },
    })
  }

  /** Selected layers in stack order (bottom first). */
  const selectedLayers = (): Layer[] => {
    const selected = new Set(get().selection)
    return get().draft.design.layers.filter((l) => selected.has(l.id))
  }

  const primaryLayer = (): Layer | null =>
    get().draft.design.layers.find((l) => l.id === get().selectedLayer) ?? null

  const refreshOutline = (): void => {
    const { tab, selectedLayer } = get()
    engine?.showOutline(tab === 'livery' ? selectedLayers() : [], selectedLayer)
    const layer = primaryLayer()
    const offPaint = !!layer && !!engine && !engine.layerReachesPaint(layer)
    if (offPaint !== get().selectedOffPaint) set({ selectedOffPaint: offPaint })
  }

  const setSelection = (ids: string[], primary: string | null): void => {
    set({
      selection: ids,
      selectedLayer: primary && ids.includes(primary) ? primary : (ids.at(-1) ?? null),
    })
    refreshOutline()
  }

  /** Forgets selected layers that no longer exist (after undo, removal...). */
  const pruneSelection = (): void => {
    const exists = new Set(get().draft.design.layers.map((l) => l.id))
    const { selection, selectedLayer } = get()
    const kept = selection.filter((id) => exists.has(id))
    if (kept.length !== selection.length || (selectedLayer && !exists.has(selectedLayer))) {
      setSelection(kept, selectedLayer)
    }
  }

  /** Unlocked selected layers and the primary layer whose plane transforms use. */
  const transformable = () => {
    const frame = engine?.displayFrame()
    const primary = primaryLayer()
    const layers = selectedLayers().filter((l) => !l.locked)
    if (!frame || !primary || !layers.length) return null
    return { frame, primary, layers }
  }

  const setPlacements = (placements: Map<string, Placement>): void => {
    const design = get().draft.design
    setDesign({
      ...design,
      layers: design.layers.map((l) =>
        placements.has(l.id) ? { ...l, placement: placements.get(l.id)! } : l,
      ),
    })
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
    set({ selectedLayer: layer.id, selection: [layer.id] })
    setDesign({ ...design, layers: [...design.layers, layer] })
  }

  /** Copies a sticker into the design once; returns its asset id. */
  const stickerAssetSync = (sticker: Sticker): string => {
    const id = stickerAssetId(sticker)
    if (!get().draft.design.assets[id]) {
      const ext = sticker.mime.includes('svg') ? 'svg' : sticker.mime.split('/')[1] || 'png'
      addAsset(id, { name: `${sticker.name}.${ext}`, mime: sticker.mime, data: sticker.data })
    }
    return id
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
      selection: [],
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
    selection: [],
    past: [],
    future: [],
    designError: null,
    selectedOffPaint: false,
    finishMaps: [],
    carParts: null,
    cspMaterials: [],
    userTemplates: [],
    stickers: BUILTIN_STICKERS,
    leagueImport: null,
    leagueRun: IDLE_RUN,
    leaguePreview: null,
    leagueTableOpen: false,
    templateMessage: null,
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
      void get().loadTemplates()
      void get().loadStickers()
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
        carParts: null,
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
          carParts: engine.carParts(),
        })
        engine.setPaintFilter(get().paintedTextures())
        if (showsLivery(get().tab)) void rebake()
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
      if (prev === 'league' && tab !== 'league' && get().leaguePreview) get().previewLeagueRow(null)
      if (showsLivery(tab) && !showsLivery(prev)) void rebake()
      refreshOutline()
      if (!showsLivery(tab) && showsLivery(prev)) void get().showSkin(get().shownSkin)
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
          selection: [],
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
      if (patch.parts !== undefined) pushHistory('parts')
      if (patch.csp !== undefined) pushHistory('csp')
      if (patch.values !== undefined) pushHistory('values')
      if (patch.params !== undefined || patch.bindings !== undefined) pushHistory('params')
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
        patch.parts !== undefined ||
        patch.csp !== undefined ||
        patch.params !== undefined ||
        patch.values !== undefined ||
        patch.bindings !== undefined ||
        patch.aoSource !== undefined ||
        patch.aoStrength !== undefined ||
        patch.liveryTextures !== undefined ||
        patch.baseSkin !== undefined ||
        patch.clearedTextures !== undefined
      ) {
        void rebake()
      }
    },

    updatePart(part, patch) {
      const parts = get().draft.parts ?? DEFAULT_PARTS
      get().updateDraft({ parts: { ...parts, [part]: { ...parts[part], ...patch } } })
    },

    updateCsp(patch) {
      get().updateDraft({ csp: { ...(get().draft.csp ?? DEFAULT_CSP), ...patch } })
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
        const result = await exportDraft(draft, draft.skinId, mode)
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
      return paintedFor(get().draft)
    },

    baseSkinId() {
      return baseSkinFor(get().draft)
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

    selectLayer(id, mode = 'replace') {
      if (!id) return setSelection([], null)
      const { selection, selectedLayer, draft } = get()
      if (mode === 'toggle') {
        const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]
        return setSelection(next, next.includes(id) ? id : selectedLayer)
      }
      if (mode === 'range' && selectedLayer) {
        const ids = draft.design.layers.map((l) => l.id)
        const a = ids.indexOf(selectedLayer)
        const b = ids.indexOf(id)
        if (a >= 0 && b >= 0) return setSelection(ids.slice(Math.min(a, b), Math.max(a, b) + 1), id)
      }
      setSelection([id], id)
    },

    selectGroup(groupId) {
      const ids = groupMembers(get().draft.design, groupId).map((l) => l.id)
      const primary = get().selectedLayer
      setSelection(ids, primary && ids.includes(primary) ? primary : (ids.at(-1) ?? null))
    },

    selectAll() {
      setSelection(
        get().draft.design.layers.map((l) => l.id),
        get().selectedLayer,
      )
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
          const d = get().draft
          const shown = resolveLayer(next, paramValues(d.params ?? [], d.values), d.design.assets)
          const aspect = await textAspect(shown as TextLayer, d.design.assets)
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

    setLayersFlag(ids, patch) {
      const chosen = new Set(ids)
      if (!chosen.size) return
      pushHistory()
      const design = get().draft.design
      setDesign({
        ...design,
        layers: design.layers.map((l) => (chosen.has(l.id) ? { ...l, ...patch } : l)),
      })
    },

    removeSelection() {
      const { selection, draft } = get()
      if (!selection.length) return
      pushHistory()
      setDesign(removeLayers(draft.design, selection, paramAssets(draft)))
      setSelection([], null)
    },

    duplicateSelection() {
      const originals = selectedLayers()
      if (!originals.length) return
      pushHistory()
      const { design, ids } = duplicateLayers(get().draft.design, get().selection)
      const primaryIndex = originals.findIndex((l) => l.id === get().selectedLayer)
      setDesign(design)
      setSelection(ids, ids[primaryIndex] ?? ids.at(-1) ?? null)
    },

    moveSelection(delta) {
      const design = get().draft.design
      const next = moveLayers(design, get().selection, delta)
      if (next === design) return
      pushHistory()
      setDesign(next)
    },

    groupSelection() {
      const design = get().draft.design
      const name = i18n.t('design.groupName', {
        n: Object.keys(design.groups ?? {}).length + 1,
      })
      const { design: next, groupId } = groupLayers(design, get().selection, name)
      if (!groupId) return
      pushHistory()
      setDesign(next)
    },

    ungroupSelection() {
      const groups = new Set(selectedLayers().flatMap((l) => (l.group ? [l.group] : [])))
      if (!groups.size) return
      pushHistory()
      let design = get().draft.design
      for (const g of groups) design = ungroup(design, g)
      setDesign(design)
    },

    renameGroup(groupId, name) {
      const design = get().draft.design
      if (!design.groups?.[groupId]) return
      pushHistory(`rename:${groupId}`)
      setDesign({ ...design, groups: { ...design.groups, [groupId]: { name } } })
    },

    alignSelection(mode) {
      const t = transformable()
      if (!t || t.layers.length < 2) return
      const { frame, primary, layers } = t
      const all = selectionBounds(
        frame,
        layers.map((l) => l.placement),
        primary.placement,
      )
      const ref = basis(frame, primary.placement).origin
      const u = (p: V3) => vdot(vsub(p, ref), all.right)
      const v = (p: V3) => vdot(vsub(p, ref), all.up)
      const placements = new Map<string, Placement>()
      for (const l of layers) {
        const own = selectionBounds(frame, [l.placement], primary.placement)
        let du = 0
        let dv = 0
        if (mode === 'left') du = u(all.center) - all.width / 2 - (u(own.center) - own.width / 2)
        if (mode === 'hcenter') du = u(all.center) - u(own.center)
        if (mode === 'right') du = u(all.center) + all.width / 2 - (u(own.center) + own.width / 2)
        if (mode === 'bottom')
          dv = v(all.center) - all.height / 2 - (v(own.center) - own.height / 2)
        if (mode === 'vcenter') dv = v(all.center) - v(own.center)
        if (mode === 'top') dv = v(all.center) + all.height / 2 - (v(own.center) + own.height / 2)
        const delta = vadd(vscale(all.right, du), vscale(all.up, dv))
        placements.set(l.id, moveSelection(frame, [l.placement], delta, all.dir)[0]!)
      }
      pushHistory()
      setPlacements(placements)
    },

    centerSelection(axis) {
      const t = transformable()
      if (!t) return
      const { frame, primary, layers } = t
      const b = selectionBounds(
        frame,
        layers.map((l) => l.placement),
        primary.placement,
      )
      const pos = worldToPosition(frame, b.center)
      const delta =
        axis === 'width'
          ? vscale(frame.left, (-pos[0] * frame.width) / 2)
          : vscale(frame.forward, (-pos[2] * frame.length) / 2)
      const moved = moveSelection(
        frame,
        layers.map((l) => l.placement),
        delta,
        b.dir,
      )
      pushHistory()
      setPlacements(new Map(layers.map((l, i) => [l.id, moved[i]!])))
    },

    nudgeSelection(dx, dy) {
      const t = transformable()
      if (!t) return
      const { frame, primary, layers } = t
      const b = selectionBounds(
        frame,
        layers.map((l) => l.placement),
        primary.placement,
      )
      const delta = vadd(vscale(b.right, dx * frame.length), vscale(b.up, dy * frame.length))
      const moved = moveSelection(
        frame,
        layers.map((l) => l.placement),
        delta,
        b.dir,
      )
      pushHistory(`nudge:${get().selection.join(',')}`)
      setPlacements(new Map(layers.map((l, i) => [l.id, moved[i]!])))
    },

    transformSelection(op, historyTag) {
      const t = transformable()
      if (!t) return
      const { frame, primary, layers } = t
      let placements = layers.map((l) => l.placement)
      const b = selectionBounds(frame, placements, primary.placement)
      if (op.scale !== undefined) {
        placements = scaleSelection(frame, placements, b.center, op.scale, b.dir)
      }
      if (op.rotate !== undefined) {
        placements = rotateSelection(frame, placements, b.center, op.rotate, b.dir)
      }
      pushHistory(historyTag)
      setPlacements(new Map(layers.map((l, i) => [l.id, placements[i]!])))
    },

    selectionBounds() {
      const frame = engine?.displayFrame()
      const primary = primaryLayer()
      const layers = selectedLayers()
      if (!frame || !primary || !layers.length || get().tab !== 'livery') return null
      return selectionBounds(
        frame,
        layers.map((l) => l.placement),
        primary.placement,
      )
    },

    beginGizmo() {
      const t = transformable()
      if (!t) return
      const placements = t.layers.map((l) => l.placement)
      gizmo = {
        ids: t.layers.map((l) => l.id),
        placements,
        bounds: selectionBounds(t.frame, placements, t.primary.placement),
        primaryRotation: t.primary.placement.rotation,
      }
      lastHistoryTag = null
      pushHistory('gizmo')
    },

    gizmoUpdate({ scale, rotate, snap }) {
      const g = gizmo
      const frame = engine?.displayFrame()
      if (!g || !frame || !engine) return
      let placements = g.placements
      if (scale !== undefined) {
        placements = scaleSelection(
          frame,
          placements,
          g.bounds.center,
          Math.max(0.02, scale),
          g.bounds.dir,
        )
      }
      if (rotate !== undefined) {
        // the camera sees the vinyl from the projector's side unless it looks back at it
        const facing = vdot(engine.viewer.cameraDirection(), g.bounds.dir) >= 0 ? 1 : -1
        const wanted = g.primaryRotation + rotate * facing
        const total = snap ? snapAngle(wanted, 15) : snapAngle(wanted, 90, 3)
        placements = rotateSelection(
          frame,
          placements,
          g.bounds.center,
          total - g.primaryRotation,
          g.bounds.dir,
        )
      }
      setPlacements(new Map(g.ids.map((id, i) => [id, placements[i]!])))
    },

    endGizmo() {
      gizmo = null
    },

    setParamValue(id, value) {
      get().updateDraft({ values: { ...get().draft.values, [id]: value } })
    },

    async setParamImage(id, file) {
      try {
        const data = await fileToDataUrl(file)
        const asset: Asset = { name: file.name, mime: file.type || 'image/png', data }
        await imageAspect(asset)
        const assetId = newId('a')
        addAsset(assetId, asset)
        get().setParamValue(id, assetId)
        set({ designError: null })
      } catch (err) {
        set({ designError: err instanceof Error ? err.message : String(err) })
      }
    },

    addParam(kind) {
      const params = get().draft.params ?? []
      let n = 1
      while (params.some((p) => p.id === `${kind}${n}`)) n++
      const param: TemplateParam = {
        id: `${kind}${n}`,
        kind,
        label: i18n.t(`params.kinds.${kind}`) + ` ${n}`,
        default: kind === 'color' ? '#ffffff' : kind === 'text' ? i18n.t('params.sampleText') : '',
      }
      get().updateDraft({ params: [...params, param] })
    },

    addStandardParams() {
      const params = get().draft.params ?? []
      const missing = STANDARD_PARAMS.filter((p) => !params.some((q) => q.id === p.id))
      get().updateDraft({ params: [...params, ...missing] })
    },

    updateParam(id, patch) {
      const params = get().draft.params ?? []
      get().updateDraft({ params: params.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
    },

    removeParam(id) {
      pushHistory()
      const draft = get().draft
      const values = { ...draft.values }
      delete values[id]
      const bindings = Object.fromEntries(
        Object.entries(draft.bindings ?? {}).filter(([, p]) => p !== id),
      ) as DraftBindings
      const params = (draft.params ?? []).filter((p) => p.id !== id)
      const next: LiveryDraft = { ...draft, params, values, bindings }
      const layers = draft.design.layers.map((l) => {
        if (!l.bindings || !Object.values(l.bindings).includes(id)) return l
        const b = Object.fromEntries(
          Object.entries(l.bindings).filter(([, p]) => p !== id),
        ) as LayerBindings
        return { ...l, bindings: b }
      })
      set({
        draft: {
          ...next,
          design: pruneAssets({ ...draft.design, layers }, paramAssets(next)),
        },
        exportState: { status: 'idle' },
      })
      void rebake()
    },

    bindLayer(id, prop, paramId) {
      pushHistory(`bind:${id}:${prop}`)
      mapLayer(id, (l) => {
        const bindings: LayerBindings = { ...l.bindings }
        if (paramId) bindings[prop] = paramId
        else delete bindings[prop]
        return { ...l, bindings }
      })
    },

    bindDraft(target, paramId) {
      const bindings: DraftBindings = { ...get().draft.bindings }
      if (paramId) bindings[target] = paramId
      else delete bindings[target]
      get().updateDraft({ bindings })
    },

    applyTemplate(t) {
      previewDraft = null
      pushHistory()
      const draft = get().draft
      // values typed earlier (number, driver...) carry over to the new template
      const kept = Object.fromEntries(
        Object.entries(draft.values ?? {}).filter(
          ([id, v]) => t.params.some((p) => p.id === id && p.kind !== 'image') && v !== '',
        ),
      )
      const next: LiveryDraft = {
        ...draft,
        baseColor: t.baseColor,
        baseFinish: t.baseFinish ?? 'stock',
        parts: t.parts ?? DEFAULT_PARTS,
        csp: t.csp ?? DEFAULT_CSP,
        design: t.design,
        params: t.params,
        values: { ...t.values, ...kept },
        bindings: t.bindings ?? {},
        template: t.name,
        meta: { ...draft.meta, ...t.meta },
      }
      set({ draft: next, exportState: { status: 'idle' } })
      setSelection([], null)
      void rebake()
    },

    previewTemplate(t) {
      if (!t) {
        if (!previewDraft) return
        previewDraft = null
        void rebake()
        return
      }
      const draft = get().draft
      previewDraft = {
        ...draft,
        baseColor: t.baseColor,
        baseFinish: t.baseFinish ?? 'stock',
        parts: t.parts ?? DEFAULT_PARTS,
        csp: t.csp ?? DEFAULT_CSP,
        design: t.design,
        params: t.params,
        values: { ...t.values, ...draft.values },
        bindings: t.bindings ?? {},
      }
      void rebake()
    },

    updateLeague(patch) {
      const league = get().draft.league ?? DEFAULT_LEAGUE
      set({ draft: { ...get().draft, league: { ...league, ...patch } } })
    },

    addLeagueRow() {
      const league = get().draft.league ?? DEFAULT_LEAGUE
      const row: LeagueRow = { id: newRowId(), values: {} }
      set({ draft: { ...get().draft, league: { ...league, rows: [...league.rows, row] } } })
    },

    updateLeagueRow(id, values) {
      const league = get().draft.league ?? DEFAULT_LEAGUE
      const rows = league.rows.map((r) =>
        r.id === id ? { ...r, values: { ...r.values, ...values } } : r,
      )
      set({ draft: { ...get().draft, league: { ...league, rows } } })
      if (get().leaguePreview === id) get().previewLeagueRow(id)
    },

    removeLeagueRow(id) {
      const league = get().draft.league ?? DEFAULT_LEAGUE
      const rows = league.rows.filter((r) => r.id !== id)
      set({ draft: { ...get().draft, league: { ...league, rows } } })
      if (get().leaguePreview === id) get().previewLeagueRow(null)
    },

    clearLeague() {
      const league = get().draft.league ?? DEFAULT_LEAGUE
      set({ draft: { ...get().draft, league: { ...league, rows: [] } } })
      get().previewLeagueRow(null)
    },

    async openLeagueFile(file) {
      try {
        const cells = readTable(new Uint8Array(await file.arrayBuffer()), file.name)
        if (!cells.length) throw new Error(i18n.t('league.emptyFile'))
        const params = get().draft.params ?? []
        set({
          leagueTableOpen: true,
          leagueImport: {
            fileName: file.name,
            cells,
            mapping: guessMapping(cells[0]!, params),
            header: true,
          },
          leagueRun: { ...get().leagueRun, problems: [] },
        })
      } catch (err) {
        console.error(err)
        set({ designError: err instanceof Error ? err.message : String(err) })
      }
    },

    setImportMapping(column, paramId) {
      const im = get().leagueImport
      if (!im) return
      const mapping = im.mapping.map((m, i) =>
        i === column ? paramId : m === paramId && paramId ? null : m,
      )
      set({ leagueImport: { ...im, mapping } })
    },

    setImportHeader(header) {
      const im = get().leagueImport
      if (im) set({ leagueImport: { ...im, header } })
    },

    confirmImport(mode) {
      const im = get().leagueImport
      if (!im) return
      const draft = get().draft
      const params = draft.params ?? []
      // image cells name a sticker of the library or an image of the design
      const { stickers } = get()
      const assets = draft.design.assets
      const resolveImage = (value: string): string | null => {
        const v = value
          .trim()
          .toLowerCase()
          .replace(/\.(png|jpe?g|webp|svg)$/, '')
        const sticker = stickers.find((s) => s.name.toLowerCase() === v)
        if (sticker) return stickerAssetSync(sticker)
        const own = Object.entries(get().draft.design.assets).find(
          ([, a]) => a.name.toLowerCase().replace(/\.[^.]+$/, '') === v,
        )
        return own?.[0] ?? (assets[value] ? value : null)
      }
      const { rows, problems } = rowsFromCells(im.cells, im.mapping, params, {
        header: im.header,
        resolveImage,
      })
      const league = get().draft.league ?? DEFAULT_LEAGUE
      set({
        draft: {
          ...get().draft,
          league: { ...league, rows: mode === 'append' ? [...league.rows, ...rows] : rows },
        },
        leagueImport: null,
        leagueRun: { ...IDLE_RUN, problems },
      })
    },

    cancelImport() {
      set({ leagueImport: null })
    },

    previewLeagueRow(id) {
      set({ leaguePreview: id })
      const draft = get().draft
      const row = id ? draft.league?.rows.find((r) => r.id === id) : undefined
      previewDraft = row ? { ...draft, values: { ...draft.values, ...row.values } } : null
      void rebake()
    },

    async runLeague() {
      const st = get()
      const draft = st.draft
      const league = draft.league ?? DEFAULT_LEAGUE
      if (!engine || !st.car || !league.rows.length || st.leagueRun.status === 'running') return
      const homeCar = st.car.id
      const cars = league.cars.length ? league.cars : [homeCar]
      const params = draft.params ?? []
      leagueCancelled = false
      set({
        leaguePreview: null,
        leagueRun: {
          ...IDLE_RUN,
          status: 'running',
          total: league.rows.length * cars.length,
        },
      })
      const results: LeagueResult[] = []
      const push = (r: LeagueResult) => {
        results.push(r)
        set({ leagueRun: { ...get().leagueRun, done: results.length, results: [...results] } })
      }
      const display = (row: LeagueRow) => textValues(params, { ...draft.values, ...row.values })
      const folders = skinFolders(league.rows, league.folder, display)
      try {
        for (const carId of cars) {
          if (leagueCancelled) break
          const carName = get().cars.find((c) => c.id === carId)?.name ?? carId
          if (get().car?.id !== carId) await get().selectCar(carId)
          if (get().car?.id !== carId || get().load.status !== 'ready') {
            for (const row of league.rows) {
              push({
                car: carName,
                skin: '',
                driver: display(row).driver ?? '',
                ok: false,
                message: i18n.t('league.carFailed'),
              })
            }
            continue
          }
          for (const [i, row] of league.rows.entries()) {
            if (leagueCancelled) break
            const skinId = folders[i]!
            const names = display(row)
            set({ leagueRun: { ...get().leagueRun, current: `${carName}: ${skinId}` } })
            const rowDraft: LiveryDraft = {
              ...draft,
              // texture choices belong to the car the design was made on
              ...(carId === homeCar
                ? {}
                : { liveryTextures: 'auto' as const, baseSkin: 'auto', clearedTextures: [] }),
              values: { ...draft.values, ...row.values },
              meta: { ...draft.meta, skinname: fillText(league.skinName, names) },
              skinId,
              skinIdTouched: true,
            }
            try {
              const status = await get().backend.checkSkin(carId, skinId)
              if (status.exists && !status.ours) {
                push({
                  car: carName,
                  skin: skinId,
                  driver: names.driver ?? '',
                  ok: false,
                  message: i18n.t('league.foreign'),
                })
                continue
              }
              const result = await exportDraft(rowDraft, skinId, 'ours')
              push({
                car: carName,
                skin: skinId,
                driver: names.driver ?? '',
                ok: result.ok,
                message: result.ok ? undefined : result.message,
              })
            } catch (err) {
              console.error(err)
              push({
                car: carName,
                skin: skinId,
                driver: names.driver ?? '',
                ok: false,
                message: err instanceof Error ? err.message : String(err),
              })
            }
          }
          const updated = await get().backend.getCar(carId)
          engine?.updateCarDetails(updated)
          set({ car: updated })
        }
      } finally {
        previewDraft = null
        if (get().car?.id !== homeCar) await get().selectCar(homeCar)
        else void rebake()
        set({
          leagueRun: {
            ...get().leagueRun,
            status: leagueCancelled ? 'cancelled' : 'done',
            current: null,
          },
        })
        void get().loadCars()
      }
    },

    cancelLeague() {
      leagueCancelled = true
    },

    dismissLeagueRun() {
      set({ leagueRun: IDLE_RUN })
    },

    setLeagueTableOpen(open) {
      set({ leagueTableOpen: open })
      if (!open && get().leaguePreview) get().previewLeagueRow(null)
    },

    async loadStickers() {
      try {
        const user = await get().backend.listStickers()
        set({
          stickers: [
            ...BUILTIN_STICKERS,
            ...user.map((u) => ({
              id: u.id,
              name: u.name,
              mime: u.mime,
              data: bytesToDataUrl(u.data, u.mime),
            })),
          ],
        })
      } catch (err) {
        console.error(err)
      }
    },

    async addToLibrary(files) {
      try {
        for (const file of files) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const mime = file.type || (/\.svg$/i.test(file.name) ? 'image/svg+xml' : 'image/png')
          // check it decodes before it goes into the library
          await imageAspect({ name: file.name, mime, data: bytesToDataUrl(bytes, mime) })
          await get().backend.addSticker(file.name.replace(/\.[^.]+$/, ''), mime, bytes)
        }
        set({ designError: null })
      } catch (err) {
        set({ designError: err instanceof Error ? err.message : String(err) })
      }
      await get().loadStickers()
    },

    async removeFromLibrary(id) {
      await get().backend.deleteSticker(id)
      await get().loadStickers()
    },

    async stickerAsset(sticker) {
      return stickerAssetSync(sticker)
    },

    async addStickerLayer(sticker) {
      try {
        const aspect = await imageAspect({
          name: sticker.name,
          mime: sticker.mime,
          data: sticker.data,
        })
        const id = await get().stickerAsset(sticker)
        addLayer(newImageLayer(id, sticker.name, initialPlacement(0.16), aspect))
        set({ designError: null })
      } catch (err) {
        set({ designError: err instanceof Error ? err.message : String(err) })
      }
    },

    async loadTemplates() {
      try {
        const list = await get().backend.listTemplates()
        for (const t of get().userTemplates) if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
        set({
          userTemplates: list.map((t) => ({
            id: t.id,
            name: t.name,
            savedAt: t.savedAt,
            previewUrl: t.preview
              ? URL.createObjectURL(new Blob([t.preview as BlobPart], { type: 'image/jpeg' }))
              : undefined,
          })),
        })
      } catch (err) {
        console.error(err)
      }
    },

    async userTemplate(id) {
      const cached = templateCache.get(id)
      if (cached) return cached
      try {
        const doc = unpackProject(await get().backend.readTemplate(id))
        const d = normalizeDraft(doc.draft)
        const t: TemplateDraft = {
          name: doc.template?.name ?? id,
          baseColor: d.baseColor,
          baseFinish: d.baseFinish,
          parts: d.parts,
          csp: d.csp,
          design: d.design,
          params: d.params ?? [],
          values: d.values,
          bindings: d.bindings,
          // only fields filled from parameters; the skin's own name stays
          meta: Object.fromEntries(
            Object.entries(d.meta).filter(([, v]) => /\{[^}]+\}/.test(v)),
          ) as Partial<LiveryMeta>,
        }
        templateCache.set(id, t)
        return t
      } catch (err) {
        console.error(err)
        set({ templateMessage: { kind: 'error', text: String(err) } })
        return null
      }
    },

    async saveAsTemplate(name) {
      const { draft, car, backend } = get()
      const title = name.trim()
      if (!title) return
      try {
        if (previewDraft) {
          previewDraft = null
          await rebake()
        } else await whenBaked()
        const preview = engine
          ? await encodeImage(engine.capturePreview(320, 180), 320, 180, 'image/jpeg')
          : undefined
        const bytes = packProject({
          carId: car?.id ?? null,
          draft: { ...draft, template: title },
          template: { name: title },
          preview,
        })
        await backend.saveTemplate(bytes)
        await get().loadTemplates()
        set({ templateMessage: { kind: 'ok', text: i18n.t('templates.saved', { name: title }) } })
      } catch (err) {
        console.error(err)
        set({ templateMessage: { kind: 'error', text: String(err) } })
      }
    },

    async deleteTemplate(id) {
      await get().backend.deleteTemplate(id)
      templateCache.delete(id)
      await get().loadTemplates()
    },

    async importTemplate() {
      const { backend } = get()
      try {
        const file = await backend.openProject()
        if (!file) return
        const doc = unpackProject(file.bytes)
        // a plain project becomes a template named after its file
        const bytes = doc.template
          ? file.bytes
          : packProject({
              ...doc,
              template: {
                name: file.path
                  .split(/[\\/]/)
                  .pop()!
                  .replace(/\.aclivery$/i, ''),
              },
            })
        await backend.saveTemplate(bytes)
        await get().loadTemplates()
      } catch (err) {
        console.error(err)
        set({ templateMessage: { kind: 'error', text: String(err) } })
      }
    },

    async exportTemplate(id) {
      const { backend, userTemplates } = get()
      try {
        const bytes = await backend.readTemplate(id)
        const name = userTemplates.find((t) => t.id === id)?.name ?? id
        await backend.saveProject(bytes, { suggestedName: projectFileName(name) })
      } catch (err) {
        console.error(err)
        set({ templateMessage: { kind: 'error', text: String(err) } })
      }
    },

    clearDesign() {
      pushHistory()
      setDesign(EMPTY_DESIGN)
      setSelection([], null)
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
      pruneSelection()
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
      pruneSelection()
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
          down(hit, event) {
            const st = get()
            if (st.tab !== 'livery' || !hit) return false
            const id = controller.layerAt(hit.point, st.draft.design)
            if (!id) return false
            const layer = st.draft.design.layers.find((l) => l.id === id)!
            if (event.ctrlKey || event.metaKey || event.shiftKey) {
              // add to / remove from the selection; the click does not orbit the camera
              st.selectLayer(id, 'toggle')
              drag = null
              return true
            }
            if (!st.selection.includes(id)) {
              // clicking on the car picks the whole group, like in Forza
              const ids = layer.group
                ? groupMembers(st.draft.design, layer.group).map((l) => l.id)
                : [id]
              setSelection(ids, id)
            } else setSelection(st.selection, id)
            const frame = controller.displayFrame()
            if (layer.locked || !frame) return false
            const grabbed = worldToPosition(frame, hit.point)
            const p = layer.placement.position
            drag = {
              id,
              offset: [p[0] - grabbed[0], p[1] - grabbed[1], p[2] - grabbed[2]],
              start: new Map(
                selectedLayers()
                  .filter((l) => !l.locked)
                  .map((l) => [l.id, l.placement]),
              ),
              startOrigin: positionToWorld(frame, p),
              startDir: basis(frame, layer.placement).dir,
            }
            lastHistoryTag = null
            pushHistory(`drag:${id}`)
            return true
          },
          move(hit, event) {
            const current = drag
            const frame = controller.displayFrame()
            if (!current || !hit || !frame) return
            const startPlacement = current.start.get(current.id)
            const placed = startPlacement && controller.placeAtHit(startPlacement, hit)
            if (!placed) return
            const o = current.offset
            const lead: Placement = {
              ...placed,
              position: [
                placed.position[0] + o[0],
                placed.position[1] + o[1],
                placed.position[2] + o[2],
              ],
            }
            const delta = vsub(positionToWorld(frame, lead.position), current.startOrigin)
            const others = [...current.start].filter(([id]) => id !== current.id)
            const moved = moveSelection(
              frame,
              others.map(([, p]) => p),
              delta,
              current.startDir,
            )
            const next = new Map<string, Placement>([[current.id, lead]])
            others.forEach(([id, p], i) => {
              // vinyls on the same face follow the lead onto a new face
              const sameFace = vdot(basis(frame, p).dir, current.startDir) > 0.95
              next.set(id, sameFace ? { ...moved[i]!, direction: lead.direction } : moved[i]!)
            })
            // snap to the centre line on the roof, bonnet, nose and tail (Alt: free)
            const dir = basis(frame, lead).dir
            if (!event.altKey && Math.abs(vdot(dir, frame.left)) < 0.7) {
              const b = selectionBounds(frame, [...next.values()], lead)
              const cx = worldToPosition(frame, b.center)[0]
              if (Math.abs(cx) < CENTRE_SNAP) {
                const shift = vscale(frame.left, (-cx * frame.width) / 2)
                for (const [id, p] of next) next.set(id, moveSelection(frame, [p], shift, dir)[0]!)
              }
            }
            setPlacements(next)
          },
          up() {
            drag = null
          },
          wheel(e) {
            const st = get()
            if (st.tab !== 'livery' || !(e.shiftKey || e.altKey)) return false
            if (!transformable()) return false
            // Shift turns the wheel into horizontal scrolling in some browsers
            const up = (e.deltaY || e.deltaX) < 0
            const key = st.selection.join(',')
            if (e.shiftKey) {
              st.transformSelection({ scale: up ? 1.06 : 1 / 1.06 }, `wheel-scale:${key}`)
            } else {
              st.transformSelection({ rotate: up ? 5 : -5 }, `wheel-rotate:${key}`)
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

/** Resolves once the livery on screen matches the current draft. */
export function whenBaked(): Promise<void> {
  return bakeRunning ?? Promise.resolve()
}

/** The engine of the mounted viewport (for overlays drawn over the canvas). */
export function currentEngine(): EngineController | null {
  return engine
}

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
  const parts = asRecord(stored.parts)
  return {
    ...DEFAULT_DRAFT,
    ...stored,
    meta: { ...DEFAULT_DRAFT.meta, ...asRecord(stored.meta) },
    parts: {
      rims: { ...DEFAULT_PARTS.rims, ...asRecord(parts.rims) },
      calipers: { ...DEFAULT_PARTS.calipers, ...asRecord(parts.calipers) },
      glass: { ...DEFAULT_PARTS.glass, ...asRecord(parts.glass) },
    },
    csp: { ...DEFAULT_CSP, ...asRecord(stored.csp) },
    league: {
      ...DEFAULT_LEAGUE,
      ...(asRecord(stored.league) as Partial<LeagueTable>),
      rows: Array.isArray(asRecord(stored.league).rows)
        ? (asRecord(stored.league).rows as LeagueRow[])
        : [],
    },
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

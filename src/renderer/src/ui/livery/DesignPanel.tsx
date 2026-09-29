import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FINISHES,
  SHAPES,
  SYSTEM_FONTS,
  fontAssetId,
  type BaseFinish,
  type Layer,
  type LayerFinish,
  type MirrorMode,
  type TextLayer,
} from '@shared/design/types'
import { useStore, type AlignMode, type SelectMode } from '../../state/store'
import { BindSelect, BoundColor, useParams } from './Binding'
import { ShapeIcon } from './ShapeIcon'
import { Slider } from './Slider'
import { StickerPicker } from './StickerPicker'

const IMAGE_TYPES = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml'
const FONT_TYPES = '.ttf,.otf,.woff,.woff2'

export function DesignPanel() {
  const { t } = useTranslation()
  const draft = useStore((s) => s.draft)
  const update = useStore((s) => s.updateDraft)
  const addShape = useStore((s) => s.addShape)
  const addText = useStore((s) => s.addText)
  const addImage = useStore((s) => s.addImage)
  const error = useStore((s) => s.designError)
  const finishMaps = useStore((s) => s.finishMaps)
  const bindDraft = useStore((s) => s.bindDraft)
  const imageInput = useRef<HTMLInputElement>(null)
  const baseFinish = draft.baseFinish ?? 'stock'
  const [showStickers, setShowStickers] = useState(false)
  const addStickerLayer = useStore((s) => s.addStickerLayer)

  return (
    <>
      <section>
        <h3>{t('livery.base')}</h3>
        <BoundColor
          value={draft.baseColor}
          onChange={(baseColor) => update({ baseColor })}
          label={t('livery.base')}
          binding={draft.bindings?.baseColor}
          onBind={(p) => bindDraft('baseColor', p)}
          swatches
        />
        <label className="field">
          <span>{t('design.baseFinish')}</span>
          <select
            value={baseFinish}
            onChange={(e) => update({ baseFinish: e.target.value as BaseFinish })}
          >
            {(['stock', ...FINISHES] as const).map((f) => (
              <option key={f} value={f}>
                {t(`design.finishes.${f}`)}
              </option>
            ))}
          </select>
        </label>
        {baseFinish !== 'stock' && finishMaps.length === 0 && (
          <p className="hint">{t('design.noFinishMaps')}</p>
        )}
      </section>

      <section>
        <h3>{t('design.add')}</h3>
        <div className="add-grid">
          {SHAPES.map((shape) => (
            <button
              key={shape}
              className="tool"
              title={t(`design.shapes.${shape}`)}
              aria-label={t(`design.shapes.${shape}`)}
              onClick={() => addShape(shape)}
            >
              <ShapeIcon shape={shape} />
            </button>
          ))}
        </div>
        <div className="row gap wrap">
          <button className="btn small" onClick={() => void addText(t('design.defaultText'))}>
            {t('design.addText')}
          </button>
          <button className="btn small" onClick={() => void addText('27')}>
            {t('design.addNumber')}
          </button>
          <button className="btn small" onClick={() => imageInput.current?.click()}>
            {t('design.addImage')}
          </button>
          <button
            className={`btn small ${showStickers ? 'active' : ''}`}
            aria-expanded={showStickers}
            onClick={() => setShowStickers((v) => !v)}
          >
            {t('stickers.open')}
          </button>
          <input
            ref={imageInput}
            type="file"
            accept={IMAGE_TYPES}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void addImage(file)
              e.target.value = ''
            }}
          />
        </div>
        {showStickers && <StickerPicker onPick={(s) => void addStickerLayer(s)} />}
        {error && <p className="notice error">{error}</p>}
        <p className="hint">{t('design.mouseHint')}</p>
      </section>

      <LayerList />
      <SelectionPanel />
      <LayerProperties />
    </>
  )
}

type Row =
  | { kind: 'group'; id: string; name: string; members: Layer[] }
  | { kind: 'layer'; layer: Layer; inGroup: boolean }

function LayerIcon({ layer }: { layer: Layer }) {
  return (
    <span className="layer-kind" aria-hidden>
      {layer.kind === 'shape' ? (
        <ShapeIcon shape={layer.shape} />
      ) : layer.kind === 'text' ? (
        'T'
      ) : (
        '▣'
      )}
    </span>
  )
}

function selectMode(e: React.MouseEvent): SelectMode {
  return e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'replace'
}

function LayerList() {
  const { t } = useTranslation()
  const design = useStore((s) => s.draft.design)
  const selection = useStore((s) => s.selection)
  const primary = useStore((s) => s.selectedLayer)
  const select = useStore((s) => s.selectLayer)
  const selectGroup = useStore((s) => s.selectGroup)
  const setFlag = useStore((s) => s.setLayersFlag)
  const move = useStore((s) => s.moveSelection)
  const duplicate = useStore((s) => s.duplicateSelection)
  const remove = useStore((s) => s.removeSelection)
  const group = useStore((s) => s.groupSelection)
  const ungroupSel = useStore((s) => s.ungroupSelection)
  const clear = useStore((s) => s.clearDesign)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const layers = design.layers
  const selected = new Set(selection)
  const anyGrouped = layers.some((l) => selected.has(l.id) && l.group)

  const rows: Row[] = []
  const seen = new Set<string>()
  for (const layer of [...layers].reverse()) {
    const g = layer.group
    if (g && !seen.has(g)) {
      seen.add(g)
      rows.push({
        kind: 'group',
        id: g,
        name: design.groups?.[g]?.name ?? g,
        members: layers.filter((l) => l.group === g),
      })
    }
    if (!g || !collapsed[g]) rows.push({ kind: 'layer', layer, inGroup: !!g })
  }

  return (
    <section>
      <div className="section-head">
        <h3>{t('design.layers', { count: layers.length })}</h3>
        <div className="row">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} title={t('design.undo')}>
            ↶
          </button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} title={t('design.redo')}>
            ↷
          </button>
        </div>
      </div>
      {layers.length === 0 ? (
        <p className="hint">{t('design.empty')}</p>
      ) : (
        <ul
          className="layer-list"
          role="listbox"
          aria-multiselectable
          aria-label={t('design.layers', { count: layers.length })}
        >
          {rows.map((row) => {
            if (row.kind === 'group') {
              const allSelected = row.members.every((m) => selected.has(m.id))
              const allVisible = row.members.every((m) => m.visible)
              const allLocked = row.members.every((m) => m.locked)
              const ids = row.members.map((m) => m.id)
              return (
                <li
                  key={`g:${row.id}`}
                  role="option"
                  aria-selected={allSelected}
                  className={`layer-row group-row ${allSelected ? 'selected' : ''}`}
                  onClick={() => selectGroup(row.id)}
                >
                  <button
                    className="icon-btn"
                    title={t(collapsed[row.id] ? 'design.expand' : 'design.collapse')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setCollapsed((c) => ({ ...c, [row.id]: !c[row.id] }))
                    }}
                  >
                    {collapsed[row.id] ? '▸' : '▾'}
                  </button>
                  <span className="layer-kind" aria-hidden>
                    ⧉
                  </span>
                  <span className="layer-name">
                    {row.name} <span className="muted">· {row.members.length}</span>
                  </span>
                  <button
                    className="icon-btn"
                    title={t(allVisible ? 'design.hide' : 'design.show')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setFlag(ids, { visible: !allVisible })
                    }}
                  >
                    {allVisible ? '◉' : '○'}
                  </button>
                  <button
                    className={`icon-btn ${allLocked ? 'on' : ''}`}
                    title={t(allLocked ? 'design.unlock' : 'design.lock')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setFlag(ids, { locked: !allLocked })
                    }}
                  >
                    {allLocked ? '🔒' : '🔓'}
                  </button>
                </li>
              )
            }
            const { layer } = row
            const isSelected = selected.has(layer.id)
            return (
              <li
                key={layer.id}
                role="option"
                aria-selected={isSelected}
                className={`layer-row ${isSelected ? 'selected' : ''} ${layer.id === primary ? 'primary' : ''} ${layer.visible ? '' : 'hidden'} ${row.inGroup ? 'in-group' : ''}`}
                onClick={(e) => select(layer.id, selectMode(e))}
              >
                <button
                  className="icon-btn"
                  title={t(layer.visible ? 'design.hide' : 'design.show')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setFlag([layer.id], { visible: !layer.visible })
                  }}
                >
                  {layer.visible ? '◉' : '○'}
                </button>
                <LayerIcon layer={layer} />
                <span className="layer-name">{layer.name}</span>
                <button
                  className={`icon-btn ${layer.locked ? 'on' : ''}`}
                  title={t(layer.locked ? 'design.unlock' : 'design.lock')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setFlag([layer.id], { locked: !layer.locked })
                  }}
                >
                  {layer.locked ? '🔒' : '🔓'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {selection.length > 0 && (
        <div className="row gap wrap">
          <button className="btn small" onClick={() => move(1)} title={t('design.up')}>
            ↑
          </button>
          <button className="btn small" onClick={() => move(-1)} title={t('design.down')}>
            ↓
          </button>
          <button className="btn small" onClick={duplicate} title={t('design.duplicateHint')}>
            {t('design.duplicate')}
          </button>
          <button className="btn small" onClick={remove}>
            {t('design.delete')}
          </button>
          {selection.length > 1 && (
            <button className="btn small" onClick={group} title={t('design.groupHint')}>
              {t('design.group')}
            </button>
          )}
          {anyGrouped && (
            <button className="btn small" onClick={ungroupSel} title={t('design.ungroupHint')}>
              {t('design.ungroup')}
            </button>
          )}
        </div>
      )}
      {layers.length > 0 && (
        <button className="btn ghost small" onClick={clear}>
          {t('design.clear')}
        </button>
      )}
    </section>
  )
}

const ALIGN: { mode: AlignMode; icon: string }[] = [
  { mode: 'left', icon: '⇤' },
  { mode: 'hcenter', icon: '↔' },
  { mode: 'right', icon: '⇥' },
  { mode: 'top', icon: '⤒' },
  { mode: 'vcenter', icon: '↕' },
  { mode: 'bottom', icon: '⤓' },
]

/** Arranging the selection: group name, alignment, centring on the car. */
function SelectionPanel() {
  const { t } = useTranslation()
  const design = useStore((s) => s.draft.design)
  const selection = useStore((s) => s.selection)
  const align = useStore((s) => s.alignSelection)
  const center = useStore((s) => s.centerSelection)
  const rename = useStore((s) => s.renameGroup)
  if (!selection.length) return null
  const chosen = design.layers.filter((l) => selection.includes(l.id))
  const g = chosen[0]?.group
  const wholeGroup =
    !!g &&
    chosen.every((l) => l.group === g) &&
    design.layers.filter((l) => l.group === g).length === chosen.length

  return (
    <section className="selection-panel">
      <h3>
        {selection.length > 1
          ? t('design.selected', { count: selection.length })
          : t('design.arrange')}
      </h3>
      {wholeGroup && (
        <label className="field">
          <span>{t('design.groupTitle')}</span>
          <input
            value={design.groups?.[g]?.name ?? ''}
            onChange={(e) => rename(g, e.target.value)}
          />
        </label>
      )}
      {selection.length > 1 && (
        <div className="row gap wrap" role="group" aria-label={t('design.align')}>
          {ALIGN.map(({ mode, icon }) => (
            <button
              key={mode}
              className="btn small icon"
              title={t(`design.aligns.${mode}`)}
              aria-label={t(`design.aligns.${mode}`)}
              onClick={() => align(mode)}
            >
              {icon}
            </button>
          ))}
        </div>
      )}
      <div className="row gap wrap">
        <button
          className="btn small"
          onClick={() => center('width')}
          title={t('design.centerWidthHint')}
        >
          {t('design.centerWidth')}
        </button>
        <button className="btn small" onClick={() => center('length')}>
          {t('design.centerLength')}
        </button>
      </div>
    </section>
  )
}

function LayerProperties() {
  const { t } = useTranslation()
  const layer = useStore((s) => s.draft.design.layers.find((l) => l.id === s.selectedLayer))
  const updateLayer = useStore((s) => s.updateLayer)
  const updatePlacement = useStore((s) => s.updatePlacement)
  const bindLayer = useStore((s) => s.bindLayer)
  const [keepAspect, setKeepAspect] = useState(true)
  const offPaint = useStore((s) => s.selectedOffPaint)
  if (!layer) return null
  const p = layer.placement
  const disabled = layer.locked
  const signedRotation = p.rotation > 180 ? p.rotation - 360 : p.rotation

  const setSize = (key: 'width' | 'height', value: number) => {
    const ratio = p.width / p.height
    if (!keepAspect) updatePlacement(layer.id, { [key]: value })
    else if (key === 'width') updatePlacement(layer.id, { width: value, height: value / ratio })
    else updatePlacement(layer.id, { height: value, width: value * ratio })
  }

  return (
    <section className="properties">
      <h3>{t('design.properties')}</h3>
      {offPaint && <p className="notice warn">{t('design.offPaint')}</p>}
      <label className="field">
        <span>{t('design.name')}</span>
        <input
          value={layer.name}
          onChange={(e) => void updateLayer(layer.id, { name: e.target.value })}
        />
      </label>

      {layer.kind === 'shape' && (
        <>
          <div className="add-grid">
            {SHAPES.map((shape) => (
              <button
                key={shape}
                className={`tool ${layer.shape === shape ? 'active' : ''}`}
                title={t(`design.shapes.${shape}`)}
                disabled={disabled}
                onClick={() => void updateLayer(layer.id, { shape })}
              >
                <ShapeIcon shape={shape} />
              </button>
            ))}
          </div>
          <BoundColor
            value={layer.color}
            onChange={(color) => void updateLayer(layer.id, { color })}
            label={t('design.color')}
            binding={layer.bindings?.color}
            onBind={(p) => bindLayer(layer.id, 'color', p)}
            disabled={disabled}
          />
        </>
      )}

      {layer.kind === 'text' && <TextProperties layer={layer} disabled={disabled} />}
      {layer.kind === 'image' && (
        <BindSelect
          kind="image"
          value={layer.bindings?.asset}
          onChange={(p) => bindLayer(layer.id, 'asset', p)}
          disabled={disabled}
        />
      )}

      <label className="field">
        <span>{t('design.finish')}</span>
        <select
          value={layer.finish ?? 'base'}
          disabled={disabled}
          onChange={(e) => void updateLayer(layer.id, { finish: e.target.value as LayerFinish })}
        >
          {(['base', ...FINISHES] as const).map((f) => (
            <option key={f} value={f}>
              {t(`design.finishes.${f}`)}
            </option>
          ))}
        </select>
      </label>

      <Slider
        label={t('design.width')}
        value={p.width}
        min={0.01}
        max={1.2}
        step={0.005}
        format={(v) => `${Math.round(v * 100)}%`}
        disabled={disabled}
        onChange={(v) => setSize('width', v)}
      />
      <Slider
        label={t('design.height')}
        value={p.height}
        min={0.005}
        max={0.6}
        step={0.005}
        format={(v) => `${Math.round(v * 100)}%`}
        disabled={disabled}
        onChange={(v) => setSize('height', v)}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={keepAspect}
          onChange={(e) => setKeepAspect(e.target.checked)}
        />
        {t('design.keepAspect')}
      </label>
      <Slider
        label={t('design.rotation')}
        value={signedRotation}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        disabled={disabled}
        onChange={(v) => updatePlacement(layer.id, { rotation: (v + 360) % 360 })}
      />
      <Slider
        label={t('design.opacity')}
        value={layer.opacity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        disabled={disabled}
        onChange={(v) => void updateLayer(layer.id, { opacity: v })}
      />
      <Slider
        label={t('design.depth')}
        value={p.depth}
        min={0.05}
        max={2}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        disabled={disabled}
        onChange={(v) => updatePlacement(layer.id, { depth: v })}
      />
      <label className="field">
        <span>{t('design.mirror')}</span>
        <select
          value={p.mirror}
          disabled={disabled}
          onChange={(e) => updatePlacement(layer.id, { mirror: e.target.value as MirrorMode })}
        >
          <option value="none">{t('design.mirrorNone')}</option>
          <option value="readable">{t('design.mirrorReadable')}</option>
          <option value="flipped">{t('design.mirrorFlipped')}</option>
        </select>
      </label>
    </section>
  )
}

function TextProperties({ layer, disabled }: { layer: TextLayer; disabled: boolean }) {
  const { t } = useTranslation()
  const updateLayer = useStore((s) => s.updateLayer)
  const importFont = useStore((s) => s.importFont)
  const assets = useStore((s) => s.draft.design.assets)
  const fontInput = useRef<HTMLInputElement>(null)
  const imported = Object.entries(assets).filter(([, a]) =>
    /font|ttf|otf|woff/i.test(a.mime + a.name),
  )
  const set = (patch: Partial<TextLayer>) => void updateLayer(layer.id, patch as Partial<Layer>)
  const currentImported = fontAssetId(layer.font)
  const bindLayer = useStore((s) => s.bindLayer)
  const textParams = useParams('text')

  return (
    <>
      <label className="field">
        <span>{t('design.text')}</span>
        <input
          value={layer.text}
          disabled={disabled}
          onChange={(e) => set({ text: e.target.value })}
        />
      </label>
      {textParams.length > 0 && (
        <div className="row gap wrap placeholders" aria-label={t('params.insert')}>
          {textParams.map((p) => (
            <button
              key={p.id}
              className="chip"
              disabled={disabled}
              title={p.label}
              onClick={() => set({ text: `${layer.text}{${p.id}}` })}
            >
              {`{${p.id}}`}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span>{t('design.font')}</span>
        <select
          value={layer.font}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value === '__import') fontInput.current?.click()
            else set({ font: e.target.value })
          }}
        >
          {SYSTEM_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          {imported.map(([id, a]) => (
            <option key={id} value={`asset:${id}`}>
              {a.name}
            </option>
          ))}
          {currentImported && !assets[currentImported] && (
            <option value={layer.font}>{t('design.missingFont')}</option>
          )}
          <option value="__import">{t('design.importFont')}</option>
        </select>
        <input
          ref={fontInput}
          type="file"
          accept={FONT_TYPES}
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            const font = await importFont(file)
            if (font) set({ font })
          }}
        />
      </label>
      <div className="row gap">
        <label className="check">
          <input
            type="checkbox"
            checked={layer.bold}
            disabled={disabled}
            onChange={(e) => set({ bold: e.target.checked })}
          />
          {t('design.bold')}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={layer.italic}
            disabled={disabled}
            onChange={(e) => set({ italic: e.target.checked })}
          />
          {t('design.italic')}
        </label>
      </div>
      <BoundColor
        value={layer.color}
        onChange={(color) => set({ color })}
        label={t('design.color')}
        binding={layer.bindings?.color}
        onBind={(p) => bindLayer(layer.id, 'color', p)}
        disabled={disabled}
      />
      <Slider
        label={t('design.outline')}
        value={layer.outline}
        min={0}
        max={0.15}
        step={0.005}
        format={(v) => `${Math.round(v * 100)}`}
        disabled={disabled}
        onChange={(v) => set({ outline: v })}
      />
      {layer.outline > 0 && (
        <BoundColor
          value={layer.outlineColor}
          onChange={(outlineColor) => set({ outlineColor })}
          label={t('design.outlineColor')}
          binding={layer.bindings?.outlineColor}
          onBind={(p) => bindLayer(layer.id, 'outlineColor', p)}
          disabled={disabled}
        />
      )}
    </>
  )
}

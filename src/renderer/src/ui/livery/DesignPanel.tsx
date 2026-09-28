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
import { useStore } from '../../state/store'
import { ColorField } from './ColorField'
import { ShapeIcon } from './ShapeIcon'

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
  const imageInput = useRef<HTMLInputElement>(null)
  const baseFinish = draft.baseFinish ?? 'stock'

  return (
    <>
      <section>
        <h3>{t('livery.base')}</h3>
        <ColorField
          value={draft.baseColor}
          onChange={(baseColor) => update({ baseColor })}
          label={t('livery.base')}
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
        {error && <p className="notice error">{error}</p>}
        <p className="hint">{t('design.mouseHint')}</p>
      </section>

      <LayerList />
      <LayerProperties />
    </>
  )
}

function LayerList() {
  const { t } = useTranslation()
  const layers = useStore((s) => s.draft.design.layers)
  const selected = useStore((s) => s.selectedLayer)
  const select = useStore((s) => s.selectLayer)
  const updateLayer = useStore((s) => s.updateLayer)
  const move = useStore((s) => s.moveLayer)
  const duplicate = useStore((s) => s.duplicateLayer)
  const remove = useStore((s) => s.removeLayer)
  const clear = useStore((s) => s.clearDesign)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const top = [...layers].reverse()

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
          aria-label={t('design.layers', { count: layers.length })}
        >
          {top.map((layer) => (
            <li
              key={layer.id}
              role="option"
              aria-selected={layer.id === selected}
              className={`layer-row ${layer.id === selected ? 'selected' : ''} ${layer.visible ? '' : 'hidden'}`}
              onClick={() => select(layer.id)}
            >
              <button
                className="icon-btn"
                title={t(layer.visible ? 'design.hide' : 'design.show')}
                onClick={(e) => {
                  e.stopPropagation()
                  void updateLayer(layer.id, { visible: !layer.visible })
                }}
              >
                {layer.visible ? '◉' : '○'}
              </button>
              <span className="layer-kind" aria-hidden>
                {layer.kind === 'shape' ? (
                  <ShapeIcon shape={layer.shape} />
                ) : layer.kind === 'text' ? (
                  'T'
                ) : (
                  '▣'
                )}
              </span>
              <span className="layer-name">{layer.name}</span>
              <button
                className={`icon-btn ${layer.locked ? 'on' : ''}`}
                title={t(layer.locked ? 'design.unlock' : 'design.lock')}
                onClick={(e) => {
                  e.stopPropagation()
                  void updateLayer(layer.id, { locked: !layer.locked })
                }}
              >
                {layer.locked ? '🔒' : '🔓'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="row gap wrap">
          <button className="btn small" onClick={() => move(selected, 1)} title={t('design.up')}>
            ↑
          </button>
          <button className="btn small" onClick={() => move(selected, -1)} title={t('design.down')}>
            ↓
          </button>
          <button className="btn small" onClick={() => duplicate(selected)}>
            {t('design.duplicate')}
          </button>
          <button className="btn small" onClick={() => remove(selected)}>
            {t('design.delete')}
          </button>
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

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <label className="field">
      <span>
        {props.label} <span className="mono muted">{props.format(props.value)}</span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

function LayerProperties() {
  const { t } = useTranslation()
  const layer = useStore((s) => s.draft.design.layers.find((l) => l.id === s.selectedLayer))
  const updateLayer = useStore((s) => s.updateLayer)
  const updatePlacement = useStore((s) => s.updatePlacement)
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
          <ColorField
            value={layer.color}
            onChange={(color) => void updateLayer(layer.id, { color })}
            label={t('design.color')}
          />
        </>
      )}

      {layer.kind === 'text' && <TextProperties layer={layer} disabled={disabled} />}

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
      <ColorField
        value={layer.color}
        onChange={(color) => set({ color })}
        label={t('design.color')}
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
        <ColorField
          value={layer.outlineColor}
          onChange={(outlineColor) => set({ outlineColor })}
          label={t('design.outlineColor')}
        />
      )}
    </>
  )
}

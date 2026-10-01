import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PATTERNS,
  PATTERN_INFO,
  PATTERN_PRESETS,
  newFill,
  type PatternFill,
  type PatternKind,
  type PatternPreset,
} from '@shared/design/patterns'
import type { ShapeLayer } from '@shared/design/types'
import { drawPattern } from '../../engine/patterns'
import { useStore } from '../../state/store'
import { BoundColor } from './Binding'
import { Slider } from './Slider'

const THUMB_W = 192
const THUMB_H = 88
/** Stands for the car paint behind a transparent pattern. */
const THUMB_PAINT = '#59606a'

function PatternThumb({ fill, color }: { fill: PatternFill; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, THUMB_W, THUMB_H)
    ctx.fillStyle = fill.transparent ? THUMB_PAINT : fill.background
    ctx.fillRect(0, 0, THUMB_W, THUMB_H)
    drawPattern(ctx, THUMB_W, THUMB_H, fill, color)
  }, [fill, color])
  return <canvas ref={canvas} width={THUMB_W} height={THUMB_H} aria-hidden />
}

/** Ready-made pattern vinyls. */
export function PatternPicker({ onPick }: { onPick(preset: PatternPreset): void }) {
  const { t } = useTranslation()
  return (
    <div className="sticker-picker">
      <div className="pattern-grid" role="listbox" aria-label={t('patterns.title')}>
        {PATTERN_PRESETS.map((p) => (
          <button
            key={p.id}
            className="pattern-thumb"
            role="option"
            aria-selected={false}
            title={t(`patterns.presets.${p.id}`)}
            onClick={() => onPick(p)}
          >
            <PatternThumb fill={p.fill} color={p.color ?? '#ffffff'} />
            <span>{t(`patterns.presets.${p.id}`)}</span>
          </button>
        ))}
      </div>
      <p className="hint">{t('patterns.hint')}</p>
    </div>
  )
}

/** Fill of a shape layer: flat colour or a pattern with its settings. */
export function FillProperties({ layer, disabled }: { layer: ShapeLayer; disabled: boolean }) {
  const { t } = useTranslation()
  const updateLayer = useStore((s) => s.updateLayer)
  const bindLayer = useStore((s) => s.bindLayer)
  const fill = layer.fill
  const set = (patch: Partial<PatternFill>) =>
    fill && void updateLayer(layer.id, { fill: { ...fill, ...patch } })

  const choose = (value: string) => {
    if (!value) return void updateLayer(layer.id, { fill: undefined })
    const next = newFill(value as PatternKind)
    // a change of pattern keeps the layout, and a background colour chosen for it
    void updateLayer(layer.id, {
      fill: fill
        ? {
            ...next,
            angle: fill.angle,
            fade: PATTERN_INFO[next.pattern].fades ? fill.fade : 0,
            seed: fill.seed,
            ...(fill.transparent ? {} : { transparent: false, background: fill.background }),
          }
        : next,
    })
  }

  const info = fill ? PATTERN_INFO[fill.pattern] : null
  return (
    <>
      <label className="field">
        <span>{t('patterns.fill')}</span>
        <select
          value={fill?.pattern ?? ''}
          disabled={disabled}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">{t('patterns.solid')}</option>
          {PATTERNS.map((p) => (
            <option key={p} value={p}>
              {t(`patterns.kinds.${p}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        {fill && <span>{t('patterns.color')}</span>}
        <BoundColor
          value={layer.color}
          onChange={(color) => void updateLayer(layer.id, { color })}
          label={fill ? t('patterns.color') : t('design.color')}
          binding={layer.bindings?.color}
          onBind={(p) => bindLayer(layer.id, 'color', p)}
          disabled={disabled}
        />
      </div>
      {fill && info && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={fill.transparent}
              disabled={disabled}
              onChange={(e) => set({ transparent: e.target.checked })}
            />
            {t('patterns.transparent')}
          </label>
          {!fill.transparent && (
            <div className="field">
              <span>{t('patterns.background')}</span>
              <BoundColor
                value={fill.background}
                onChange={(background) => set({ background })}
                label={t('patterns.background')}
                binding={layer.bindings?.background}
                onBind={(p) => bindLayer(layer.id, 'background', p)}
                disabled={disabled}
              />
            </div>
          )}
          {info.sized && (
            <Slider
              label={t('patterns.size')}
              value={fill.size}
              min={0.02}
              max={1}
              step={0.005}
              format={(v) => `${Math.round(v * 100)}%`}
              disabled={disabled}
              onChange={(size) => set({ size })}
            />
          )}
          {info.weight && (
            <Slider
              label={t(`patterns.weight.${info.weight}`)}
              value={fill.weight}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              disabled={disabled}
              onChange={(weight) => set({ weight })}
            />
          )}
          <Slider
            label={t('patterns.angle')}
            value={fill.angle}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            disabled={disabled}
            onChange={(angle) => set({ angle })}
          />
          {info.fades && (
            <>
              <Slider
                label={t('patterns.fade')}
                value={fill.fade}
                min={-1}
                max={1}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                disabled={disabled}
                onChange={(fade) => set({ fade })}
              />
              <p className="hint">{t('patterns.fadeHint')}</p>
            </>
          )}
          {info.random && (
            <button
              className="btn small"
              disabled={disabled}
              onClick={() => set({ seed: 1 + Math.floor(Math.random() * 999_999) })}
            >
              🎲 {t('patterns.reroll')}
            </button>
          )}
        </>
      )}
    </>
  )
}

import { useTranslation } from 'react-i18next'
import {
  CSP_EFFECTS,
  DEFAULT_CSP,
  DEFAULT_PARTS,
  FINISHES,
  type BaseFinish,
  type CspEffect,
} from '@shared/design/types'
import { useStore } from '../../state/store'
import { BoundColor } from './Binding'
import { Slider } from './Slider'

const percent = (v: number) => `${Math.round(v * 100)}%`

/** Rims, calipers, glass and the CSP car paint. */
export function PartsPanel() {
  const { t } = useTranslation()
  const parts = useStore((s) => s.draft.parts ?? DEFAULT_PARTS)
  const csp = useStore((s) => s.draft.csp ?? DEFAULT_CSP)
  const found = useStore((s) => s.carParts)
  const cspMaterials = useStore((s) => s.cspMaterials)
  const updatePart = useStore((s) => s.updatePart)
  const updateCsp = useStore((s) => s.updateCsp)
  const bindings = useStore((s) => s.draft.bindings)
  const bindDraft = useStore((s) => s.bindDraft)
  const { rims, calipers, glass } = parts
  const interiorGlass = found?.glass.some((g) => !g.exterior) ?? false

  const textures = (names: string[] | undefined) =>
    names?.length ? (
      <p className="hint mono">{names.join(', ')}</p>
    ) : (
      <p className="hint">{t('parts.notFound')}</p>
    )

  return (
    <>
      <section>
        <h3>{t('parts.csp')}</h3>
        <label className="field">
          <span>{t('parts.cspEffect')}</span>
          <select
            value={csp.effect}
            disabled={!cspMaterials.length}
            onChange={(e) => updateCsp({ effect: e.target.value as CspEffect })}
          >
            {CSP_EFFECTS.map((effect) => (
              <option key={effect} value={effect}>
                {t(`parts.effects.${effect}`)}
              </option>
            ))}
          </select>
        </label>
        {csp.effect === 'metallic' && (
          <Slider
            label={t('parts.flakes')}
            value={csp.flakes}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            onChange={(flakes) => updateCsp({ flakes })}
          />
        )}
        {csp.effect === 'pearl' && (
          <Slider
            label={t('parts.pearl')}
            value={csp.pearl}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            onChange={(pearl) => updateCsp({ pearl })}
          />
        )}
        {csp.effect === 'chameleon' && (
          <>
            <BoundColor
              value={csp.colorA}
              onChange={(colorA) => updateCsp({ colorA })}
              label={t('parts.colorA')}
              binding={bindings?.cspColorA}
              onBind={(p) => bindDraft('cspColorA', p)}
            />
            <BoundColor
              value={csp.colorB}
              onChange={(colorB) => updateCsp({ colorB })}
              label={t('parts.colorB')}
              binding={bindings?.cspColorB}
              onBind={(p) => bindDraft('cspColorB', p)}
            />
          </>
        )}
        <p className="hint">
          {cspMaterials.length
            ? t('parts.cspHint', { materials: cspMaterials.join(', ') })
            : t('parts.cspUnavailable')}
        </p>
      </section>

      <section>
        <h3>{t('parts.rims')}</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={rims.enabled}
            disabled={!found?.rims.length}
            onChange={(e) => updatePart('rims', { enabled: e.target.checked })}
          />
          {t('parts.recolor')}
        </label>
        {rims.enabled && (
          <>
            <BoundColor
              value={rims.color}
              onChange={(color) => updatePart('rims', { color })}
              label={t('parts.rims')}
              binding={bindings?.rims}
              onBind={(p) => bindDraft('rims', p)}
              swatches
            />
            <label className="check">
              <input
                type="checkbox"
                checked={rims.keepLogos}
                onChange={(e) => updatePart('rims', { keepLogos: e.target.checked })}
              />
              {t('parts.keepLogos')}
            </label>
            {!!found?.rimMaps.length && (
              <label className="field">
                <span>{t('design.finish')}</span>
                <select
                  value={rims.finish}
                  onChange={(e) => updatePart('rims', { finish: e.target.value as BaseFinish })}
                >
                  {(['stock', ...FINISHES] as const).map((f) => (
                    <option key={f} value={f}>
                      {t(`design.finishes.${f}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {textures(found?.rims)}
      </section>

      <section>
        <h3>{t('parts.calipers')}</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={calipers.enabled}
            disabled={!found?.calipers.length}
            onChange={(e) => updatePart('calipers', { enabled: e.target.checked })}
          />
          {t('parts.recolor')}
        </label>
        {calipers.enabled && (
          <>
            <BoundColor
              value={calipers.color}
              onChange={(color) => updatePart('calipers', { color })}
              label={t('parts.calipers')}
              binding={bindings?.calipers}
              onBind={(p) => bindDraft('calipers', p)}
              swatches
            />
            <label className="check">
              <input
                type="checkbox"
                checked={calipers.keepLogos}
                onChange={(e) => updatePart('calipers', { keepLogos: e.target.checked })}
              />
              {t('parts.keepLogos')}
            </label>
          </>
        )}
        {textures(found?.calipers)}
      </section>

      <section>
        <h3>{t('parts.glass')}</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={glass.enabled}
            disabled={!found?.glass.length}
            onChange={(e) => updatePart('glass', { enabled: e.target.checked })}
          />
          {t('parts.tint')}
        </label>
        {glass.enabled && (
          <>
            <BoundColor
              value={glass.color}
              onChange={(color) => updatePart('glass', { color })}
              label={t('parts.glass')}
              binding={bindings?.glass}
              onBind={(p) => bindDraft('glass', p)}
            />
            <Slider
              label={t('parts.darkness')}
              value={glass.darkness}
              min={0}
              max={1}
              step={0.01}
              format={percent}
              onChange={(darkness) => updatePart('glass', { darkness })}
            />
            {interiorGlass && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={glass.interior}
                  onChange={(e) => updatePart('glass', { interior: e.target.checked })}
                />
                {t('parts.interiorGlass')}
              </label>
            )}
          </>
        )}
        {textures(found?.glass.map((g) => g.name))}
      </section>
    </>
  )
}

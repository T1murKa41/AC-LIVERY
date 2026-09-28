import { useTranslation } from 'react-i18next'
import { resolvePaintedTextures, useStore, type LiveryMeta } from '../state/store'

const SWATCHES = [
  '#d7261e',
  '#f25c05',
  '#f2b705',
  '#2e9e44',
  '#0b6e4f',
  '#1c5fd4',
  '#0a2463',
  '#6a2c91',
  '#e84393',
  '#f4f4f2',
  '#9aa0a6',
  '#16181b',
]

const META_FIELDS: (keyof LiveryMeta)[] = ['skinname', 'drivername', 'team', 'number', 'country']

export function LiveryTab() {
  const { t } = useTranslation()
  const draft = useStore((s) => s.draft)
  const update = useStore((s) => s.updateDraft)
  const car = useStore((s) => s.car)
  const analysis = useStore((s) => s.analysis)
  const aoUsed = useStore((s) => s.aoUsed)
  const exportState = useStore((s) => s.exportState)
  const exportLivery = useStore((s) => s.exportLivery)
  const dismiss = useStore((s) => s.dismissExport)
  const reveal = useStore((s) => s.backend.revealPath)
  const candidates = useStore((s) => s.liveryCandidates)
  const autoLivery = useStore((s) => s.autoLivery)
  const shownSkin = useStore((s) => s.shownSkin)
  const highlight = useStore((s) => s.highlight)
  const setHighlight = useStore((s) => s.setHighlight)

  if (!analysis || candidates.length === 0) {
    return <p className="notice warn">{t('livery.noTexture')}</p>
  }

  const painted = resolvePaintedTextures(draft, candidates, autoLivery)
  const paintedKeys = new Set(painted.map((n) => n.toLowerCase()))
  const autoKeys = new Set(autoLivery.map((n) => n.toLowerCase()))
  const toggleTexture = (name: string, on: boolean) => {
    const next = candidates
      .map((c) => c.name)
      .filter((n) => (n === name ? on : paintedKeys.has(n.toLowerCase())))
    update({ liveryTextures: next.length ? next : 'auto' })
  }
  const stockSkins = (car?.skins ?? []).filter((s) => !s.ours)
  const skinLabel = (id: string) => car?.skins.find((s) => s.id === id)?.ui?.skinname || id
  const aoSkins = stockSkins.filter((s) => s.files.some((f) => paintedKeys.has(f.toLowerCase())))
  const sourceLabel = (source: string) =>
    source === 'model'
      ? t('livery.aoModel')
      : source.startsWith('skin:')
        ? skinLabel(source.slice(5))
        : t('livery.aoNone')
  const visibleMax = Math.max(...candidates.map((c) => c.visible), 0.0001)

  return (
    <div className="form">
      <section>
        <h3>{t('livery.target')}</h3>
        <p className="hint">{t('livery.targetHint')}</p>
        <ul className="texture-list">
          {candidates.map((c) => (
            <li key={c.name}>
              <label className="check texture-row">
                <input
                  type="checkbox"
                  checked={paintedKeys.has(c.name.toLowerCase())}
                  onChange={(e) => toggleTexture(c.name, e.target.checked)}
                />
                <span className="mono texture-name" title={c.name}>
                  {c.name}
                </span>
                {autoKeys.has(c.name.toLowerCase()) && (
                  <span className="tag accent">{t('livery.auto')}</span>
                )}
                <span className="texture-share mono">{Math.round(c.visible * 100)}%</span>
              </label>
              <span className="share-bar" aria-hidden>
                <span style={{ width: `${(c.visible / visibleMax) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
        {draft.liveryTextures !== 'auto' && (
          <button className="btn ghost small" onClick={() => update({ liveryTextures: 'auto' })}>
            {t('livery.resetAuto')}
          </button>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={highlight}
            onChange={(e) => setHighlight(e.target.checked)}
          />
          {t('livery.showOnCar')}
        </label>
        <label className="field">
          <span>{t('livery.baseSkin')}</span>
          <select value={draft.baseSkin} onChange={(e) => update({ baseSkin: e.target.value })}>
            <option value="auto">
              {t('livery.baseSkinAuto', {
                skin: shownSkin ? skinLabel(shownSkin) : t('livery.aoModel'),
              })}
            </option>
            {stockSkins.map((s) => (
              <option key={s.id} value={s.id}>
                {skinLabel(s.id)}
              </option>
            ))}
            <option value="model">{t('livery.aoModel')}</option>
          </select>
          <small className="hint">{t('livery.baseSkinHint')}</small>
        </label>
      </section>

      <section>
        <h3>{t('livery.base')}</h3>
        <div className="color-row">
          <input
            type="color"
            value={draft.baseColor}
            onChange={(e) => update({ baseColor: e.target.value })}
            aria-label={t('livery.base')}
          />
          <input
            className="mono"
            value={draft.baseColor}
            maxLength={7}
            onChange={(e) => {
              const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
              if (/^#[0-9a-fA-F]{6}$/.test(v)) update({ baseColor: v.toLowerCase() })
            }}
            aria-label="HEX"
          />
        </div>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button
              key={c}
              className={`swatch ${draft.baseColor === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => update({ baseColor: c })}
              aria-label={c}
            />
          ))}
        </div>
      </section>

      <section>
        <h3>{t('livery.ao')}</h3>
        <label className="field">
          <span>{t('livery.aoSource')}</span>
          <select value={draft.aoSource} onChange={(e) => update({ aoSource: e.target.value })}>
            <option value="auto">{t('livery.aoAuto')}</option>
            <option value="model">{t('livery.aoModel')}</option>
            {aoSkins.map((s) => (
              <option key={s.id} value={`skin:${s.id}`}>
                {s.ui?.skinname || s.id}
              </option>
            ))}
            <option value="none">{t('livery.aoNone')}</option>
          </select>
        </label>
        {draft.aoSource === 'auto' && aoUsed && aoUsed !== 'none' && (
          <p className="hint">{t('livery.aoUsed', { source: sourceLabel(aoUsed) })}</p>
        )}
        <label className="field">
          <span>
            {t('livery.aoStrength')}{' '}
            <span className="mono muted">{Math.round(draft.aoStrength * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.aoStrength}
            disabled={draft.aoSource === 'none'}
            onChange={(e) => update({ aoStrength: Number(e.target.value) })}
          />
        </label>
      </section>

      <section>
        <h3>{t('livery.meta')}</h3>
        {META_FIELDS.map((key) => (
          <label className="field" key={key}>
            <span>{t(`livery.${key}`)}</span>
            <input
              value={draft.meta[key]}
              onChange={(e) => update({ meta: { [key]: e.target.value } })}
            />
          </label>
        ))}
        <div className="field">
          <label htmlFor="skin-id">{t('livery.skinId')}</label>
          <input
            id="skin-id"
            className="mono"
            value={draft.skinId}
            onChange={(e) => update({ skinId: e.target.value })}
            aria-describedby="skin-id-hint"
          />
          <small id="skin-id-hint" className="hint">
            {t('livery.skinIdHint')}
          </small>
        </div>
      </section>

      <div className="export">
        <button
          className="btn primary wide"
          disabled={exportState.status === 'working'}
          onClick={() => void exportLivery()}
        >
          {exportState.status === 'working' ? t('livery.exporting') : t('livery.export')}
        </button>
        {exportState.status === 'confirm' && (
          <div className="notice warn">
            <p>
              {exportState.foreign
                ? t('livery.overwriteForeign', { id: draft.skinId })
                : t('livery.overwriteOurs', { id: draft.skinId })}
            </p>
            <div className="row gap">
              <button
                className="btn danger small"
                onClick={() => void exportLivery(exportState.mode)}
              >
                {t('livery.overwrite')}
              </button>
              <button className="btn small" onClick={dismiss}>
                {t('livery.cancel')}
              </button>
            </div>
          </div>
        )}
        {exportState.status === 'done' && (
          <div className="notice ok">
            <p>{t('livery.exported', { path: exportState.path })}</p>
            {exportState.builtinEncoder && <p className="hint">{t('livery.builtinEncoder')}</p>}
            <button className="btn small" onClick={() => void reveal(exportState.path)}>
              {t('livery.reveal')}
            </button>
          </div>
        )}
        {exportState.status === 'error' && <p className="notice error">{exportState.message}</p>}
      </div>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { resolvePaintedTextures, useStore } from '../../state/store'

/** Which textures are repainted, where the rest comes from, and baked shading. */
export function BasePanel() {
  const { t } = useTranslation()
  const draft = useStore((s) => s.draft)
  const update = useStore((s) => s.updateDraft)
  const car = useStore((s) => s.car)
  const aoUsed = useStore((s) => s.aoUsed)
  const candidates = useStore((s) => s.liveryCandidates)
  const autoLivery = useStore((s) => s.autoLivery)
  const shownSkin = useStore((s) => s.shownSkin)
  const highlight = useStore((s) => s.highlight)
  const setHighlight = useStore((s) => s.setHighlight)

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
  const clearedKeys = new Set((draft.clearedTextures ?? []).map((n) => n.toLowerCase()))
  const others = candidates.filter((c) => !paintedKeys.has(c.name.toLowerCase()))
  const toggleCleared = (name: string, on: boolean) => {
    const rest = (draft.clearedTextures ?? []).filter((n) => n.toLowerCase() !== name.toLowerCase())
    update({ clearedTextures: on ? [...rest, name] : rest })
  }

  return (
    <>
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
        {others.length > 0 && (
          <div className="field">
            <span>{t('livery.clearTitle')}</span>
            <ul className="texture-list compact">
              {others.map((c) => (
                <li key={c.name}>
                  <label className="check texture-row">
                    <input
                      type="checkbox"
                      checked={clearedKeys.has(c.name.toLowerCase())}
                      onChange={(e) => toggleCleared(c.name, e.target.checked)}
                    />
                    <span className="mono texture-name" title={c.name}>
                      {c.name}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <small className="hint">{t('livery.clearHint')}</small>
          </div>
        )}
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
    </>
  )
}

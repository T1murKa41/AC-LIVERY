import { useTranslation } from 'react-i18next'
import { useStore } from '../state/store'

export function SkinsTab() {
  const { t } = useTranslation()
  const car = useStore((s) => s.car)
  const shown = useStore((s) => s.shownSkin)
  const showSkin = useStore((s) => s.showSkin)
  const editSkin = useStore((s) => s.editSkin)
  if (!car) return null
  return (
    <div className="skin-list">
      <button
        className={`skin-item ${shown === null ? 'selected' : ''}`}
        onClick={() => void showSkin(null)}
      >
        <span className="skin-name">{t('skins.model')}</span>
      </button>
      {car.skins.length === 0 && <p className="muted pad">{t('skins.none')}</p>}
      {car.skins.map((skin) => (
        <div key={skin.id} className={`skin-item ${shown === skin.id ? 'selected' : ''}`}>
          <button className="skin-main" onClick={() => void showSkin(skin.id)}>
            <span className="skin-name">{skin.ui?.skinname || skin.id}</span>
            <span className="skin-meta">
              {skin.ui?.number && <span className="tag">#{skin.ui.number}</span>}
              {skin.ui?.drivername && <span>{skin.ui.drivername}</span>}
              {skin.ours && <span className="tag accent">{t('skins.ours')}</span>}
            </span>
          </button>
          {skin.ours && (
            <button className="btn ghost small" onClick={() => void editSkin(skin.id)}>
              {t('skins.edit')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

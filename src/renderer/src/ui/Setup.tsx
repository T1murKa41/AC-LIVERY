import { useTranslation } from 'react-i18next'
import { useStore } from '../state/store'

export function Setup() {
  const { t } = useTranslation()
  const detectRoot = useStore((s) => s.detectRoot)
  const pickRoot = useStore((s) => s.pickRoot)
  const message = useStore((s) => s.setupMessage)
  return (
    <div className="setup">
      <div className="setup-card">
        <div className="brand-mark" aria-hidden />
        <h1>{t('setup.title')}</h1>
        <p className="muted">{t('setup.text')}</p>
        {message && <p className="notice warn">{t(message)}</p>}
        <div className="row gap">
          <button className="btn primary" onClick={() => void detectRoot()}>
            {t('setup.detect')}
          </button>
          <button className="btn" onClick={() => void pickRoot()}>
            {t('setup.pick')}
          </button>
        </div>
      </div>
    </div>
  )
}

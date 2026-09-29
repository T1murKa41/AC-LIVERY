import { useTranslation } from 'react-i18next'
import type { Language } from '@shared/api'
import { useStore } from '../state/store'

export function Header() {
  const { t } = useTranslation()
  const settings = useStore((s) => s.settings)
  const setLanguage = useStore((s) => s.setLanguage)
  const resetRoot = useStore((s) => s.resetRoot)
  const car = useStore((s) => s.car)
  const projectPath = useStore((s) => s.projectPath)
  const dirty = useStore((s) => s.dirty)
  const saveProject = useStore((s) => s.saveProject)
  const openProject = useStore((s) => s.openProject)
  const projectName = projectPath?.split(/[\\/]/).pop()
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark small" aria-hidden />
        <span className="brand-name">{t('app.title')}</span>
      </div>
      <div className="header-car">
        {car ? `${car.brand ? `${car.brand} · ` : ''}${car.name}` : ''}
      </div>
      <div className="header-actions">
        {settings?.acRoot && (
          <>
            <span className="project-name" title={projectPath ?? undefined}>
              {projectName ?? t('project.untitled')}
              {dirty ? ` • ${t('project.unsaved')}` : ''}
            </span>
            <button
              className="btn ghost small"
              title={t('project.openHint')}
              onClick={() => void openProject()}
            >
              {t('project.open')}
            </button>
            <button
              className="btn ghost small"
              title={t('project.saveHint')}
              onClick={(e) => void saveProject(e.shiftKey)}
            >
              {t('project.save')}
            </button>
          </>
        )}
        {settings?.acRoot && (
          <button
            className="btn ghost small"
            title={settings.acRoot}
            onClick={() => void resetRoot()}
          >
            {t('setup.change')}
          </button>
        )}
        <div className="segmented" role="group" aria-label="Language">
          {(['ru', 'en'] as Language[]).map((lang) => (
            <button
              key={lang}
              className={settings?.language === lang ? 'active' : ''}
              onClick={() => void setLanguage(lang)}
            >
              {t(`lang.${lang}`)}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}

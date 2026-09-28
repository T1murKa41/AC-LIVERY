import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../state/store'

/** Ctrl+S (Shift: save as) and Ctrl+O work everywhere, even while typing. */
export function useProjectShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const st = useStore.getState()
      if (!st.settings?.acRoot) return
      const key = e.key.toLowerCase()
      if (key === 's') void st.saveProject(e.shiftKey)
      else if (key === 'o') void st.openProject()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Offer to restore unsaved work, and project errors. */
export function ProjectBars() {
  const { t, i18n } = useTranslation()
  const recovery = useStore((s) => s.recovery)
  const cars = useStore((s) => s.cars)
  const error = useStore((s) => s.projectError)
  const restore = useStore((s) => s.restoreRecovery)
  const discard = useStore((s) => s.discardRecovery)
  const dismissError = useStore((s) => s.dismissProjectError)
  const acRoot = useStore((s) => s.settings?.acRoot)

  return (
    <>
      {recovery && acRoot && (
        <div className="app-bar" role="status">
          <span className="grow">
            {t('project.recovery', {
              time: new Date(recovery.savedAt).toLocaleString(i18n.language),
              car: cars.find((c) => c.id === recovery.carId)?.name ?? recovery.carId ?? '—',
            })}
          </span>
          <button className="btn small primary" onClick={() => void restore()}>
            {t('project.restore')}
          </button>
          <button className="btn small ghost" onClick={discard}>
            {t('project.discard')}
          </button>
        </div>
      )}
      {error && (
        <div className="app-bar error" role="alert">
          <span className="grow">{t('project.error', { message: error })}</span>
          <button className="btn small ghost" onClick={dismissError}>
            {t('project.close')}
          </button>
        </div>
      )}
    </>
  )
}

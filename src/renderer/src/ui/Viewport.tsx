import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { EngineController } from '../engine/controller'
import type { ViewMode } from '../engine/viewer'
import { useStore } from '../state/store'
import { Gizmo } from './Gizmo'

const VIEWS: ViewMode[] = ['perspective', 'left', 'right', 'top', 'front', 'rear']

export function Viewport() {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backend = useStore((s) => s.backend)
  const attachEngine = useStore((s) => s.attachEngine)
  const load = useStore((s) => s.load)
  const car = useStore((s) => s.car)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const aoStatus = useStore((s) => s.aoStatus)
  const tab = useStore((s) => s.tab)

  useEffect(() => {
    const controller = new EngineController(canvasRef.current!, backend)
    attachEngine(controller)
    return () => {
      attachEngine(null)
      controller.dispose()
    }
  }, [backend, attachEngine])

  return (
    <section className="viewport">
      <canvas ref={canvasRef} className="viewport-canvas" />
      {load.status === 'ready' && <Gizmo />}
      {load.status === 'ready' && (
        <div className="view-toolbar" role="toolbar">
          {VIEWS.map((v) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
              {t(`views.${v}`)}
            </button>
          ))}
        </div>
      )}
      {!car && load.status === 'idle' && <div className="overlay muted">{t('cars.pick')}</div>}
      {load.status === 'loading' && (
        <div className="overlay">
          <div className="spinner" aria-hidden />
          <span>{t('load.files')}</span>
        </div>
      )}
      {load.status === 'error' && (
        <div className="overlay">
          <div className="error-card">
            <strong>{t('load.error')}</strong>
            <p>
              {load.kind === 'format'
                ? t('load.format')
                : load.kind === 'no-model'
                  ? t('load.noModel')
                  : load.message}
            </p>
          </div>
        </div>
      )}
      {tab === 'livery' && aoStatus === 'working' && (
        <div className="toast">
          <div className="spinner small" aria-hidden />
          {t('livery.working')}
        </div>
      )}
    </section>
  )
}

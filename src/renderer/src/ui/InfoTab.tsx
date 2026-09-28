import { useTranslation } from 'react-i18next'
import { useStore } from '../state/store'

export function InfoTab() {
  const { t } = useTranslation()
  const analysis = useStore((s) => s.analysis)
  const warnings = useStore((s) => s.loadWarnings)
  const highlight = useStore((s) => s.highlight)
  const setHighlight = useStore((s) => s.setHighlight)
  if (!analysis) return null
  const f = analysis.frame
  const fmt = (n: number) => n.toFixed(2)
  return (
    <div className="info">
      {analysis.warnings.map((w) => (
        <p key={w} className={`notice ${w === 'shared-side-uv' ? 'warn' : 'muted-notice'}`}>
          {t(`info.warnings.${w}`)}
        </p>
      ))}
      <dl>
        <dt>{t('info.bodyTexture')}</dt>
        <dd className="mono">{analysis.bodyTexture ?? t('info.none')}</dd>
        <dt>{t('info.mapsTexture')}</dt>
        <dd className="mono">{analysis.bodyMapsTexture ?? t('info.none')}</dd>
        <dt>{t('info.paintable')}</dt>
        <dd className="mono">
          {analysis.paintable.length ? analysis.paintable.join(', ') : t('info.none')}
        </dd>
        <dt>{t('info.frame')}</dt>
        <dd>
          {f.source === 'wheels' ? t('info.frameWheels') : t('info.frameBounds')}
          {f.mirrored && `, ${t('info.mirrored')}`}
        </dd>
        <dt>{t('info.size')}</dt>
        <dd className="mono">
          {fmt(f.length)} × {fmt(f.width)} × {fmt(f.height)} m
        </dd>
        <dt>{t('info.uvOverlap')}</dt>
        <dd className="mono">
          {analysis.sideUvOverlap === null ? '—' : `${Math.round(analysis.sideUvOverlap * 100)}%`}
        </dd>
        <dt>{t('info.meshes')}</dt>
        <dd className="mono">{analysis.meshes.length}</dd>
      </dl>
      <label className="check">
        <input
          type="checkbox"
          checked={highlight}
          onChange={(e) => setHighlight(e.target.checked)}
        />
        {t('info.highlight')}
      </label>
      {warnings.length > 0 && (
        <details className="load-warnings">
          <summary>{warnings.length} ⚠</summary>
          <ul>
            {warnings.map((w) => (
              <li key={w} className="mono">
                {w}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../state/store'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // clipboard API can be unavailable; fall back to a hidden textarea
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

export function InfoTab() {
  const { t } = useTranslation()
  const analysis = useStore((s) => s.analysis)
  const warnings = useStore((s) => s.loadWarnings)
  const highlight = useStore((s) => s.highlight)
  const setHighlight = useStore((s) => s.setHighlight)
  const picked = useStore((s) => s.pickedMesh)
  const clearPick = useStore((s) => s.clearPick)
  const showHidden = useStore((s) => s.showHidden)
  const setShowHidden = useStore((s) => s.setShowHidden)
  const diagnosticsReport = useStore((s) => s.diagnosticsReport)
  const [copied, setCopied] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const describePicked = useStore((s) => s.describePicked)
  const pickedLines = useMemo(
    () => (picked === null ? [] : describePicked()),
    [picked, describePicked],
  )
  if (!analysis) return null
  const f = analysis.frame
  const fmt = (n: number) => n.toFixed(2)

  const onCopy = async () => {
    const text = diagnosticsReport()
    setReport(text)
    setCopied(await copyText(text))
  }

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

      <section className="picked">
        <h3>{t('info.picked')}</h3>
        {picked === null ? (
          <p className="hint">{t('info.pickHint')}</p>
        ) : (
          <>
            <pre className="mono picked-lines">{pickedLines.join('\n')}</pre>
            <button className="btn small" onClick={clearPick}>
              {t('info.clearPick')}
            </button>
          </>
        )}
      </section>

      <label className="check">
        <input
          type="checkbox"
          checked={highlight}
          onChange={(e) => setHighlight(e.target.checked)}
        />
        {t('info.highlight')}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => setShowHidden(e.target.checked)}
        />
        {t('info.showHidden')}
      </label>

      <div className="report">
        <button className="btn small" onClick={() => void onCopy()}>
          {copied ? t('info.reportCopied') : t('info.report')}
        </button>
        <p className="hint">{t('info.reportHint')}</p>
        {report && <textarea className="mono report-text" readOnly value={report} rows={8} />}
      </div>

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

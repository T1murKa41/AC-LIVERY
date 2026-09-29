import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LEAGUE } from '@shared/league/table'
import { filteredCars, useStore } from '../state/store'

const TABLE_TYPES =
  '.csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** League: a table of drivers turned into skins with the current template. */
export function LeagueTab() {
  const { t } = useTranslation()
  const league = useStore((s) => s.draft.league ?? DEFAULT_LEAGUE)
  const params = useStore((s) => s.draft.params)
  const template = useStore((s) => s.draft.template)
  const tableOpen = useStore((s) => s.leagueTableOpen)
  const setTableOpen = useStore((s) => s.setLeagueTableOpen)
  const openFile = useStore((s) => s.openLeagueFile)
  const addRow = useStore((s) => s.addLeagueRow)
  const update = useStore((s) => s.updateLeague)
  const run = useStore((s) => s.leagueRun)
  const runLeague = useStore((s) => s.runLeague)
  const cancel = useStore((s) => s.cancelLeague)
  const dismiss = useStore((s) => s.dismissLeagueRun)
  const error = useStore((s) => s.designError)
  const setLiveryPanel = useStore((s) => s.setLiveryPanel)
  const setTab = useStore((s) => s.setTab)
  const file = useRef<HTMLInputElement>(null)
  const running = run.status === 'running'
  const carCount = Math.max(1, league.cars.length)
  const total = league.rows.length * carCount

  if (!params?.length) {
    return (
      <div className="form">
        <section>
          <h3>{t('league.title')}</h3>
          <p className="notice warn">{t('league.needTemplate')}</p>
          <button
            className="btn small"
            onClick={() => {
              setTab('livery')
              setLiveryPanel('template')
            }}
          >
            {t('league.toTemplates')}
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="form league">
      <section>
        <h3>{t('league.title')}</h3>
        <p className="hint">
          {t('league.template', { name: template ?? t('league.currentDesign') })}
        </p>
        <div className="row gap wrap">
          <button
            className={`btn small ${tableOpen ? 'active' : ''}`}
            onClick={() => setTableOpen(!tableOpen)}
            aria-expanded={tableOpen}
          >
            {tableOpen ? t('league.closeTable') : t('league.openTable')}
          </button>
          <button className="btn small" onClick={() => file.current?.click()} disabled={running}>
            {t('league.import')}
          </button>
          <button
            className="btn small"
            disabled={running}
            onClick={() => {
              addRow()
              setTableOpen(true)
            }}
          >
            {t('league.addRow')}
          </button>
          <input
            ref={file}
            type="file"
            accept={TABLE_TYPES}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void openFile(f)
            }}
          />
        </div>
        <p className="muted small">{t('league.rows', { count: league.rows.length })}</p>
        {error && <p className="notice error">{error}</p>}
        {run.problems.length > 0 && (
          <details className="load-warnings" open>
            <summary>{t('league.problems', { count: run.problems.length })}</summary>
            <ul>
              {run.problems.slice(0, 20).map((p, i) => (
                <li key={i}>
                  {t('league.problem', { row: p.row, column: p.column, value: p.value })}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section>
        <h3>{t('league.naming')}</h3>
        <label className="field">
          <span>{t('league.folder')}</span>
          <input
            value={league.folder}
            disabled={running}
            onChange={(e) => update({ folder: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('league.skinName')}</span>
          <input
            value={league.skinName}
            disabled={running}
            onChange={(e) => update({ skinName: e.target.value })}
          />
        </label>
        <p className="hint">{t('league.namingHint')}</p>
      </section>

      <CarsSection disabled={running} />

      <section>
        {run.status === 'idle' || running ? (
          <button
            className="btn primary wide"
            disabled={running || total === 0}
            onClick={() => void runLeague()}
          >
            {t('league.generate', { count: total })}
          </button>
        ) : null}
        {running && (
          <div className="league-progress" role="status">
            <progress max={run.total} value={run.done} />
            <span className="small">
              {run.done} / {run.total} · {run.current}
            </span>
            <button className="btn small" onClick={cancel}>
              {t('league.cancel')}
            </button>
          </div>
        )}
        {(run.status === 'done' || run.status === 'cancelled') && <Report />}
        {(run.status === 'done' || run.status === 'cancelled') && (
          <button className="btn small" onClick={dismiss}>
            {t('league.again')}
          </button>
        )}
      </section>
    </div>
  )
}

function Report() {
  const { t } = useTranslation()
  const run = useStore((s) => s.leagueRun)
  const ok = run.results.filter((r) => r.ok)
  const failed = run.results.filter((r) => !r.ok)
  return (
    <div className="league-report">
      <p className={`notice ${failed.length ? 'warn' : 'ok'}`}>
        {run.status === 'cancelled' ? t('league.cancelled') + ' ' : ''}
        {t('league.summary', { ok: ok.length, failed: failed.length })}
      </p>
      {failed.length > 0 && (
        <ul className="league-errors">
          {failed.map((r, i) => (
            <li key={i}>
              <strong>{r.skin || r.driver}</strong> ({r.car}): {r.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CarsSection({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const cars = useStore((s) => s.cars)
  const current = useStore((s) => s.car)
  const league = useStore((s) => s.draft.league ?? DEFAULT_LEAGUE)
  const update = useStore((s) => s.updateLeague)
  const [filter, setFilter] = useState('')
  const chosen = league.cars.length ? league.cars : current ? [current.id] : []
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...new Set([...chosen, id])] : chosen.filter((c) => c !== id)
    update({ cars: next })
  }
  const list = filteredCars(cars, filter)
  return (
    <section>
      <h3>{t('league.cars', { count: chosen.length })}</h3>
      <input
        type="search"
        value={filter}
        placeholder={t('cars.search')}
        aria-label={t('cars.search')}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="league-cars">
        {list.map((c) => (
          <label key={c.id} className="check">
            <input
              type="checkbox"
              checked={chosen.includes(c.id)}
              disabled={disabled}
              onChange={(e) => toggle(c.id, e.target.checked)}
            />
            <span className="ellipsis">{c.name}</span>
          </label>
        ))}
      </div>
      <p className="hint">{t('league.carsHint')}</p>
    </section>
  )
}

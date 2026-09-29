import { useTranslation } from 'react-i18next'
import type { TemplateParam } from '@shared/design/params'
import { DEFAULT_LEAGUE, type LeagueRow } from '@shared/league/table'
import { useStore } from '../state/store'
import { useParamLabel } from './livery/Binding'
import { FlagSelect } from './livery/FlagSelect'

const NO_PARAMS: TemplateParam[] = []

/** The drivers table, shown over the lower part of the 3D view. */
export function LeagueTable() {
  const { t } = useTranslation()
  const open = useStore((s) => s.leagueTableOpen)
  const leagueImport = useStore((s) => s.leagueImport)
  const setOpen = useStore((s) => s.setLeagueTableOpen)
  if (!open) return null
  return (
    <div className="league-drawer" role="dialog" aria-label={t('league.tableTitle')}>
      <div className="league-drawer-head">
        <strong>
          {leagueImport
            ? t('league.mappingTitle', { file: leagueImport.fileName })
            : t('league.tableTitle')}
        </strong>
        <button className="icon-btn" aria-label={t('project.close')} onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      {leagueImport ? <ImportMapping /> : <Rows />}
    </div>
  )
}

function Rows() {
  const { t } = useTranslation()
  const params = useStore((s) => s.draft.params ?? NO_PARAMS)
  const league = useStore((s) => s.draft.league ?? DEFAULT_LEAGUE)
  const preview = useStore((s) => s.leaguePreview)
  const previewRow = useStore((s) => s.previewLeagueRow)
  const remove = useStore((s) => s.removeLeagueRow)
  const addRow = useStore((s) => s.addLeagueRow)
  const clear = useStore((s) => s.clearLeague)
  const label = useParamLabel()

  return (
    <div className="league-table-wrap">
      <table className="league-table">
        <thead>
          <tr>
            <th aria-label={t('league.preview')} />
            {params.map((p) => (
              <th key={p.id}>{label(p)}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {league.rows.map((row) => (
            <tr key={row.id} className={preview === row.id ? 'previewed' : ''}>
              <td>
                <button
                  className={`icon-btn ${preview === row.id ? 'on' : ''}`}
                  title={t('league.preview')}
                  aria-label={t('league.preview')}
                  onClick={() => previewRow(preview === row.id ? null : row.id)}
                >
                  👁
                </button>
              </td>
              {params.map((p) => (
                <td key={p.id}>
                  <Cell row={row} param={p} />
                </td>
              ))}
              <td>
                <button
                  className="icon-btn"
                  title={t('league.removeRow')}
                  aria-label={t('league.removeRow')}
                  onClick={() => remove(row.id)}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row gap">
        <button className="btn small" onClick={addRow}>
          {t('league.addRow')}
        </button>
        {league.rows.length > 0 && (
          <button className="btn ghost small" onClick={clear}>
            {t('league.clear')}
          </button>
        )}
        <span className="hint">{t('league.tableHint')}</span>
      </div>
    </div>
  )
}

function Cell({ row, param }: { row: LeagueRow; param: TemplateParam }) {
  const { t } = useTranslation()
  const update = useStore((s) => s.updateLeagueRow)
  const stickers = useStore((s) => s.stickers)
  const assets = useStore((s) => s.draft.design.assets)
  const stickerAsset = useStore((s) => s.stickerAsset)
  const value = row.values[param.id] ?? ''
  const set = (v: string) => update(row.id, { [param.id]: v })
  const aria = `${param.id} ${row.id}`

  if (param.kind === 'color') {
    return (
      <input
        type="color"
        aria-label={aria}
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : param.default}
        onChange={(e) => set(e.target.value)}
      />
    )
  }
  if (param.kind === 'flag') return <FlagSelect value={value} onChange={set} label={aria} />
  if (param.kind === 'image') {
    // the design's own images plus every sticker of the library
    const own = Object.entries(assets).filter(
      ([id, a]) => !id.startsWith('st_') && /^image\//.test(a.mime),
    )
    return (
      <select
        aria-label={aria}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          const sticker = stickers.find((s) => `sticker:${s.id}` === v)
          if (sticker) void stickerAsset(sticker).then(set)
          else set(v)
        }}
      >
        <option value="">{t('league.noImage')}</option>
        {own.map(([id, a]) => (
          <option key={id} value={id}>
            {a.name}
          </option>
        ))}
        {stickers.map((s) => {
          const id = `st_${s.id.replace(/[^a-z0-9_-]/gi, '_')}`
          return (
            <option key={s.id} value={assets[id] ? id : `sticker:${s.id}`}>
              {s.name}
            </option>
          )
        })}
      </select>
    )
  }
  return (
    <input
      aria-label={aria}
      value={value}
      placeholder={param.default}
      onChange={(e) => set(e.target.value)}
    />
  )
}

function ImportMapping() {
  const { t } = useTranslation()
  const im = useStore((s) => s.leagueImport)!
  const params = useStore((s) => s.draft.params ?? NO_PARAMS)
  const rows = useStore((s) => s.draft.league?.rows.length ?? 0)
  const setMapping = useStore((s) => s.setImportMapping)
  const setHeader = useStore((s) => s.setImportHeader)
  const confirm = useStore((s) => s.confirmImport)
  const cancel = useStore((s) => s.cancelImport)
  const label = useParamLabel()
  const width = Math.max(0, ...im.cells.map((r) => r.length))
  const sample = im.cells.slice(im.header ? 1 : 0, (im.header ? 1 : 0) + 4)

  return (
    <div className="league-table-wrap">
      <label className="check">
        <input type="checkbox" checked={im.header} onChange={(e) => setHeader(e.target.checked)} />
        {t('league.hasHeader')}
      </label>
      <table className="league-table mapping">
        <thead>
          <tr>
            {Array.from({ length: width }, (_, col) => (
              <th key={col}>
                <div className="small muted">{im.header ? im.cells[0]?.[col] : `#${col + 1}`}</div>
                <select
                  aria-label={t('league.columnFor', {
                    column: im.header ? im.cells[0]?.[col] : col + 1,
                  })}
                  value={im.mapping[col] ?? ''}
                  onChange={(e) => setMapping(col, e.target.value || null)}
                >
                  <option value="">{t('league.ignore')}</option>
                  {params.map((p) => (
                    <option key={p.id} value={p.id}>
                      {label(p)}
                    </option>
                  ))}
                </select>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sample.map((r, i) => (
            <tr key={i}>
              {Array.from({ length: width }, (_, col) => (
                <td key={col} className="small">
                  {r[col]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row gap">
        <button className="btn small primary" onClick={() => confirm('replace')}>
          {t('league.replaceRows', { count: im.cells.length - (im.header ? 1 : 0) })}
        </button>
        {rows > 0 && (
          <button className="btn small" onClick={() => confirm('append')}>
            {t('league.appendRows')}
          </button>
        )}
        <button className="btn ghost small" onClick={cancel}>
          {t('league.cancel')}
        </button>
      </div>
    </div>
  )
}

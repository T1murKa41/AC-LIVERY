import { useTranslation } from 'react-i18next'
import { useStore, type LiveryMeta } from '../../state/store'

const META_FIELDS: (keyof LiveryMeta)[] = ['skinname', 'drivername', 'team', 'number', 'country']

/** Skin metadata (ui_skin.json) and the folder name. */
export function SavePanel() {
  const { t } = useTranslation()
  const draft = useStore((s) => s.draft)
  const update = useStore((s) => s.updateDraft)
  return (
    <section>
      <h3>{t('livery.meta')}</h3>
      {META_FIELDS.map((key) => (
        <label className="field" key={key}>
          <span>{t(`livery.${key}`)}</span>
          <input
            value={draft.meta[key]}
            onChange={(e) => update({ meta: { [key]: e.target.value } })}
          />
        </label>
      ))}
      <div className="field">
        <label htmlFor="skin-id">{t('livery.skinId')}</label>
        <input
          id="skin-id"
          className="mono"
          value={draft.skinId}
          onChange={(e) => update({ skinId: e.target.value })}
          aria-describedby="skin-id-hint"
        />
        <small id="skin-id-hint" className="hint">
          {t('livery.skinIdHint')}
        </small>
      </div>
    </section>
  )
}

/** Save button and the result of the last export; stays at the bottom of the panel. */
export function ExportBar() {
  const { t } = useTranslation()
  const draft = useStore((s) => s.draft)
  const exportState = useStore((s) => s.exportState)
  const exportLivery = useStore((s) => s.exportLivery)
  const dismiss = useStore((s) => s.dismissExport)
  const reveal = useStore((s) => s.backend.revealPath)
  return (
    <div className="export">
      {exportState.status === 'confirm' && (
        <div className="notice warn">
          <p>
            {exportState.foreign
              ? t('livery.overwriteForeign', { id: draft.skinId })
              : t('livery.overwriteOurs', { id: draft.skinId })}
          </p>
          <div className="row gap">
            <button
              className="btn danger small"
              onClick={() => void exportLivery(exportState.mode)}
            >
              {t('livery.overwrite')}
            </button>
            <button className="btn small" onClick={dismiss}>
              {t('livery.cancel')}
            </button>
          </div>
        </div>
      )}
      {exportState.status === 'done' && (
        <div className="notice ok">
          <p>{t('livery.exported', { path: exportState.path })}</p>
          {exportState.builtinEncoder && <p className="hint">{t('livery.builtinEncoder')}</p>}
          <button className="btn small" onClick={() => void reveal(exportState.path)}>
            {t('livery.reveal')}
          </button>
        </div>
      )}
      {exportState.status === 'error' && <p className="notice error">{exportState.message}</p>}
      <button
        className="btn primary wide"
        disabled={exportState.status === 'working'}
        onClick={() => void exportLivery()}
      >
        {exportState.status === 'working'
          ? t('livery.exporting')
          : t('livery.exportAs', { id: draft.skinId })}
      </button>
    </div>
  )
}

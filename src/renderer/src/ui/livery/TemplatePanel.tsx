import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TemplateParam } from '@shared/design/params'
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from '@shared/design/templates'
import { useStore, type TemplateDraft, type UserTemplate } from '../../state/store'
import { useParamLabel } from './Binding'
import { ColorField } from './ColorField'

const IMAGE_TYPES = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml'
const NO_PARAMS: TemplateParam[] = []

/** Template gallery and the values of the current template's parameters. */
export function TemplatePanel() {
  const previewTemplate = useStore((s) => s.previewTemplate)
  // leaving the panel never leaves a preview on the car
  useEffect(() => () => previewTemplate(null), [previewTemplate])
  return (
    <>
      <ParamsSection />
      <Gallery />
    </>
  )
}

function ParamsSection() {
  const { t } = useTranslation()
  const params = useStore((s) => s.draft.params ?? NO_PARAMS)
  const template = useStore((s) => s.draft.template)
  const addStandard = useStore((s) => s.addStandardParams)
  const addParam = useStore((s) => s.addParam)

  return (
    <section className="params">
      <h3>{template ? t('params.titleOf', { name: template }) : t('params.title')}</h3>
      {params.length === 0 ? (
        <>
          <p className="hint">{t('params.empty')}</p>
          <button className="btn small" onClick={addStandard}>
            {t('params.makeTemplate')}
          </button>
        </>
      ) : (
        <>
          {params.map((p) => (
            <ParamRow key={p.id} param={p} />
          ))}
          <div className="row gap wrap">
            <span className="muted small">{t('params.add')}</span>
            {(['text', 'color', 'image'] as const).map((kind) => (
              <button key={kind} className="btn small" onClick={() => addParam(kind)}>
                {t(`params.kinds.${kind}`)}
              </button>
            ))}
          </div>
          <p className="hint">{t('params.hint')}</p>
        </>
      )}
    </section>
  )
}

function ParamRow({ param }: { param: TemplateParam }) {
  const { t } = useTranslation()
  const value = useStore((s) => s.draft.values?.[param.id])
  const assets = useStore((s) => s.draft.design.assets)
  const setValue = useStore((s) => s.setParamValue)
  const setImage = useStore((s) => s.setParamImage)
  const remove = useStore((s) => s.removeParam)
  const input = useRef<HTMLInputElement>(null)
  const current = value ?? param.default
  const label = useParamLabel()(param)

  const removeButton = (
    <button
      className="icon-btn"
      title={t('params.remove')}
      aria-label={t('params.remove')}
      onClick={() => remove(param.id)}
    >
      ×
    </button>
  )

  if (param.kind === 'color') {
    return (
      <div className="param-row">
        <div className="field grow">
          <span>{label}</span>
          <ColorField value={current} onChange={(v) => setValue(param.id, v)} label={param.label} />
        </div>
        {removeButton}
      </div>
    )
  }
  if (param.kind === 'image') {
    const asset = current ? assets[current] : undefined
    return (
      <div className="param-row">
        <div className="field grow">
          <span>{label}</span>
          <div className="row gap">
            <button className="btn small" onClick={() => input.current?.click()}>
              {t('params.pickImage')}
            </button>
            <span className="muted small ellipsis">{asset?.name ?? t('params.noImage')}</span>
            {asset && (
              <button className="icon-btn" onClick={() => setValue(param.id, '')}>
                ⌫
              </button>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept={IMAGE_TYPES}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void setImage(param.id, file)
            }}
          />
        </div>
        {removeButton}
      </div>
    )
  }
  return (
    <div className="param-row">
      <label className="field grow">
        <span>
          {label} <span className="mono muted">{`{${param.id}}`}</span>
        </span>
        <input value={current} onChange={(e) => setValue(param.id, e.target.value)} />
      </label>
      {removeButton}
    </div>
  )
}

function Gallery() {
  const { t, i18n } = useTranslation()
  const userTemplates = useStore((s) => s.userTemplates)
  const message = useStore((s) => s.templateMessage)
  const apply = useStore((s) => s.applyTemplate)
  const preview = useStore((s) => s.previewTemplate)
  const userTemplate = useStore((s) => s.userTemplate)
  const saveAs = useStore((s) => s.saveAsTemplate)
  const importTemplate = useStore((s) => s.importTemplate)
  const exportTemplate = useStore((s) => s.exportTemplate)
  const deleteTemplate = useStore((s) => s.deleteTemplate)
  const currentName = useStore((s) => s.draft.template ?? s.draft.meta.skinname)
  const [name, setName] = useState('')
  const hovered = useRef<string | null>(null)
  const lang = i18n.language === 'en' ? 'en' : 'ru'

  const builtin = (b: BuiltinTemplate): TemplateDraft => ({ name: b.name[lang], ...b.build() })
  const hover = (id: string | null, load?: () => Promise<TemplateDraft | null>) => {
    hovered.current = id
    if (!load) return preview(null)
    void load().then((d) => {
      // the pointer may have moved on while the template was being read
      if (d && hovered.current === id) preview(d)
    })
  }

  return (
    <section>
      <h3>{t('templates.title')}</h3>
      <p className="hint">{t('templates.hint')}</p>
      <div className="template-grid">
        {BUILTIN_TEMPLATES.map((b) => (
          <TemplateCard
            key={b.id}
            name={b.name[lang]}
            description={b.description[lang]}
            swatch={b.swatch}
            onEnter={() => hover(b.id, async () => builtin(b))}
            onLeave={() => hover(null)}
            onApply={() => apply(builtin(b))}
          />
        ))}
        {userTemplates.map((u) => (
          <TemplateCard
            key={u.id}
            name={u.name}
            template={u}
            onEnter={() => hover(u.id, () => userTemplate(u.id))}
            onLeave={() => hover(null)}
            onApply={() => void userTemplate(u.id).then((d) => d && apply(d))}
            onExport={() => void exportTemplate(u.id)}
            onDelete={() => void deleteTemplate(u.id)}
          />
        ))}
      </div>
      <form
        className="row gap save-template"
        onSubmit={(e) => {
          e.preventDefault()
          void saveAs(name || currentName)
          setName('')
        }}
      >
        <input
          value={name}
          placeholder={currentName}
          aria-label={t('templates.name')}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn small" type="submit">
          {t('templates.save')}
        </button>
      </form>
      <button className="btn ghost small" onClick={() => void importTemplate()}>
        {t('templates.import')}
      </button>
      {message && <p className={`notice ${message.kind}`}>{message.text}</p>}
    </section>
  )
}

function TemplateCard(props: {
  name: string
  description?: string
  swatch?: [string, string, string]
  template?: UserTemplate
  onEnter(): void
  onLeave(): void
  onApply(): void
  onExport?(): void
  onDelete?(): void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="template-card"
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
      onFocus={props.onEnter}
      onBlur={props.onLeave}
    >
      <div className="template-thumb" aria-hidden>
        {props.template?.previewUrl ? (
          <img src={props.template.previewUrl} alt="" />
        ) : (
          (props.swatch ?? ['#444', '#666', '#888']).map((c, i) => (
            <span key={i} style={{ background: c }} />
          ))
        )}
      </div>
      <div className="template-info">
        <strong>{props.name}</strong>
        {props.description && <span>{props.description}</span>}
      </div>
      <div className="row gap">
        <button className="btn small primary" onClick={props.onApply}>
          {t('templates.apply')}
        </button>
        {props.onExport && (
          <button className="icon-btn" title={t('templates.export')} onClick={props.onExport}>
            ⤓
          </button>
        )}
        {props.onDelete && (
          <button className="icon-btn" title={t('templates.delete')} onClick={props.onDelete}>
            🗑
          </button>
        )}
      </div>
    </div>
  )
}

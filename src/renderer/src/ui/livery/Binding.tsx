import { useTranslation } from 'react-i18next'
import { STANDARD_PARAMS, type ParamKind, type TemplateParam } from '@shared/design/params'
import { useStore } from '../../state/store'
import { ColorField } from './ColorField'

const NO_PARAMS: TemplateParam[] = []
const STANDARD_IDS = new Set(STANDARD_PARAMS.map((p) => p.id))

/** Label of a parameter in the interface language (standard ones are translated). */
export function useParamLabel(): (p: TemplateParam) => string {
  const { t } = useTranslation()
  return (p) => (STANDARD_IDS.has(p.id) ? t(`params.standard.${p.id}`) : p.label)
}

/** Template parameters of one kind. */
export function useParams(kind: ParamKind): TemplateParam[] {
  const params = useStore((s) => s.draft.params ?? NO_PARAMS)
  return params.filter((p) => p.kind === kind)
}

/** Picks the template parameter a property follows (hidden without parameters). */
export function BindSelect(props: {
  kind: ParamKind
  value: string | undefined
  onChange(paramId: string | null): void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const params = useParams(props.kind)
  const label = useParamLabel()
  if (!params.length) return null
  return (
    <label className="field bind">
      <span>{t('params.bindTo')}</span>
      <select
        value={props.value ?? ''}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value || null)}
      >
        <option value="">{t('params.noBinding')}</option>
        {params.map((p) => (
          <option key={p.id} value={p.id}>
            {label(p)}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * A colour that can follow a template parameter. While bound, the picker
 * edits the parameter's value, so every property bound to it changes.
 */
export function BoundColor(props: {
  label: string
  value: string
  onChange(value: string): void
  binding: string | undefined
  onBind(paramId: string | null): void
  swatches?: boolean
  disabled?: boolean
}) {
  const params = useParams('color')
  const values = useStore((s) => s.draft.values)
  const setParamValue = useStore((s) => s.setParamValue)
  const paramLabel = useParamLabel()
  const bound = params.find((p) => p.id === props.binding)
  const value = bound ? (values?.[bound.id] ?? bound.default) : props.value
  return (
    <>
      <ColorField
        value={value}
        onChange={(v) => (bound ? setParamValue(bound.id, v) : props.onChange(v))}
        label={bound ? `${props.label} · ${paramLabel(bound)}` : props.label}
        swatches={props.swatches}
      />
      <BindSelect
        kind="color"
        value={props.binding}
        onChange={props.onBind}
        disabled={props.disabled}
      />
    </>
  )
}

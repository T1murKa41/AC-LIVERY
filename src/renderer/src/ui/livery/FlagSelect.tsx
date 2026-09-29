import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FLAG_PREFIX } from '@shared/design/params'
import { FLAG_CODES, flagName } from '../../engine/flags'

/** Country picker; the value is flag:<code> or empty for none. */
export function FlagSelect(props: {
  value: string
  onChange(value: string): void
  label?: string
}) {
  const { t, i18n } = useTranslation()
  const options = useMemo(
    () =>
      FLAG_CODES.map((code) => ({ code, name: flagName(code, i18n.language) })).sort((a, b) =>
        a.name.localeCompare(b.name, i18n.language),
      ),
    [i18n.language],
  )
  return (
    <select
      value={props.value}
      aria-label={props.label}
      onChange={(e) => props.onChange(e.target.value)}
    >
      <option value="">{t('params.noFlag')}</option>
      {options.map((o) => (
        <option key={o.code} value={FLAG_PREFIX + o.code}>
          {o.name}
        </option>
      ))}
    </select>
  )
}

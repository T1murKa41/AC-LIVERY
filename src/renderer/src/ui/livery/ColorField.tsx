export const SWATCHES = [
  '#d7261e',
  '#f25c05',
  '#f2b705',
  '#2e9e44',
  '#0b6e4f',
  '#1c5fd4',
  '#0a2463',
  '#6a2c91',
  '#e84393',
  '#f4f4f2',
  '#9aa0a6',
  '#16181b',
]

interface Props {
  value: string
  onChange(value: string): void
  label: string
  swatches?: boolean
}

/** Colour picker with a HEX field and optional quick swatches. */
export function ColorField({ value, onChange, label, swatches = false }: Props) {
  return (
    <>
      <div className="color-row">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          className="mono"
          defaultValue={value}
          key={value}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase())
          }}
          aria-label={`${label} HEX`}
        />
      </div>
      {swatches && (
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button
              key={c}
              className={`swatch ${value === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => onChange(c)}
              aria-label={c}
            />
          ))}
        </div>
      )}
    </>
  )
}

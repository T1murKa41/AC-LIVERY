import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Sticker } from '@shared/design/stickers'
import { useStore } from '../../state/store'

const IMAGE_TYPES = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml'

/** Grid of stickers: built-in made-up sponsors, then the user's own logos. */
export function StickerPicker({ onPick }: { onPick(sticker: Sticker): void }) {
  const { t } = useTranslation()
  const stickers = useStore((s) => s.stickers)
  const addToLibrary = useStore((s) => s.addToLibrary)
  const remove = useStore((s) => s.removeFromLibrary)
  const input = useRef<HTMLInputElement>(null)

  return (
    <div className="sticker-picker">
      <div className="sticker-grid" role="listbox" aria-label={t('stickers.title')}>
        {stickers.map((s) => {
          const own = !s.id.startsWith('builtin:')
          return (
            <div key={s.id} className="sticker" role="option" aria-selected={false}>
              <button className="sticker-thumb" title={s.name} onClick={() => onPick(s)}>
                <img src={s.data} alt={s.name} />
              </button>
              {own && (
                <button
                  className="sticker-remove"
                  title={t('stickers.remove')}
                  aria-label={t('stickers.remove')}
                  onClick={() => void remove(s.id)}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="row gap wrap">
        <button className="btn small" onClick={() => input.current?.click()}>
          {t('stickers.add')}
        </button>
        <input
          ref={input}
          type="file"
          accept={IMAGE_TYPES}
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) void addToLibrary(files)
          }}
        />
      </div>
      <p className="hint">{t('stickers.hint')}</p>
    </div>
  )
}

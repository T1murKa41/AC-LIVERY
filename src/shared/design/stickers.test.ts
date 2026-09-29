import { describe, expect, it } from 'vitest'
import { dataUrlToBytes } from './project'
import { BUILTIN_STICKERS, stickerAssetId } from './stickers'

describe('built-in stickers', () => {
  it('are sized SVGs with unique ids', () => {
    expect(BUILTIN_STICKERS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(BUILTIN_STICKERS.map((s) => s.id)).size).toBe(BUILTIN_STICKERS.length)
    for (const s of BUILTIN_STICKERS) {
      const svg = new TextDecoder().decode(dataUrlToBytes(s.data))
      expect(svg).toMatch(/^<svg [^>]*width="\d+" height="\d+"/)
      expect(svg.match(/<text/g)?.length ?? 0).toBeGreaterThan(0)
      expect(stickerAssetId(s)).toMatch(/^st_[a-z0-9_-]+$/)
    }
  })
})

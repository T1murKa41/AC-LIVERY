// Country flags from flag-icons (MIT), 4:3 SVGs loaded on demand.

import { FLAG_PREFIX } from '@shared/design/params'

const loaders = import.meta.glob('../../../../node_modules/flag-icons/flags/4x3/*.svg', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

const byCode = new Map<string, () => Promise<string>>()
for (const [path, load] of Object.entries(loaders)) {
  byCode.set(path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), load)
}

/** Flag codes available (ISO 3166 alpha-2 plus a few regions such as gb-eng, eu). */
export const FLAG_CODES = [...byCode.keys()].sort()

const cache = new Map<string, Promise<string>>()

/** The flag as an SVG data: URL; `value` is a code or flag:<code>. */
export function flagDataUrl(value: string): Promise<string> {
  const code = value.startsWith(FLAG_PREFIX) ? value.slice(FLAG_PREFIX.length) : value
  let p = cache.get(code)
  if (!p) {
    const load = byCode.get(code)
    if (!load) return Promise.reject(new Error(`Unknown flag "${code}"`))
    p = load().then((svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    cache.set(code, p)
  }
  return p
}

/** Country name in the interface language, for pickers. */
export function flagName(code: string, language: string): string {
  try {
    return new Intl.DisplayNames([language], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code.toUpperCase()
  }
}

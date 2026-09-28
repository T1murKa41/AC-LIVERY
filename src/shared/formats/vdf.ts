// Minimal parser for Valve's text KeyValues format (e.g. steamapps/libraryfolders.vdf).

export type VdfValue = string | VdfObject
export interface VdfObject {
  [key: string]: VdfValue
}

export function parseVdf(text: string): VdfObject {
  let i = 0
  const n = text.length

  const skip = (): void => {
    while (i < n) {
      const ch = text[i]!
      if (ch === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++
      } else if (/\s/.test(ch)) {
        i++
      } else {
        break
      }
    }
  }

  const token = (): string | null => {
    skip()
    if (i >= n) return null
    const ch = text[i]!
    if (ch === '{' || ch === '}') {
      i++
      return ch
    }
    if (ch === '"') {
      i++
      let s = ''
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const next = text[i + 1]!
          s += next === 'n' ? '\n' : next === 't' ? '\t' : next
          i += 2
        } else {
          s += text[i++]
        }
      }
      i++
      return s
    }
    let s = ''
    while (i < n && !/[\s{}"]/.test(text[i]!)) s += text[i++]
    return s
  }

  const parseObject = (): VdfObject => {
    const obj: VdfObject = {}
    for (;;) {
      const key = token()
      if (key === null || key === '}') return obj
      const value = token()
      if (value === null) return obj
      obj[key] = value === '{' ? parseObject() : value
    }
  }

  return parseObject()
}

/** Library root paths listed in libraryfolders.vdf (both old and new layouts). */
export function steamLibraryPaths(vdf: VdfObject): string[] {
  const root = (vdf['libraryfolders'] ?? vdf['LibraryFolders']) as VdfObject | undefined
  if (!root || typeof root !== 'object') return []
  const paths: string[] = []
  for (const [key, value] of Object.entries(root)) {
    if (!/^\d+$/.test(key)) continue
    if (typeof value === 'string') paths.push(value)
    else if (typeof value.path === 'string') paths.push(value.path)
  }
  return paths
}

/**
 * Parses JSON the way Assetto Corsa content tends to be written in the wild:
 * optional BOM, // and block comments, trailing commas and raw control
 * characters (tabs, newlines) inside strings.
 */
export function parseLenientJson(text: string): unknown {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let out = ''
  let inString = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (inString) {
      if (ch === '\\') {
        out += ch + (s[i + 1] ?? '')
        i++
      } else if (ch === '"') {
        inString = false
        out += ch
      } else if (ch === '\n') {
        out += '\\n'
      } else if (ch === '\r') {
        out += '\\r'
      } else if (ch === '\t') {
        out += '\\t'
      } else if (ch.charCodeAt(0) < 0x20) {
        out += ' '
      } else {
        out += ch
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && s[i + 1] === '*') {
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++
      i++
    } else {
      out += ch
    }
  }
  return JSON.parse(stripTrailingCommas(out))
}

/** Removes commas directly followed (ignoring whitespace) by } or ], outside of strings. */
function stripTrailingCommas(s: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (inString) {
      if (ch === '\\') {
        out += ch + (s[i + 1] ?? '')
        i++
        continue
      }
      if (ch === '"') inString = false
      out += ch
      continue
    }
    if (ch === '"') inString = true
    if (ch === ',') {
      let j = i + 1
      while (j < s.length && /\s/.test(s[j]!)) j++
      if (s[j] === '}' || s[j] === ']') continue
    }
    out += ch
  }
  return out
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

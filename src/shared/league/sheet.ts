// Reading driver tables: CSV (any common delimiter) and XLSX (first sheet).
// Only cell values are needed, so XLSX is read straight from its XML parts
// instead of pulling in a spreadsheet library.

import { strFromU8, unzipSync } from 'fflate'

/** Parses CSV/TSV text; the delimiter (comma, semicolon or tab) is detected. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const counts = [',', ';', '\t'].map((d) => [d, countOutsideQuotes(firstLine, d)] as const)
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts[0]![0] : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return trimRows(rows)
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === d && !quoted) n++
  }
  return n
}

/** Drops empty trailing rows and trims cells. */
function trimRows(rows: string[][]): string[][] {
  const out = rows.map((r) => r.map((c) => c.trim()))
  while (out.length && out.at(-1)!.every((c) => c === '')) out.pop()
  return out
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const lower = e.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    const code = lower.startsWith('#x')
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10)
    return String.fromCodePoint(code)
  })
}

/** Text of every <t> inside a fragment (rich text runs are joined). */
function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('')
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export class SheetFormatError extends Error {}

/** Cell values of the first worksheet of an .xlsx file. */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (f) =>
        (f.name.startsWith('xl/') && f.name.endsWith('.xml')) || f.name.endsWith('.rels'),
    })
  } catch {
    throw new SheetFormatError('Not an .xlsx file')
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]!) : null)
  const workbook = text('xl/workbook.xml')
  if (!workbook) throw new SheetFormatError('Not an .xlsx file (no workbook)')
  const firstSheet = /<sheet\s[^>]*>/.exec(workbook)?.[0]
  const relId = firstSheet && (attr(firstSheet, 'r:id') ?? attr(firstSheet, 'id'))
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const rels = text('xl/_rels/workbook.xml.rels')
  if (relId && rels) {
    const rel = [...rels.matchAll(/<Relationship\s[^>]*>/g)]
      .map((m) => m[0])
      .find((r) => attr(r, 'Id') === relId)
    const target = rel && attr(rel, 'Target')
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  }
  const sheet = text(sheetPath)
  if (!sheet) throw new SheetFormatError('The first worksheet is missing')
  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (m) => textOf(m[1]!),
  )

  const rows: string[][] = []
  for (const r of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attr(r[1]!, 'r')) || rows.length + 1
    const row: string[] = []
    for (const c of r[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1]!
      const body = c[2] ?? ''
      const ref = attr(a, 'r')
      const col = ref ? columnIndex(ref) : row.length
      const type = attr(a, 't')
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = textOf(body)
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
      else if (v !== undefined) value = decodeXml(v)
      while (row.length < col) row.push('')
      row[col] = value
    }
    while (rows.length < rowNumber - 1) rows.push([])
    rows[rowNumber - 1] = row
  }
  const width = Math.max(0, ...rows.map((r) => r.length))
  return trimRows(rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')))
}

/** A table from a file picked by the user. */
export function readTable(bytes: Uint8Array, fileName: string): string[][] {
  if (/\.xlsx$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return readXlsx(bytes)
  return parseCsv(new TextDecoder().decode(bytes))
}

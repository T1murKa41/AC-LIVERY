// The league table: one row of template parameter values per driver, plus
// how their skins are named. Rows come from the table editor or from a
// CSV/XLSX file whose columns are matched to parameters.

import { slugifySkinId } from '../api'
import { FLAG_PREFIX, fillText, type TemplateParam } from '../design/params'

export interface LeagueRow {
  id: string
  /** Parameter id → value (text, #rrggbb, asset id, flag:<code>). */
  values: Record<string, string>
}

export interface LeagueTable {
  rows: LeagueRow[]
  /** Skin folder name, with {placeholders}; made safe for the game. */
  folder: string
  /** ui_skin.json skinname, with {placeholders}. */
  skinName: string
  /** Cars to generate for; empty means the car that is open. */
  cars: string[]
}

export const DEFAULT_LEAGUE: LeagueTable = {
  rows: [],
  folder: '{number}_{driver}',
  skinName: '#{number} {driver}',
  cars: [],
}

let counter = 0
export function newRowId(): string {
  counter = (counter + 1) % 1_000_000
  return `r${Date.now().toString(36)}${counter.toString(36)}`
}

// -- column matching ----------------------------------------------------------

const HEADER_RULES: [RegExp, string][] = [
  [/^(#|№|n|no\.?|num|number|номер|race ?number|car ?number|стартовый номер)$/i, 'number'],
  [/(driver|pilot|пилот|гонщик|racer|имя|^name$|full ?name|фио)/i, 'driver'],
  [/(team|команда|entrant)/i, 'team'],
  [/(country|nation|nationality|страна|флаг|flag|гражданство)/i, 'country'],
]

/**
 * Guesses which parameter each column holds from its header. Colour and
 * sponsor columns are given out in order (primary, secondary, accent...).
 */
export function guessMapping(
  header: readonly string[],
  params: readonly TemplateParam[],
): (string | null)[] {
  const ids = new Set(params.map((p) => p.id))
  const taken = new Set<string>()
  const colours = params.filter((p) => p.kind === 'color').map((p) => p.id)
  const images = params.filter((p) => p.kind === 'image').map((p) => p.id)
  const take = (id: string | undefined) => {
    if (!id || !ids.has(id) || taken.has(id)) return null
    taken.add(id)
    return id
  }
  return header.map((raw) => {
    const h = raw.trim()
    const lower = h.toLowerCase()
    // a header naming a parameter directly (id or label)
    const direct = params.find(
      (p) => p.id.toLowerCase() === lower || p.label.toLowerCase() === lower,
    )
    if (direct) return take(direct.id)
    for (const [re, id] of HEADER_RULES) if (re.test(h)) return take(id)
    if (/(colou?r|цвет)/i.test(h)) return take(colours.find((c) => !taken.has(c)))
    if (/(sponsor|спонсор|logo|логотип)/i.test(h)) return take(images.find((c) => !taken.has(c)))
    return null
  })
}

// -- values -------------------------------------------------------------------

const NAMED_COLOURS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#d7261e',
  green: '#2e9e44',
  blue: '#1c5fd4',
  yellow: '#f2b705',
  orange: '#f25c05',
  purple: '#6a2c91',
  pink: '#e84393',
  grey: '#9aa0a6',
  gray: '#9aa0a6',
  silver: '#c0c4c8',
  gold: '#c9a227',
  navy: '#0a2463',
  черный: '#000000',
  чёрный: '#000000',
  белый: '#ffffff',
  красный: '#d7261e',
  зеленый: '#2e9e44',
  зелёный: '#2e9e44',
  синий: '#1c5fd4',
  желтый: '#f2b705',
  жёлтый: '#f2b705',
  оранжевый: '#f25c05',
  фиолетовый: '#6a2c91',
  розовый: '#e84393',
  серый: '#9aa0a6',
  серебристый: '#c0c4c8',
  золотой: '#c9a227',
}

/** #rrggbb from #rgb, rrggbb, rgb(r, g, b) or a common colour name; null if unknown. */
export function parseColour(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  let m = /^#?([0-9a-f]{6})$/.exec(v)
  if (m) return `#${m[1]}`
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`
  m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(v)
  if (m) {
    return `#${[m[1], m[2], m[3]]
      .map((c) => Math.min(255, Number(c)).toString(16).padStart(2, '0'))
      .join('')}`
  }
  return NAMED_COLOURS[v] ?? null
}

let countryIndex: Map<string, string> | null = null

/** Region names in English and Russian, and IOC-style codes, to ISO codes. */
function countries(): Map<string, string> {
  if (countryIndex) return countryIndex
  countryIndex = new Map()
  const names = ['en', 'ru'].map((l) => {
    try {
      return new Intl.DisplayNames([l], { type: 'region' })
    } catch {
      return null
    }
  })
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b)
      for (const dn of names) {
        const name = dn?.of(code)
        if (name && name !== code) countryIndex.set(name.toLowerCase(), code.toLowerCase())
      }
    }
  }
  const extra: Record<string, string> = {
    uk: 'gb',
    england: 'gb-eng',
    scotland: 'gb-sct',
    wales: 'gb-wls',
    usa: 'us',
    россия: 'ru',
    ger: 'de',
    ita: 'it',
    fra: 'fr',
    esp: 'es',
    ned: 'nl',
    gbr: 'gb',
    rus: 'ru',
    jpn: 'jp',
    bra: 'br',
    aus: 'au',
    can: 'ca',
    mex: 'mx',
    fin: 'fi',
    swe: 'se',
    den: 'dk',
    nor: 'no',
    pol: 'pl',
    bel: 'be',
    sui: 'ch',
    aut: 'at',
    por: 'pt',
    arg: 'ar',
    chn: 'cn',
    ukr: 'ua',
    blr: 'by',
    kaz: 'kz',
  }
  for (const [k, v] of Object.entries(extra)) countryIndex.set(k, v)
  return countryIndex
}

/** flag:<code> from an ISO code, a country name (EN/RU) or a sports code; null if unknown. */
export function parseCountry(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (v.startsWith(FLAG_PREFIX)) return v
  const c = countries()
  if (/^[a-z]{2}$/.test(v)) return FLAG_PREFIX + v
  const code = c.get(v)
  return code ? FLAG_PREFIX + code : null
}

export interface ImportResult {
  rows: LeagueRow[]
  /** Human-readable problems: row number (1-based, as in the file) and what was wrong. */
  problems: { row: number; column: string; value: string }[]
}

/**
 * Turns table cells into league rows. `resolveImage` maps an image cell (a
 * sticker name or file name) to an asset id, or null when it is unknown.
 */
export function rowsFromCells(
  cells: readonly string[][],
  mapping: readonly (string | null)[],
  params: readonly TemplateParam[],
  options: { header: boolean; resolveImage?: (value: string) => string | null },
): ImportResult {
  const byId = new Map(params.map((p) => [p.id, p]))
  const header = options.header ? (cells[0] ?? []) : []
  const body = options.header ? cells.slice(1) : cells
  const problems: ImportResult['problems'] = []
  const rows: LeagueRow[] = []
  body.forEach((line, i) => {
    if (line.every((c) => c.trim() === '')) return
    const values: Record<string, string> = {}
    mapping.forEach((id, col) => {
      const param = id ? byId.get(id) : undefined
      const raw = (line[col] ?? '').trim()
      if (!param || raw === '') return
      let value: string | null = raw
      if (param.kind === 'color') value = parseColour(raw)
      else if (param.kind === 'flag') value = parseCountry(raw)
      else if (param.kind === 'image') value = options.resolveImage?.(raw) ?? null
      if (value === null) {
        problems.push({
          row: i + 1 + (options.header ? 1 : 0),
          column: header[col] ?? `#${col + 1}`,
          value: raw,
        })
      } else values[param.id] = value
    })
    rows.push({ id: newRowId(), values })
  })
  return { rows, problems }
}

/** Skin folder names for the rows: made safe and unique within the batch. */
export function skinFolders(
  rows: readonly LeagueRow[],
  pattern: string,
  display: (row: LeagueRow) => Record<string, string>,
): string[] {
  const used = new Map<string, number>()
  return rows.map((row) => {
    const base = slugifySkinId(fillText(pattern, display(row)))
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    return n === 1 ? base : `${base}_${n}`
  })
}

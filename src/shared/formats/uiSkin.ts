import { asRecord, asString, parseLenientJson } from './json'

/** Contents of skins/<skin>/ui_skin.json. Unknown keys are preserved. */
export interface UiSkin {
  skinname?: string
  drivername?: string
  country?: string
  team?: string
  number?: string
  priority?: number
  [key: string]: unknown
}

const KNOWN_KEYS = ['skinname', 'drivername', 'country', 'team', 'number', 'priority'] as const

export function parseUiSkin(text: string): UiSkin {
  const raw = asRecord(parseLenientJson(text))
  const skin: UiSkin = { ...raw }
  for (const key of ['skinname', 'drivername', 'country', 'team', 'number'] as const) {
    const v = asString(raw[key])
    if (v === undefined) delete skin[key]
    else skin[key] = v
  }
  const priority = Number(raw.priority)
  if (raw.priority === undefined || !Number.isFinite(priority)) delete skin.priority
  else skin.priority = priority
  return skin
}

export function serializeUiSkin(skin: UiSkin): string {
  const ordered: Record<string, unknown> = {}
  for (const key of KNOWN_KEYS) if (skin[key] !== undefined) ordered[key] = skin[key]
  for (const [key, value] of Object.entries(skin)) {
    if (!(key in ordered) && value !== undefined) ordered[key] = value
  }
  return JSON.stringify(ordered, null, 2) + '\n'
}

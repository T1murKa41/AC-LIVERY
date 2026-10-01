// Built-in templates. Every placement is relative to the car body (see
// placement.ts), so the same template lands in the same spots on any car;
// projectors reach deep and the bake keeps only the first surface they meet.

import {
  STANDARD_PARAMS,
  type DraftBindings,
  type LayerBindings,
  type TemplateParam,
} from './params'
import { newFill, type PatternFill, type PatternKind } from './patterns'
import {
  DEFAULT_CSP,
  DEFAULT_PARTS,
  newId,
  type BaseFinish,
  type CspPaint,
  type Design,
  type ImageLayer,
  type Layer,
  type LayerGroup,
  type MirrorMode,
  type PartsPaint,
  type Placement,
  type ShapeKind,
  type ShapeLayer,
  type TextLayer,
} from './types'

/** What a template sets when it is applied. */
export interface TemplateContent {
  baseColor: string
  baseFinish?: BaseFinish
  parts?: PartsPaint
  csp?: CspPaint
  design: Design
  params: TemplateParam[]
  values?: Record<string, string>
  bindings?: DraftBindings
  /** ui_skin.json fields, usually with {placeholders}. */
  meta?: Record<string, string>
}

export interface BuiltinTemplate {
  id: string
  name: { ru: string; en: string }
  description: { ru: string; en: string }
  /** Colours for the gallery card: primary, secondary, accent. */
  swatch: [string, string, string]
  build(): TemplateContent
}

// -- placement helpers -------------------------------------------------------

interface SideOptions {
  /** Along the car: -1 tail .. 1 nose. */
  z: number
  /** Height: -1 sill .. 1 roof. */
  y: number
  w: number
  h: number
  rotation?: number
  mirror?: MirrorMode
}

/** On the left side, projected inwards, copied to the right side. */
function side({ z, y, w, h, rotation = 0, mirror = 'readable' }: SideOptions): Placement {
  return {
    position: [1, y, z],
    direction: [-1, 0, 0],
    rotation,
    width: w,
    height: h,
    depth: 0.8,
    mirror,
  }
}

/** Seen from above; the vinyl's up points to the nose. */
function top(x: number, z: number, w: number, h: number, rotation = 0): Placement {
  return {
    position: [x, 0.2, z],
    direction: [0, -1, 0],
    rotation,
    width: w,
    height: h,
    depth: 1.2,
    mirror: 'none',
  }
}

/** Seen from the front. */
function front(y: number, w: number, h: number): Placement {
  return {
    position: [0, y, 0.6],
    direction: [0, 0, -1],
    rotation: 0,
    width: w,
    height: h,
    depth: 1.2,
    mirror: 'none',
  }
}

function shape(
  kind: ShapeKind,
  placement: Placement,
  bind: string,
  name: string,
  group?: string,
): ShapeLayer {
  return {
    id: newId(),
    name,
    kind: 'shape',
    shape: kind,
    color: '#ffffff',
    visible: true,
    locked: false,
    opacity: 1,
    placement,
    bindings: { color: bind },
    group,
  }
}

function text(
  value: string,
  placement: Placement,
  bind: string,
  name: string,
  group?: string,
  font = 'Bahnschrift',
): TextLayer {
  return {
    id: newId(),
    name,
    kind: 'text',
    text: value,
    font,
    bold: true,
    italic: false,
    color: '#ffffff',
    outlineColor: '#000000',
    outline: 0,
    visible: true,
    locked: false,
    opacity: 1,
    placement,
    bindings: { color: bind },
    group,
  }
}

/** A shape filled with a pattern drawn in the `bind` colour (or a fixed one). */
function pattern(
  placement: Placement,
  fill: Partial<PatternFill> & { pattern: PatternKind },
  bind: string | null,
  name: string,
  opts: { shape?: ShapeKind; color?: string; background?: string; group?: string } = {},
): ShapeLayer {
  const bindings: LayerBindings = {}
  if (bind) bindings.color = bind
  if (opts.background) bindings.background = opts.background
  return {
    id: newId(),
    name,
    kind: 'shape',
    shape: opts.shape ?? 'rect',
    color: opts.color ?? '#ffffff',
    visible: true,
    locked: false,
    opacity: 1,
    placement,
    fill: { ...newFill(fill.pattern), ...fill },
    bindings,
    group: opts.group,
  }
}

/** A layer in a colour of its own, not following any parameter. */
function fixed<L extends ShapeLayer | TextLayer>(layer: L, color: string): L {
  return { ...layer, color, bindings: {} }
}

/** Empty slot for a logo or a flag; hidden until the parameter gets an image. */
function sponsor(placement: Placement, param: string, name: string): ImageLayer {
  return {
    id: newId(),
    name,
    kind: 'image',
    asset: '',
    visible: true,
    locked: false,
    opacity: 1,
    placement,
    bindings: { asset: param },
  }
}

function content(
  layers: Layer[],
  groups: Record<string, LayerGroup> = {},
  extra: Partial<TemplateContent> = {},
): TemplateContent {
  return {
    baseColor: '#d7261e',
    baseFinish: 'stock',
    parts: DEFAULT_PARTS,
    csp: DEFAULT_CSP,
    design: { layers, assets: {}, groups },
    params: STANDARD_PARAMS.map((p) => ({ ...p })),
    bindings: { baseColor: 'primary' },
    meta: { drivername: '{driver}', team: '{team}', number: '{number}', country: '{country}' },
    ...extra,
  }
}

/** Number roundel on both doors: a disc and the number on it. */
function doorNumber(z = 0.1, y = -0.05, size = 0.1) {
  const g = newId('g')
  return {
    group: [g, { name: 'Номер / Number' }] as const,
    layers: [
      shape('circle', side({ z, y, w: size, h: size, mirror: 'flipped' }), 'secondary', 'disc', g),
      text('{number}', side({ z, y, w: size * 0.72, h: size * 0.5 }), 'accent', 'number', g),
    ],
  }
}

// -- templates ---------------------------------------------------------------

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'twin-stripes',
    name: { ru: 'Двойные полосы', en: 'Twin stripes' },
    description: {
      ru: 'Две полосы через всю машину, номер на дверях, имя пилота сзади.',
      en: 'Two stripes over the whole car, door numbers, driver name at the back.',
    },
    swatch: ['#1c5fd4', '#f4f4f2', '#16181b'],
    build() {
      const n = doorNumber()
      return content(
        [
          shape('rect', top(0.13, 0, 0.045, 1.1), 'secondary', 'stripe L'),
          shape('rect', top(-0.13, 0, 0.045, 1.1), 'secondary', 'stripe R'),
          ...n.layers,
          text('{driver}', side({ z: -0.6, y: -0.45, w: 0.14, h: 0.025 }), 'secondary', 'driver'),
          sponsor(side({ z: -0.41, y: -0.45, w: 0.033, h: 0.025 }), 'country', 'flag'),
        ],
        { [n.group[0]]: n.group[1] },
        { values: { primary: '#1c5fd4', secondary: '#f4f4f2', accent: '#16181b' } },
      )
    },
  },
  {
    id: 'diagonal',
    name: { ru: 'Диагональ', en: 'Diagonal' },
    description: {
      ru: 'Корма другого цвета с косым срезом и тонкой акцентной линией.',
      en: 'A differently coloured tail cut at an angle, with a thin accent line.',
    },
    swatch: ['#16181b', '#f2b705', '#d7261e'],
    build() {
      const n = doorNumber(0.35, 0)
      return content(
        [
          shape(
            'rect',
            side({ z: -0.62, y: 0, w: 0.75, h: 0.6, rotation: 18, mirror: 'flipped' }),
            'secondary',
            'tail',
          ),
          shape(
            'rect',
            side({ z: -0.2, y: 0, w: 0.02, h: 0.6, rotation: 18, mirror: 'flipped' }),
            'accent',
            'accent line',
          ),
          shape('rect', top(0, -0.62, 0.5, 0.42), 'secondary', 'tail top'),
          ...n.layers,
        ],
        { [n.group[0]]: n.group[1] },
        { values: { primary: '#16181b', secondary: '#f2b705', accent: '#d7261e' } },
      )
    },
  },
  {
    id: 'endurance',
    name: { ru: 'Эндуранс', en: 'Endurance' },
    description: {
      ru: 'Линия вдоль порогов, белый номерной щит, слоты для трёх спонсоров.',
      en: 'A line along the sills, a white number panel and three sponsor slots.',
    },
    swatch: ['#0a2463', '#f4f4f2', '#f25c05'],
    build() {
      const g = newId('g')
      return content(
        [
          shape(
            'rect',
            side({ z: 0, y: -0.62, w: 1.1, h: 0.035, mirror: 'flipped' }),
            'accent',
            'sill line',
          ),
          shape(
            'roundrect',
            side({ z: 0.12, y: 0, w: 0.12, h: 0.1, mirror: 'flipped' }),
            'secondary',
            'number panel',
            g,
          ),
          text('{number}', side({ z: 0.12, y: 0, w: 0.09, h: 0.07 }), 'primary', 'number', g),
          text('{driver}', side({ z: 0.12, y: -0.3, w: 0.12, h: 0.02 }), 'secondary', 'driver'),
          sponsor(side({ z: 0.28, y: -0.3, w: 0.027, h: 0.02 }), 'country', 'flag'),
          sponsor(top(0, 0.62, 0.18, 0.09), 'sponsor1', 'sponsor 1 (bonnet)'),
          sponsor(side({ z: -0.5, y: 0.05, w: 0.18, h: 0.07 }), 'sponsor2', 'sponsor 2 (side)'),
          sponsor(front(-0.2, 0.2, 0.05), 'sponsor3', 'sponsor 3 (nose)'),
          text('{number}', top(0, -0.1, 0.1, 0.07), 'secondary', 'roof number'),
        ],
        { [g]: { name: 'Номер / Number' } },
        { values: { primary: '#0a2463', secondary: '#f4f4f2', accent: '#f25c05' } },
      )
    },
  },
  {
    id: 'chevrons',
    name: { ru: 'Шевроны', en: 'Chevrons' },
    description: {
      ru: 'Стрелы на капоте и бортах, направленные вперёд.',
      en: 'Arrows on the bonnet and the sides, pointing forwards.',
    },
    swatch: ['#f4f4f2', '#d7261e', '#16181b'],
    build() {
      const n = doorNumber(-0.05, 0.05)
      return content(
        [
          // seen from above the vinyl's right is the car's right: a quarter turn points at the nose
          shape('chevron', top(0, 0.55, 0.28, 0.18, 90), 'secondary', 'bonnet chevron'),
          shape('chevron', top(0, 0.3, 0.2, 0.13, 90), 'accent', 'bonnet chevron 2'),
          // on the left side the vinyl's right is the tail: turn to point at the nose
          shape(
            'chevron',
            side({ z: 0.45, y: -0.2, w: 0.2, h: 0.14, rotation: 180, mirror: 'flipped' }),
            'secondary',
            'side chevron',
          ),
          shape(
            'chevron',
            side({ z: 0.3, y: -0.2, w: 0.14, h: 0.1, rotation: 180, mirror: 'flipped' }),
            'accent',
            'side chevron 2',
          ),
          ...n.layers,
        ],
        { [n.group[0]]: n.group[1] },
        { values: { primary: '#f4f4f2', secondary: '#d7261e', accent: '#16181b' } },
      )
    },
  },
  {
    id: 'minimal',
    name: { ru: 'Минимализм', en: 'Minimal' },
    description: {
      ru: 'Один цвет, крупный номер на дверях и капоте, команда на корме.',
      en: 'One colour, big numbers on the doors and bonnet, team name on the tail.',
    },
    swatch: ['#2e9e44', '#f4f4f2', '#16181b'],
    build() {
      return content(
        [
          text(
            '{number}',
            side({ z: 0.1, y: -0.05, w: 0.12, h: 0.12 }),
            'secondary',
            'door number',
          ),
          text('{number}', top(0, 0.55, 0.12, 0.1), 'secondary', 'bonnet number'),
          text('{team}', side({ z: -0.62, y: 0.05, w: 0.16, h: 0.03 }), 'accent', 'team'),
          sponsor(side({ z: 0.62, y: -0.25, w: 0.12, h: 0.05 }), 'sponsor1', 'sponsor 1'),
        ],
        {},
        { values: { primary: '#2e9e44', secondary: '#f4f4f2', accent: '#16181b' } },
      )
    },
  },
  {
    id: 'checkered',
    name: { ru: 'Финишный флаг', en: 'Chequered flag' },
    description: {
      ru: 'Шашки на корме, тающие к носу, и клетчатая крышка багажника.',
      en: 'Checks on the tail that melt away towards the nose, and a chequered boot lid.',
    },
    swatch: ['#f4f4f2', '#d7261e', '#16181b'],
    build() {
      const n = doorNumber(0.32, -0.05)
      return content(
        [
          pattern(
            side({ z: -0.5, y: -0.1, w: 1, h: 0.45, mirror: 'flipped' }),
            { pattern: 'checker', size: 0.14, fade: -0.9 },
            'accent',
            'checks (sides)',
          ),
          // a quarter turn: the vinyl's right points at the nose
          pattern(
            top(0, -0.72, 0.34, 0.6, 90),
            { pattern: 'checker', size: 0.2, fade: 1 },
            'accent',
            'checks (boot)',
          ),
          ...n.layers,
          text('{driver}', side({ z: 0.32, y: -0.5, w: 0.14, h: 0.022 }), 'accent', 'driver'),
        ],
        { [n.group[0]]: n.group[1] },
        { values: { primary: '#f4f4f2', secondary: '#d7261e', accent: '#16181b' } },
      )
    },
  },
  {
    id: 'camo',
    name: { ru: 'Тестовый камуфляж', en: 'Test camo' },
    description: {
      ru: 'Камуфляж прототипа на тестах по всему кузову и жёлтая табличка с номером.',
      en: 'Prototype test camouflage all over the body and a yellow number plate.',
    },
    swatch: ['#e9e9e4', '#16181b', '#f2b705'],
    build() {
      const g = newId('g')
      return content(
        [
          pattern(
            side({ z: 0, y: 0, w: 1.4, h: 0.6, mirror: 'flipped' }),
            { pattern: 'camo', size: 0.22, transparent: true },
            'secondary',
            'camo (sides)',
          ),
          pattern(
            top(0, 0, 0.8, 1.4),
            { pattern: 'camo', size: 0.18, transparent: true, seed: 2 },
            'secondary',
            'camo (top)',
          ),
          pattern(
            front(0, 1, 0.6),
            { pattern: 'camo', size: 0.25, transparent: true, seed: 3 },
            'secondary',
            'camo (front)',
          ),
          shape(
            'roundrect',
            side({ z: 0.12, y: -0.05, w: 0.1, h: 0.065, mirror: 'flipped' }),
            'accent',
            'plate',
            g,
          ),
          fixed(
            text('{number}', side({ z: 0.12, y: -0.05, w: 0.075, h: 0.05 }), 'accent', 'number', g),
            '#16181b',
          ),
        ],
        { [g]: { name: 'Номер / Number' } },
        { values: { primary: '#e9e9e4', secondary: '#16181b', accent: '#f2b705' } },
      )
    },
  },
  {
    id: 'honeycomb',
    name: { ru: 'Соты', en: 'Honeycomb' },
    description: {
      ru: 'Шестиугольники на передних крыльях и капоте растворяются к корме.',
      en: 'Hexagons on the front wings and bonnet dissolve towards the tail.',
    },
    swatch: ['#16181b', '#f2b705', '#f4f4f2'],
    build() {
      const n = doorNumber(-0.2, 0)
      return content(
        [
          pattern(
            side({ z: 0.38, y: -0.05, w: 0.75, h: 0.45, mirror: 'flipped' }),
            { pattern: 'hex', size: 0.12, weight: 0.88, fade: 1 },
            'secondary',
            'hexagons (sides)',
          ),
          pattern(
            top(0, 0.55, 0.45, 0.6, 90),
            { pattern: 'hex', size: 0.12, weight: 0.88, fade: -1 },
            'secondary',
            'hexagons (bonnet)',
          ),
          shape(
            'rect',
            side({ z: 0, y: -0.62, w: 1.2, h: 0.012, mirror: 'flipped' }),
            'secondary',
            'sill line',
          ),
          ...n.layers,
        ],
        { [n.group[0]]: n.group[1] },
        { values: { primary: '#16181b', secondary: '#f2b705', accent: '#f4f4f2' } },
      )
    },
  },
  {
    id: 'halftone',
    name: { ru: 'Полутон', en: 'Halftone' },
    description: {
      ru: 'Растр точек поднимается от порогов и тает к линии окон.',
      en: 'A dot screen rises from the sills and melts away below the windows.',
    },
    swatch: ['#0a2463', '#1c5fd4', '#f4f4f2'],
    build() {
      return content(
        [
          // turned a quarter: the vinyl's right points up, so the dots fade upwards
          pattern(
            side({ z: 0, y: -0.45, w: 0.16, h: 1.4, rotation: 90, mirror: 'flipped' }),
            { pattern: 'dots', size: 0.12, weight: 1, fade: 1 },
            'secondary',
            'halftone (sides)',
          ),
          pattern(
            top(0, 0.55, 0.45, 0.6, 90),
            { pattern: 'dots', size: 0.08, weight: 1, fade: -1 },
            'secondary',
            'halftone (bonnet)',
          ),
          text('{number}', side({ z: 0.12, y: 0, w: 0.13, h: 0.1 }), 'accent', 'number'),
          text('{number}', top(0, -0.1, 0.1, 0.07), 'accent', 'roof number'),
          text('{driver}', side({ z: -0.55, y: 0.05, w: 0.13, h: 0.022 }), 'accent', 'driver'),
          sponsor(side({ z: -0.37, y: 0.05, w: 0.027, h: 0.02 }), 'country', 'flag'),
        ],
        {},
        { values: { primary: '#0a2463', secondary: '#1c5fd4', accent: '#f4f4f2' } },
      )
    },
  },
  {
    id: 'retro',
    name: { ru: 'Ретро', en: 'Retro' },
    description: {
      ru: 'Широкая полоса через капот, крышу и багажник, кант и белый номерной круг.',
      en: 'A wide stripe over bonnet, roof and boot, pinstripes and a white number roundel.',
    },
    swatch: ['#1b4d3e', '#f2e3c6', '#c9a227'],
    build() {
      const g = newId('g')
      const disc = side({ z: 0.15, y: -0.1, w: 0.13, h: 0.13, mirror: 'flipped' })
      return content(
        [
          shape('rect', top(0, 0, 0.3, 1.4), 'secondary', 'centre stripe'),
          shape('rect', top(0.21, 0, 0.022, 1.4), 'accent', 'pinstripe L'),
          shape('rect', top(-0.21, 0, 0.022, 1.4), 'accent', 'pinstripe R'),
          shape(
            'rect',
            side({ z: 0, y: -0.1, w: 1.4, h: 0.06, mirror: 'flipped' }),
            'secondary',
            'side band',
          ),
          // an accent rim behind the white disc
          shape('circle', { ...disc, width: 0.145, height: 0.145 }, 'accent', 'roundel rim', g),
          fixed(shape('circle', disc, 'secondary', 'roundel', g), '#ffffff'),
          fixed(
            text(
              '{number}',
              side({ z: 0.15, y: -0.1, w: 0.085, h: 0.07 }),
              'accent',
              'number',
              g,
              'Arial Black',
            ),
            '#16181b',
          ),
          text('{driver}', side({ z: -0.55, y: 0.1, w: 0.13, h: 0.022 }), 'secondary', 'driver'),
        ],
        { [g]: { name: 'Номер / Number' } },
        { values: { primary: '#1b4d3e', secondary: '#f2e3c6', accent: '#c9a227' } },
      )
    },
  },
  {
    id: 'lightning',
    name: { ru: 'Молния', en: 'Lightning' },
    description: {
      ru: 'Две ломаные линии вдоль бортов, номер на передней двери.',
      en: 'Two zigzag lines along the sides, the number on the front door.',
    },
    swatch: ['#16181b', '#f2b705', '#f25c05'],
    build() {
      const n = doorNumber(0.3, 0.12, 0.09)
      return content(
        [
          pattern(
            side({ z: -0.05, y: -0.38, w: 1.4, h: 0.1, mirror: 'flipped' }),
            { pattern: 'zigzag', size: 1, weight: 0.32 },
            'secondary',
            'lightning',
          ),
          pattern(
            side({ z: -0.05, y: -0.6, w: 1.4, h: 0.1, mirror: 'flipped' }),
            { pattern: 'zigzag', size: 1, weight: 0.12 },
            'accent',
            'lightning 2',
          ),
          ...n.layers,
        ],
        { [n.group[0]]: n.group[1] },
        { values: { primary: '#16181b', secondary: '#f2b705', accent: '#f25c05' } },
      )
    },
  },
  {
    id: 'speed',
    name: { ru: 'Скорость', en: 'Speed' },
    description: {
      ru: 'Скоростные линии от носа тают к корме, номер и имя сзади.',
      en: 'Speed lines from the nose fade out towards the tail; number and name at the back.',
    },
    swatch: ['#f4f4f2', '#1c5fd4', '#16181b'],
    build() {
      return content(
        [
          pattern(
            side({ z: 0.3, y: -0.3, w: 0.9, h: 0.3, mirror: 'flipped' }),
            { pattern: 'speed', size: 0.12, weight: 0.45, fade: 1 },
            'secondary',
            'speed lines',
          ),
          pattern(
            top(0, 0.5, 0.5, 0.5, 90),
            { pattern: 'speed', size: 0.1, weight: 0.45, fade: -1, angle: 180, seed: 4 },
            'secondary',
            'speed lines (bonnet)',
          ),
          text('{number}', side({ z: -0.42, y: 0, w: 0.13, h: 0.1 }), 'accent', 'number'),
          text('{driver}', side({ z: -0.42, y: -0.42, w: 0.13, h: 0.022 }), 'secondary', 'driver'),
          sponsor(side({ z: 0.1, y: 0.05, w: 0.16, h: 0.06 }), 'sponsor1', 'sponsor 1'),
        ],
        {},
        { values: { primary: '#f4f4f2', secondary: '#1c5fd4', accent: '#16181b' } },
      )
    },
  },
  {
    id: 'carbon',
    name: { ru: 'Карбон', en: 'Carbon' },
    description: {
      ru: 'Карбоновые пороги, капот и крыша, красный кант по линии стыка.',
      en: 'Carbon sills, bonnet and roof, with a red pinstripe along the split.',
    },
    swatch: ['#9aa0a6', '#16181b', '#d7261e'],
    build() {
      const n = doorNumber(0.1, 0)
      const carbon = { pattern: 'carbon', size: 0.06 } as const
      return content(
        [
          pattern(
            side({ z: 0, y: -0.75, w: 1.4, h: 0.1, mirror: 'flipped' }),
            carbon,
            null,
            'carbon sills',
            { color: '#5a5e66' },
          ),
          shape(
            'rect',
            side({ z: 0, y: -0.53, w: 1.4, h: 0.008, mirror: 'flipped' }),
            'accent',
            'split line',
          ),
          pattern(top(0, 0.58, 0.42, 0.42), { ...carbon, size: 0.025 }, null, 'carbon bonnet', {
            color: '#5a5e66',
          }),
          pattern(top(0, -0.08, 0.4, 0.4), { ...carbon, size: 0.025 }, null, 'carbon roof', {
            color: '#5a5e66',
          }),
          ...n.layers,
        ],
        { [n.group[0]]: n.group[1] },
        { values: { primary: '#9aa0a6', secondary: '#16181b', accent: '#d7261e' } },
      )
    },
  },
  {
    id: 'tiger',
    name: { ru: 'Тигр', en: 'Tiger' },
    description: {
      ru: 'Тигровые полосы на корме и капоте, крупный номер спереди.',
      en: 'Tiger stripes on the tail and bonnet, a big number at the front.',
    },
    swatch: ['#f25c05', '#16181b', '#f4f4f2'],
    build() {
      return content(
        [
          pattern(
            side({ z: -0.32, y: 0, w: 0.9, h: 0.6, mirror: 'flipped' }),
            { pattern: 'tiger', size: 0.2, weight: 0.45, angle: -20, fade: -0.9 },
            'secondary',
            'tiger (sides)',
          ),
          pattern(
            top(0, 0.5, 0.45, 0.7, 90),
            { pattern: 'tiger', size: 0.22, weight: 0.4, seed: 5 },
            'secondary',
            'tiger (bonnet)',
          ),
          text('{number}', side({ z: 0.45, y: -0.1, w: 0.12, h: 0.1 }), 'accent', 'number'),
          text('{team}', side({ z: 0.45, y: -0.5, w: 0.13, h: 0.022 }), 'accent', 'team'),
        ],
        {},
        { values: { primary: '#f25c05', secondary: '#16181b', accent: '#f4f4f2' } },
      )
    },
  },
  {
    id: 'splatter',
    name: { ru: 'Брызги', en: 'Splatter' },
    description: {
      ru: 'Брызги краски по корме и крыше, номер на передней двери.',
      en: 'Paint splatter over the tail and roof, the number on the front door.',
    },
    swatch: ['#16181b', '#e84393', '#f4f4f2'],
    build() {
      const n = doorNumber(0.35, 0)
      return content(
        [
          pattern(
            side({ z: -0.4, y: 0, w: 0.9, h: 0.6, mirror: 'flipped' }),
            { pattern: 'splatter', size: 0.3, weight: 1, fade: -0.5 },
            'secondary',
            'splatter (sides)',
          ),
          pattern(
            top(0, -0.45, 0.6, 0.7),
            { pattern: 'splatter', size: 0.35, weight: 0.8, seed: 3 },
            'secondary',
            'splatter (top)',
          ),
          ...n.layers,
        ],
        { [n.group[0]]: n.group[1] },
        { values: { primary: '#16181b', secondary: '#e84393', accent: '#f4f4f2' } },
      )
    },
  },
  {
    id: 'pixels',
    name: { ru: 'Пиксели', en: 'Pixels' },
    description: {
      ru: 'Пиксельное растворение от кормы к носу на бортах и крыше.',
      en: 'A pixel dissolve from the tail towards the nose on the sides and roof.',
    },
    swatch: ['#16181b', '#2e9e44', '#f4f4f2'],
    build() {
      return content(
        [
          pattern(
            side({ z: -0.35, y: -0.1, w: 0.9, h: 0.5, mirror: 'flipped' }),
            { pattern: 'pixels', size: 0.08, weight: 0.95, fade: -1 },
            'secondary',
            'pixels (sides)',
          ),
          pattern(
            top(0, -0.4, 0.7, 0.6, 90),
            { pattern: 'pixels', size: 0.06, weight: 0.95, fade: 1, seed: 2 },
            'secondary',
            'pixels (top)',
          ),
          text('{number}', side({ z: 0.4, y: -0.05, w: 0.12, h: 0.1 }), 'accent', 'number'),
          text('{driver}', side({ z: 0.4, y: -0.45, w: 0.13, h: 0.022 }), 'accent', 'driver'),
          sponsor(side({ z: 0.58, y: -0.45, w: 0.027, h: 0.02 }), 'country', 'flag'),
        ],
        {},
        { values: { primary: '#16181b', secondary: '#2e9e44', accent: '#f4f4f2' } },
      )
    },
  },
  {
    id: 'gradient',
    name: { ru: 'Градиент', en: 'Gradient' },
    description: {
      ru: 'Плавный переход второго цвета от кормы к носу по бортам и сверху.',
      en: 'The second colour blends in smoothly from the tail towards the nose, on the sides and on top.',
    },
    swatch: ['#6a2c91', '#e84393', '#f4f4f2'],
    build() {
      const n = doorNumber(0.3, 0)
      return content(
        [
          // the gradient runs from its left edge: half a turn puts the colour at the tail
          pattern(
            side({ z: -0.2, y: 0, w: 1.3, h: 0.6, mirror: 'flipped' }),
            { pattern: 'gradient', weight: 0.8, angle: 180 },
            'secondary',
            'gradient (sides)',
          ),
          pattern(
            top(0, -0.2, 1.3, 0.9, 90),
            { pattern: 'gradient', weight: 0.8 },
            'secondary',
            'gradient (top)',
          ),
          ...n.layers,
          text('{team}', side({ z: -0.6, y: 0.05, w: 0.14, h: 0.025 }), 'accent', 'team'),
        ],
        { [n.group[0]]: n.group[1] },
        { values: { primary: '#6a2c91', secondary: '#e84393', accent: '#f4f4f2' } },
      )
    },
  },
  {
    id: 'ribbons',
    name: { ru: 'Ленты', en: 'Ribbons' },
    description: {
      ru: 'Три ленты разной ширины вдоль всей машины, номер над ними.',
      en: 'Three ribbons of different widths along the whole car, the number above them.',
    },
    swatch: ['#f4f4f2', '#0a2463', '#d7261e'],
    build() {
      const long = (y: number, h: number) => side({ z: 0, y, w: 1.4, h, mirror: 'flipped' })
      return content(
        [
          shape('rect', long(-0.1, 0.03), 'secondary', 'ribbon 1'),
          shape('rect', long(-0.35, 0.015), 'accent', 'ribbon 2'),
          shape('rect', long(-0.6, 0.03), 'secondary', 'ribbon 3'),
          shape('rect', top(0.09, 0, 0.03, 1.4), 'secondary', 'top ribbon L'),
          shape('rect', top(0, 0, 0.015, 1.4), 'accent', 'top ribbon'),
          shape('rect', top(-0.09, 0, 0.03, 1.4), 'secondary', 'top ribbon R'),
          text('{number}', side({ z: 0.12, y: 0.12, w: 0.11, h: 0.08 }), 'secondary', 'number'),
          text('{driver}', side({ z: -0.55, y: 0.12, w: 0.13, h: 0.022 }), 'secondary', 'driver'),
        ],
        {},
        { values: { primary: '#f4f4f2', secondary: '#0a2463', accent: '#d7261e' } },
      )
    },
  },
]

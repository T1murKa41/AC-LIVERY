// Built-in templates. Every placement is relative to the car body (see
// placement.ts), so the same template lands in the same spots on any car;
// projectors reach deep and the bake keeps only the first surface they meet.

import { STANDARD_PARAMS, type DraftBindings, type TemplateParam } from './params'
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

/** Empty slot for a sponsor logo; hidden until the parameter gets an image. */
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
    meta: { drivername: '{driver}', team: '{team}', number: '{number}' },
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
]

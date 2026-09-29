// Built-in sponsor stickers. The brands are made up: real logos are
// trademarks and cannot ship with an open-source program, so users add
// theirs to the personal library instead.

export interface Sticker {
  /** `builtin:<name>` for these, the library id for the user's own. */
  id: string
  name: string
  mime: string
  /** data: URL */
  data: string
}

const FONT = `'Arial Black', 'Bahnschrift', Impact, sans-serif`
const FONT_WIDE = `Bahnschrift, 'Arial Black', Arial, sans-serif`

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
}

function text(
  x: number,
  y: number,
  size: number,
  fill: string,
  value: string,
  opts: { anchor?: string; italic?: boolean; font?: string; spacing?: number } = {},
): string {
  return `<text x="${x}" y="${y}" font-family="${opts.font ?? FONT}" font-size="${size}" font-weight="900"${
    opts.italic ? ' font-style="italic"' : ''
  } fill="${fill}" text-anchor="${opts.anchor ?? 'middle'}"${
    opts.spacing ? ` letter-spacing="${opts.spacing}"` : ''
  }>${value}</text>`
}

const DESIGNS: { name: string; svg: string }[] = [
  {
    name: 'Apex Tyres',
    svg: svg(
      600,
      150,
      `<rect width="600" height="150" rx="22" fill="#111"/>` +
        text(300, 104, 84, '#ffd400', 'APEX', { italic: true }) +
        text(520, 132, 26, '#fff', 'TYRES', { italic: true }),
    ),
  },
  {
    name: 'Nitro X',
    svg: svg(
      560,
      160,
      `<polygon points="40,0 560,0 520,160 0,160" fill="#e10600"/>` +
        text(250, 118, 96, '#fff', 'NITRO', { italic: true }) +
        text(480, 124, 110, '#111', 'X', { italic: true }),
    ),
  },
  {
    name: 'Velocity',
    svg: svg(
      640,
      140,
      `<g fill="#1c5fd4"><rect x="0" y="30" width="140" height="10"/><rect x="20" y="62" width="120" height="10"/><rect x="40" y="94" width="100" height="10"/></g>` +
        text(390, 106, 88, '#1c5fd4', 'VELOCITY', { italic: true }),
    ),
  },
  {
    name: 'Redline Oil',
    svg: svg(
      420,
      420,
      `<circle cx="210" cy="210" r="200" fill="#fff" stroke="#c8102e" stroke-width="24"/>` +
        `<path d="M70 250 Q210 120 350 250" fill="none" stroke="#c8102e" stroke-width="22"/>` +
        text(210, 200, 78, '#c8102e', 'REDLINE') +
        text(210, 320, 64, '#111', 'OIL'),
    ),
  },
  {
    name: 'Torque',
    svg: svg(
      520,
      140,
      `<rect width="520" height="140" fill="#1a1a1a"/><rect y="118" width="520" height="22" fill="#ff6a00"/>` +
        text(260, 100, 92, '#ff6a00', 'TORQUE', { font: FONT_WIDE, spacing: 6 }),
    ),
  },
  {
    name: 'Carbon Labs',
    svg: svg(
      620,
      170,
      `<polygon points="85,5 160,45 160,125 85,165 10,125 10,45" fill="#2b2b2b" stroke="#9aa0a6" stroke-width="8"/>` +
        text(85, 112, 64, '#9aa0a6', 'C') +
        text(390, 80, 62, '#2b2b2b', 'CARBON', { font: FONT_WIDE }) +
        text(390, 150, 56, '#6b7280', 'LABS', { font: FONT_WIDE, spacing: 16 }),
    ),
  },
  {
    name: 'Pitlane Energy',
    svg: svg(
      640,
      170,
      `<polygon points="70,5 20,95 65,95 40,165 125,60 80,60 110,5" fill="#39d353"/>` +
        text(390, 86, 66, '#111', 'PITLANE', { italic: true }) +
        text(390, 150, 50, '#39d353', 'ENERGY', { italic: true, spacing: 8 }),
    ),
  },
  {
    name: 'Kinetic',
    svg: svg(
      600,
      130,
      `<defs><linearGradient id="k" x1="0" x2="1"><stop offset="0" stop-color="#6a2c91"/><stop offset="1" stop-color="#e84393"/></linearGradient></defs>` +
        `<rect width="600" height="130" rx="65" fill="url(#k)"/>` +
        text(300, 92, 76, '#fff', 'KINETIC', { font: FONT_WIDE, spacing: 10 }),
    ),
  },
  {
    name: 'Grip Pro',
    svg: svg(
      560,
      160,
      `<g fill="#111">${Array.from({ length: 8 }, (_, i) => `<polygon points="${i * 22},0 ${i * 22 + 14},0 ${i * 22 + 4},160 ${i * 22 - 10},160"/>`).join('')}</g>` +
        text(370, 115, 92, '#111', 'GRIP', { italic: true }) +
        text(520, 150, 40, '#e10600', 'PRO', { italic: true }),
    ),
  },
  {
    name: 'Turbo Fuel',
    svg: svg(
      600,
      160,
      `<path d="M40 150 C0 90 60 60 50 0 C110 40 130 90 100 150 Z" fill="#ff8a00"/><path d="M60 150 C40 115 75 95 72 60 C100 90 105 120 90 150 Z" fill="#ffd400"/>` +
        text(360, 100, 80, '#111', 'TURBO', { italic: true }) +
        text(360, 150, 44, '#ff8a00', 'FUEL', { italic: true, spacing: 20 }),
    ),
  },
  {
    name: 'Slipstream',
    svg: svg(
      680,
      140,
      `<path d="M0 90 L200 30 L680 30 L680 50 L220 50 L40 100 Z" fill="#0b6e4f"/>` +
        text(420, 120, 72, '#0b6e4f', 'SLIPSTREAM', { italic: true }),
    ),
  },
  {
    name: 'Circuit',
    svg: svg(
      560,
      150,
      `<g>${Array.from({ length: 12 }, (_, i) => `<rect x="${(i % 4) * 30 + 10}" y="${Math.floor(i / 4) * 40 + 15}" width="30" height="40" fill="${(i + Math.floor(i / 4)) % 2 ? '#fff' : '#111'}"/>`).join('')}</g>` +
        `<rect x="10" y="15" width="120" height="120" fill="none" stroke="#111" stroke-width="4"/>` +
        text(350, 105, 80, '#111', 'CIRCUIT', { font: FONT_WIDE }),
    ),
  },
  {
    name: 'Boost',
    svg: svg(
      520,
      150,
      `<g fill="#f2b705"><polygon points="0,0 40,0 90,75 40,150 0,150 50,75"/><polygon points="60,0 100,0 150,75 100,150 60,150 110,75"/></g>` +
        text(340, 110, 96, '#111', 'BOOST', { italic: true }),
    ),
  },
  {
    name: 'Helix Racing',
    svg: svg(
      620,
      160,
      `<g fill="#1c5fd4">${Array.from({ length: 9 }, (_, i) => `<circle cx="${20 + i * 14}" cy="${80 + Math.sin(i * 0.9) * 50}" r="${6 + (i % 3) * 3}"/>`).join('')}</g>` +
        text(400, 88, 72, '#111', 'HELIX', { font: FONT_WIDE, spacing: 12 }) +
        text(400, 146, 40, '#1c5fd4', 'RACING', { font: FONT_WIDE, spacing: 18 }),
    ),
  },
  {
    name: 'Forge Brakes',
    svg: svg(
      640,
      170,
      `<circle cx="85" cy="85" r="75" fill="#333"/><circle cx="85" cy="85" r="30" fill="#fff"/>` +
        `<g fill="#fff">${Array.from({ length: 8 }, (_, i) => `<circle cx="${85 + Math.cos((i * Math.PI) / 4) * 52}" cy="${85 + Math.sin((i * Math.PI) / 4) * 52}" r="7"/>`).join('')}</g>` +
        `<rect x="95" y="20" width="40" height="70" rx="8" fill="#e10600"/>` +
        text(400, 90, 70, '#111', 'FORGE') +
        text(400, 152, 46, '#e10600', 'BRAKES', { spacing: 10 }),
    ),
  },
  {
    name: 'Zenith Watches',
    svg: svg(
      600,
      200,
      `<polygon points="300,10 330,70 390,40 370,100 230,100 210,40 270,70" fill="#c9a227"/>` +
        text(300, 160, 64, '#111', 'ZENITH', {
          font: `Georgia, 'Times New Roman', serif`,
          spacing: 14,
        }) +
        text(300, 194, 26, '#6b7280', 'SWISS WATCHES', { font: FONT_WIDE, spacing: 8 }),
    ),
  },
]

export const BUILTIN_STICKERS: Sticker[] = DESIGNS.map((d) => ({
  id: `builtin:${d.name.toLowerCase().replace(/\s+/g, '-')}`,
  name: d.name,
  mime: 'image/svg+xml',
  data: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`,
}))

/** Asset id a sticker gets inside a design (the same sticker is added once). */
export function stickerAssetId(sticker: Pick<Sticker, 'id'>): string {
  return `st_${sticker.id.replace(/[^a-z0-9_-]/gi, '_')}`
}

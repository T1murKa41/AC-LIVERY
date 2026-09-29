// The user's sticker library: logo files in the app's data folder plus an
// index with their names.

import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { StickerFile } from '@shared/api'
import { writeAtomic } from './projects'

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}
const MAX_STICKER = 10 * 1024 * 1024
const ID_RE = /^s[a-z0-9]{1,40}$/

interface Entry {
  id: string
  name: string
  mime: string
  file: string
}

export class StickerStore {
  private counter = 0

  constructor(private readonly dir: string) {}

  private get indexFile(): string {
    return join(this.dir, 'index.json')
  }

  private async index(): Promise<Entry[]> {
    try {
      const raw = JSON.parse(await readFile(this.indexFile, 'utf8')) as unknown
      return Array.isArray(raw)
        ? raw.filter(
            (e): e is Entry =>
              !!e &&
              typeof e === 'object' &&
              ID_RE.test((e as Entry).id) &&
              !!MIME_EXT[(e as Entry).mime],
          )
        : []
    } catch {
      return []
    }
  }

  async list(): Promise<StickerFile[]> {
    const out: StickerFile[] = []
    for (const e of await this.index()) {
      try {
        const data = new Uint8Array(await readFile(join(this.dir, `${e.id}.${MIME_EXT[e.mime]}`)))
        out.push({ id: e.id, name: e.name, mime: e.mime, data })
      } catch {
        // file removed by hand: skip it
      }
    }
    return out
  }

  async add(name: string, mime: string, data: Uint8Array): Promise<StickerFile> {
    const ext = MIME_EXT[mime]
    if (!ext) throw new Error(`Unsupported image type ${mime}`)
    if (data.byteLength > MAX_STICKER) throw new Error(`${name} is too large`)
    await mkdir(this.dir, { recursive: true })
    const id = `s${Date.now().toString(36)}${(this.counter++).toString(36)}`
    await writeAtomic(join(this.dir, `${id}.${ext}`), data)
    const entry: Entry = { id, name: name.slice(0, 120) || id, mime, file: `${id}.${ext}` }
    await writeAtomic(this.indexFile, JSON.stringify([...(await this.index()), entry], null, 2))
    return { id, name: entry.name, mime, data }
  }

  async remove(id: string): Promise<void> {
    if (!ID_RE.test(id)) throw new Error(`Invalid sticker id "${id}"`)
    const entries = await this.index()
    const entry = entries.find((e) => e.id === id)
    if (!entry) return
    await writeAtomic(
      this.indexFile,
      JSON.stringify(
        entries.filter((e) => e.id !== id),
        null,
        2,
      ),
    )
    await rm(join(this.dir, `${id}.${MIME_EXT[entry.mime]}`), { force: true })
  }
}

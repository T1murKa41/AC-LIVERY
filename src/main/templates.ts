// User templates: .aclivery files in the app's data folder, one per template.

import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { TemplateInfo } from '@shared/api'
import { PROJECT_EXTENSION, peekTemplate } from '@shared/design/project'
import { readProjectFile, writeAtomic } from './projects'

const ID_RE = /^[a-z0-9_-]{1,80}$/i

export class TemplateStore {
  private counter = 0

  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`Invalid template id "${id}"`)
    return join(this.dir, `${id}.${PROJECT_EXTENSION}`)
  }

  async list(): Promise<TemplateInfo[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return []
    }
    const out: TemplateInfo[] = []
    for (const name of names) {
      const id = name.slice(0, -(PROJECT_EXTENSION.length + 1))
      if (!name.endsWith(`.${PROJECT_EXTENSION}`) || !ID_RE.test(id)) continue
      try {
        const path = join(this.dir, name)
        const peek = peekTemplate(await readProjectFile(path))
        if (!peek) continue
        const info = await stat(path)
        out.push({ id, name: peek.name ?? id, savedAt: info.mtimeMs, preview: peek.preview })
      } catch {
        // unreadable file: skip it
      }
    }
    return out.sort((a, b) => b.savedAt - a.savedAt)
  }

  async read(id: string): Promise<Uint8Array> {
    return readProjectFile(this.file(id))
  }

  async save(bytes: Uint8Array): Promise<TemplateInfo> {
    const peek = peekTemplate(bytes)
    if (!peek) throw new Error('Not an AC Livery project')
    await mkdir(this.dir, { recursive: true })
    const id = `t${Date.now().toString(36)}${(this.counter++).toString(36)}`
    await writeAtomic(this.file(id), bytes)
    return { id, name: peek.name ?? id, savedAt: Date.now(), preview: peek.preview }
  }

  async remove(id: string): Promise<void> {
    await rm(this.file(id), { force: true })
  }
}

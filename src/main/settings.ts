import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppSettings, Language } from '@shared/api'

export class SettingsStore {
  private cache: AppSettings | null = null

  constructor(
    private readonly file: string,
    private readonly defaultLanguage: Language,
  ) {}

  async get(): Promise<AppSettings> {
    if (this.cache) return this.cache
    let stored: Partial<AppSettings> = {}
    try {
      stored = JSON.parse(await readFile(this.file, 'utf8')) as Partial<AppSettings>
    } catch {
      // first run or unreadable file: fall back to defaults
    }
    this.cache = {
      acRoot: typeof stored.acRoot === 'string' ? stored.acRoot : null,
      language:
        stored.language === 'en' || stored.language === 'ru'
          ? stored.language
          : this.defaultLanguage,
    }
    return this.cache
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...(await this.get()), ...patch }
    this.cache = next
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(next, null, 2))
    return next
  }
}

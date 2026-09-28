// Project files (.aclivery) and the autosave slot.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { PROJECT_EXTENSION } from '@shared/design/project'

/** Largest project file we agree to open (images are embedded). */
const MAX_PROJECT_BYTES = 512 * 1024 * 1024

/**
 * Paths the user picked in a file dialog this session. The renderer may only
 * write projects there, so it cannot write anywhere else on disk.
 */
export class ProjectPaths {
  private readonly allowed = new Set<string>()

  allow(path: string): string {
    const abs = resolve(path)
    this.allowed.add(abs.toLowerCase())
    return abs
  }

  isAllowed(path: string): boolean {
    return this.allowed.has(resolve(path).toLowerCase())
  }
}

export function withProjectExtension(path: string): string {
  return extname(path).toLowerCase() === `.${PROJECT_EXTENSION}`
    ? path
    : `${path}.${PROJECT_EXTENSION}`
}

/** Writes through a temporary file so a crash never leaves half a project. */
export async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

export async function readProjectFile(path: string): Promise<Uint8Array> {
  const data = await readFile(path)
  if (data.byteLength > MAX_PROJECT_BYTES) throw new Error(`${basename(path)} is too large`)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

export async function readAutosave(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

export async function writeAutosave(file: string, data: string | null): Promise<void> {
  if (data === null) await rm(file, { force: true })
  else await writeAtomic(file, data)
}

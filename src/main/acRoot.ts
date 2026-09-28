// Locating the Assetto Corsa installation.

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parseVdf, steamLibraryPaths } from '@shared/formats/vdf'

const run = promisify(execFile)
const AC_APP_ID = '244210'

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** A folder is an AC root if it has content/cars. */
export async function isAcRoot(path: string): Promise<boolean> {
  return isDir(join(path, 'content', 'cars'))
}

export function parseRegValue(output: string, name: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const m = new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, 'i').exec(line)
    if (m) return m[1]!
  }
  return null
}

async function regQuery(key: string, name: string): Promise<string | null> {
  try {
    const { stdout } = await run('reg', ['query', key, '/v', name], { windowsHide: true })
    return parseRegValue(stdout, name)
  } catch {
    return null
  }
}

async function libraryFolders(steamPath: string): Promise<string[]> {
  const libs = [steamPath]
  for (const file of [
    join(steamPath, 'steamapps', 'libraryfolders.vdf'),
    join(steamPath, 'config', 'libraryfolders.vdf'),
  ]) {
    try {
      libs.push(...steamLibraryPaths(parseVdf(await readFile(file, 'utf8'))))
    } catch {
      // missing file is fine
    }
  }
  return [...new Set(libs.map((p) => p.replace(/\//g, '\\')))]
}

/** Candidate AC roots in priority order (Windows only). */
export async function candidateRoots(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const out: string[] = []
  const direct = await regQuery(
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App ${AC_APP_ID}`,
    'InstallLocation',
  )
  if (direct) out.push(direct)
  const steamPaths = [
    await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    await regQuery('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
    'C:\\Program Files (x86)\\Steam',
  ].filter((p): p is string => !!p)
  for (const steam of steamPaths) {
    for (const lib of await libraryFolders(steam))
      out.push(join(lib, 'steamapps', 'common', 'assettocorsa'))
  }
  return [...new Set(out)]
}

export async function detectAcRoot(): Promise<string | null> {
  for (const candidate of await candidateRoots()) {
    if (await isAcRoot(candidate)) return candidate
  }
  return null
}

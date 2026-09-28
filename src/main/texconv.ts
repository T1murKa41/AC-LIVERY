// DDS encoding through Microsoft's texconv.exe (DirectXTex, MIT), with a
// pure TypeScript fallback when the tool is not available.

import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { writeDds } from '@shared/formats/dds'
import type { DdsFormat, Encoders } from './exportSkin'

const run = promisify(execFile)

const DXGI_NAMES: Record<DdsFormat, string> = {
  BC1: 'BC1_UNORM',
  BC3: 'BC3_UNORM',
  BGRA8: 'B8G8R8A8_UNORM',
}

export const builtinDdsEncoder: Encoders['dds'] = {
  name: 'builtin',
  async encode(rgba, width, height, format) {
    return writeDds(rgba, width, height, format)
  },
}

export function texconvEncoder(exePath: string): Encoders['dds'] {
  return {
    name: 'texconv',
    async encode(rgba, width, height, format) {
      const dir = await mkdtemp(join(tmpdir(), 'aclivery-'))
      try {
        const input = join(dir, 'texture.dds')
        const outDir = join(dir, 'out')
        await mkdir(outDir)
        await writeFile(input, writeDds(rgba, width, height, 'BGRA8', false))
        await run(
          exePath,
          ['-nologo', '-y', '-f', DXGI_NAMES[format], '-m', '0', '-o', outDir, input],
          { windowsHide: true, timeout: 5 * 60_000 },
        )
        return new Uint8Array(await readFile(join(outDir, 'texture.dds')))
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}

/** Uses texconv when it exists at one of the given paths (Windows only). */
export async function pickDdsEncoder(candidates: string[]): Promise<Encoders['dds']> {
  if (process.platform !== 'win32') return builtinDdsEncoder
  for (const path of candidates) {
    try {
      await access(path)
      return texconvEncoder(path)
    } catch {
      // try the next location
    }
  }
  return builtinDdsEncoder
}

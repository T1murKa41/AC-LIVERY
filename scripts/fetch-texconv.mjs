// Downloads texconv.exe (Microsoft DirectXTex, MIT license) into resources/bin.
// The packaged app uses it for high-quality BC1/BC3 compression; without it
// AC Livery falls back to its built-in encoder.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'bin')
const files = {
  'texconv.exe': 'https://github.com/microsoft/DirectXTex/releases/latest/download/texconv.exe',
  'texconv.LICENSE.txt': 'https://raw.githubusercontent.com/microsoft/DirectXTex/main/LICENSE',
}

await mkdir(outDir, { recursive: true })
for (const [name, url] of Object.entries(files)) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Download failed: ${url} (${res.status})`)
  const data = new Uint8Array(await res.arrayBuffer())
  await writeFile(join(outDir, name), data)
  console.log(`${name}: ${data.byteLength} bytes`)
}

// Plain-text diagnostics about a loaded car, meant to be pasted into an issue
// or chat when a model does not look right.

import type { CarDetails } from '@shared/api'
import { isDds, parseDds } from '@shared/formats/dds'
import type { SkinTextureStatus } from './controller'
import type { LoadedCar } from './types'

function textureFormat(data: Uint8Array): string {
  if (data.byteLength === 0) return 'empty'
  if (isDds(data)) {
    try {
      const dds = parseDds(data)
      return `DDS ${dds.format}${dds.srgb ? ' sRGB' : ''} ${dds.width}x${dds.height} mips=${dds.mips.length}`
    } catch (err) {
      return `DDS error: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  if (data[0] === 0x89 && data[1] === 0x50) return 'PNG'
  if (data[0] === 0xff && data[1] === 0xd8) return 'JPEG'
  return `unknown (${[...data.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ')})`
}

function prop(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

export interface ReportInput {
  car: CarDetails
  loaded: LoadedCar
  shownSkin: string | null
  skinStatus: readonly SkinTextureStatus[]
  appVersion?: string
}

export function buildReport({
  car,
  loaded,
  shownSkin,
  skinStatus,
  appVersion,
}: ReportInput): string {
  const a = loaded.analysis
  const f = a.frame
  const lines: string[] = []
  const push = (s = '') => lines.push(s)

  push(`AC Livery diagnostics${appVersion ? ` (${appVersion})` : ''}`)
  push(`car: ${car.id} "${car.name}" model=${car.kn5 ?? '-'} kn5 v${loaded.version}`)
  push(`kn5 files: ${car.kn5Files.join(', ')}`)
  push(
    `frame: ${f.source}${f.mirrored ? ' mirrored' : ''} size=${f.length.toFixed(2)}x${f.width.toFixed(2)}x${f.height.toFixed(2)} ` +
      `fwd=[${f.forward.map((v) => v.toFixed(2)).join(',')}] left=[${f.left.map((v) => v.toFixed(2)).join(',')}]`,
  )
  push(`livery texture: ${a.bodyTexture ?? '-'}  maps: ${a.bodyMapsTexture ?? '-'}`)
  push(`paintable: ${a.paintable.join(', ') || '-'}`)
  push(
    `side uv overlap: ${a.sideUvOverlap === null ? '-' : a.sideUvOverlap.toFixed(3)}  flipWinding: ${a.flipWinding}  warnings: ${a.warnings.join(', ') || '-'}`,
  )

  push()
  push(`skins (${car.skins.length}), shown: ${shownSkin ?? 'model'}`)
  for (const skin of car.skins)
    push(`  ${skin.id}${skin.ours ? ' [ours]' : ''}: ${skin.files.join(', ')}`)
  if (skinStatus.length) {
    push('shown skin textures:')
    for (const s of skinStatus) {
      const detail =
        s.status === 'loaded'
          ? `${s.format} ${s.width}x${s.height}`
          : s.status === 'error'
            ? `ERROR ${s.error}`
            : 'not in skin (model texture used)'
      push(`  ${s.texture}: ${s.file ?? '-'} ${detail}`)
    }
  }

  push()
  push(`textures (${loaded.textures.length}):`)
  for (const t of loaded.textures) push(`  ${t.name}: ${textureFormat(t.data)}`)

  push()
  push(`materials (${loaded.materials.length}):`)
  loaded.materials.forEach((m, i) => {
    const meshes = loaded.meshes.filter((x) => x.materialId === i)
    const hidden = meshes.filter((x) => x.hidden).length
    const tex = m.textures.map((t) => `${t.name}=${t.texture}`).join(' ')
    const props = m.properties.map((p) => `${p.name}=${prop(p.a)}`).join(' ')
    push(
      `  #${i} ${m.name} [${m.shader}] blend=${m.blendMode} at=${m.alphaTested ? 1 : 0} depth=${m.depthMode} ` +
        `meshes=${meshes.length}${hidden ? ` (${hidden} hidden)` : ''}`,
    )
    if (tex) push(`      ${tex}`)
    if (props) push(`      ${props}`)
  })

  push()
  const hidden = loaded.meshes.filter((m) => m.hidden)
  push(`meshes: ${loaded.meshes.length}, hidden by default: ${hidden.length}`)
  for (const m of hidden) push(`  hidden (${m.hiddenReason}): ${m.path}/${m.name}`)
  return lines.join('\n')
}

export function describeMesh(loaded: LoadedCar, index: number): string[] {
  const mesh = loaded.meshes.find((m) => m.index === index)
  if (!mesh) return []
  const mat = loaded.materials[mesh.materialId]
  const out = [
    `${mesh.path}/${mesh.name}`,
    `material #${mesh.materialId} ${mat?.name ?? '?'} [${mat?.shader ?? '?'}]`,
    `blend=${mat?.blendMode} alphaTested=${mat?.alphaTested ? 1 : 0} depth=${mat?.depthMode}`,
    `triangles=${mesh.indices.length / 3}${mesh.hidden ? ` hidden (${mesh.hiddenReason})` : ''}`,
  ]
  for (const t of mat?.textures ?? []) out.push(`${t.name} = ${t.texture}`)
  return out
}

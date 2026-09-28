// Parses and analyzes a kn5 model off the main thread.

import { analyzeCar } from '@shared/car/analysis'
import { parseKn5, walkKn5 } from '@shared/formats/kn5'
import type { Kn5WorkerRequest, Kn5WorkerResponse, LoadedMesh } from './types'

const HIDDEN_RE = /(_HR$)|(^|_)BLUR|DAMAGE|(^|_)SHADOW/i

self.onmessage = (event: MessageEvent<Kn5WorkerRequest>) => {
  const { bytes, skinFileNames } = event.data
  try {
    const kn5 = parseKn5(new Uint8Array(bytes))
    const analysis = analyzeCar(kn5, { skinFileNames })
    const meshes: LoadedMesh[] = []
    const hiddenNodes = new Set<unknown>()
    walkKn5(kn5.root, (node, world, parent) => {
      const hidden =
        (parent !== null && hiddenNodes.has(parent)) || !node.active || HIDDEN_RE.test(node.name)
      if (hidden) hiddenNodes.add(node)
      if (node.kind === 'base') return
      meshes.push({
        index: meshes.length,
        name: node.name,
        materialId: node.materialId,
        hidden: hidden || !node.visible,
        positions: node.positions,
        normals: node.normals,
        uvs: node.uvs,
        tangents: node.tangents,
        indices: node.indices,
        world,
      })
    })
    const transfer = new Set<ArrayBuffer>([bytes])
    for (const m of meshes) {
      for (const a of [m.positions, m.normals, m.uvs, m.tangents, m.indices])
        transfer.add(a.buffer as ArrayBuffer)
    }
    const response: Kn5WorkerResponse = {
      ok: true,
      car: {
        version: kn5.version,
        materials: kn5.materials,
        textures: kn5.textures.map((t) => ({ name: t.name, data: t.data })),
        meshes,
        analysis,
      },
    }
    ;(self as unknown as Worker).postMessage(response, [...transfer])
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    const response: Kn5WorkerResponse = { ok: false, error: { name: e.name, message: e.message } }
    ;(self as unknown as Worker).postMessage(response)
  }
}

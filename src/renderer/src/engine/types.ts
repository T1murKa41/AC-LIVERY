import type { CarAnalysis } from '@shared/car/analysis'
import type { Kn5Material } from '@shared/formats/kn5'

export interface LoadedMesh {
  index: number
  name: string
  materialId: number
  /** Not shown by default (cockpit HR, blurred rims, damage, inactive nodes). */
  hidden: boolean
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  tangents: Float32Array
  indices: Uint16Array
  /** Row-major world matrix (same memory layout as three.js Matrix4.fromArray). */
  world: Float32Array
}

export interface LoadedCar {
  version: number
  materials: Kn5Material[]
  textures: { name: string; data: Uint8Array }[]
  meshes: LoadedMesh[]
  analysis: CarAnalysis
}

export type Kn5WorkerRequest = { bytes: ArrayBuffer; skinFileNames: string[] }
export type Kn5WorkerResponse =
  { ok: true; car: LoadedCar } | { ok: false; error: { name: string; message: string } }

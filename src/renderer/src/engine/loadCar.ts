import type { Kn5WorkerResponse, LoadedCar } from './types'

export class ModelLoadError extends Error {
  override name = 'ModelLoadError'
  constructor(
    message: string,
    readonly kind: 'format' | 'other',
  ) {
    super(message)
  }
}

/** Parses a kn5 in a worker. The input buffer is transferred (unusable afterwards). */
export function parseCarInWorker(bytes: ArrayBuffer, skinFileNames: string[]): Promise<LoadedCar> {
  const worker = new Worker(new URL('./kn5.worker.ts', import.meta.url), { type: 'module' })
  return new Promise<LoadedCar>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<Kn5WorkerResponse>) => {
      worker.terminate()
      if (e.data.ok) resolve(e.data.car)
      else
        reject(
          new ModelLoadError(
            e.data.error.message,
            e.data.error.name === 'FormatError' ? 'format' : 'other',
          ),
        )
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new ModelLoadError(e.message || 'Worker failed', 'other'))
    }
    worker.postMessage({ bytes, skinFileNames }, [bytes])
  })
}

export function extractAoInWorker(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const worker = new Worker(new URL('./ao.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<Uint8Array>) => {
      worker.terminate()
      resolve(e.data)
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'AO worker failed'))
    }
    worker.postMessage({ rgba, width, height }, [rgba.buffer])
  })
}

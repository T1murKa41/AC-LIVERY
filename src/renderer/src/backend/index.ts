import type { Backend } from '@shared/api'
import { createElectronBackend } from './electron'
import { createMockBackend } from './mock'

export function createBackend(): Backend {
  if (import.meta.env.VITE_MOCK_BACKEND !== '1' && window.aclivery) {
    return createElectronBackend(window.aclivery)
  }
  return createMockBackend()
}

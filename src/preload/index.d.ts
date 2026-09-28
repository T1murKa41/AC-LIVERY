import type { ElectronApi } from './types'

declare global {
  interface Window {
    aclivery?: ElectronApi
  }
}

export {}

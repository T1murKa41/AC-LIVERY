import type { Backend } from '@shared/api'

/** What the preload script exposes as window.aclivery. Files are read via the acl:// protocol. */
export type ElectronApi = Omit<Backend, 'kind' | 'readFile'>

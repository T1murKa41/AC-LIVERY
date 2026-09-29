import type { Backend } from '@shared/api'
import type { ElectronApi } from '../../../preload/types'

export function gameFileUrl(relPath: string): string {
  return `acl://game/${relPath.split('/').map(encodeURIComponent).join('/')}`
}

export function createElectronBackend(api: ElectronApi): Backend {
  return {
    kind: 'electron',
    getSettings: () => api.getSettings(),
    setLanguage: (language) => api.setLanguage(language),
    setAcRoot: (path) => api.setAcRoot(path),
    detectAcRoot: () => api.detectAcRoot(),
    pickAcRoot: () => api.pickAcRoot(),
    listCars: () => api.listCars(),
    getCar: (carId) => api.getCar(carId),
    checkSkin: (carId, skinId) => api.checkSkin(carId, skinId),
    exportSkin: (request) => api.exportSkin(request),
    revealPath: (relPath) => api.revealPath(relPath),
    saveProject: (bytes, options) => api.saveProject(bytes, options),
    openProject: () => api.openProject(),
    readAutosave: () => api.readAutosave(),
    listStickers: () => api.listStickers(),
    addSticker: (name, mime, data) => api.addSticker(name, mime, data),
    deleteSticker: (id) => api.deleteSticker(id),
    listTemplates: () => api.listTemplates(),
    readTemplate: (id) => api.readTemplate(id),
    saveTemplate: (bytes) => api.saveTemplate(bytes),
    deleteTemplate: (id) => api.deleteTemplate(id),
    writeAutosave: (data) => api.writeAutosave(data),
    async readFile(relPath) {
      const res = await fetch(gameFileUrl(relPath))
      if (!res.ok) throw new Error(`Cannot read ${relPath} (${res.status})`)
      return res.arrayBuffer()
    },
  }
}

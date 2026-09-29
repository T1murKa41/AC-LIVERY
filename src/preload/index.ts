import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronApi } from './types'

const api: ElectronApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setLanguage: (language) => ipcRenderer.invoke('settings:setLanguage', language),
  setAcRoot: (path) => ipcRenderer.invoke('ac:setRoot', path),
  detectAcRoot: () => ipcRenderer.invoke('ac:detect'),
  pickAcRoot: () => ipcRenderer.invoke('ac:pick'),
  listCars: () => ipcRenderer.invoke('cars:list'),
  getCar: (carId) => ipcRenderer.invoke('cars:get', carId),
  checkSkin: (carId, skinId) => ipcRenderer.invoke('skin:check', carId, skinId),
  exportSkin: (request) => ipcRenderer.invoke('skin:export', request),
  revealPath: (relPath) => ipcRenderer.invoke('shell:reveal', relPath),
  saveProject: (bytes, options) => ipcRenderer.invoke('project:save', bytes, options),
  openProject: () => ipcRenderer.invoke('project:open'),
  readAutosave: () => ipcRenderer.invoke('autosave:read'),
  listStickers: () => ipcRenderer.invoke('stickers:list'),
  addSticker: (name, mime, data) => ipcRenderer.invoke('stickers:add', name, mime, data),
  deleteSticker: (id) => ipcRenderer.invoke('stickers:delete', id),
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  readTemplate: (id) => ipcRenderer.invoke('templates:read', id),
  saveTemplate: (bytes) => ipcRenderer.invoke('templates:save', bytes),
  deleteTemplate: (id) => ipcRenderer.invoke('templates:delete', id),
  writeAutosave: (data) => ipcRenderer.invoke('autosave:write', data),
}

contextBridge.exposeInMainWorld('aclivery', api)

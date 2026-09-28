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
}

contextBridge.exposeInMainWorld('aclivery', api)

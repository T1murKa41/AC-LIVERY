import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { basename, join } from 'node:path'
import type { ExportRequest, Language } from '@shared/api'
import { PROJECT_EXTENSION } from '@shared/design/project'
import { detectAcRoot, isAcRoot } from './acRoot'
import { getCar, listCars } from './cars'
import { exportSkin, skinStatus, type Encoders } from './exportSkin'
import { resolveInside } from './paths'
import {
  ProjectPaths,
  readAutosave,
  readProjectFile,
  withProjectExtension,
  writeAtomic,
  writeAutosave,
} from './projects'
import type { SettingsStore } from './settings'
import { pickDdsEncoder } from './texconv'

function rgbaToBgra(rgba: Uint8Array): Buffer {
  const out = Buffer.alloc(rgba.byteLength)
  for (let i = 0; i < rgba.byteLength; i += 4) {
    out[i] = rgba[i + 2]!
    out[i + 1] = rgba[i + 1]!
    out[i + 2] = rgba[i]!
    out[i + 3] = rgba[i + 3]!
  }
  return out
}

function image(rgba: Uint8Array, width: number, height: number) {
  return nativeImage.createFromBitmap(rgbaToBgra(rgba), { width, height })
}

function texconvCandidates(): string[] {
  return [
    join(process.resourcesPath, 'bin', 'texconv.exe'),
    join(app.getAppPath(), 'resources', 'bin', 'texconv.exe'),
  ]
}

export function registerIpc(settings: SettingsStore): void {
  const requireRoot = async (): Promise<string> => {
    const { acRoot } = await settings.get()
    if (!acRoot) throw new Error('Assetto Corsa folder is not set')
    return acRoot
  }

  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:setLanguage', (_e, language: Language) =>
    settings.update({ language: language === 'en' ? 'en' : 'ru' }),
  )
  ipcMain.handle('ac:setRoot', async (_e, path: string | null) => {
    if (path !== null && !(await isAcRoot(path))) {
      return { settings: await settings.get(), error: 'not-ac-root' }
    }
    return { settings: await settings.update({ acRoot: path }) }
  })
  ipcMain.handle('ac:detect', () => detectAcRoot())
  ipcMain.handle('ac:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = { properties: ['openDirectory' as const] }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('cars:list', async () => listCars(await requireRoot()))
  ipcMain.handle('cars:get', async (_e, carId: string) => getCar(await requireRoot(), carId))
  ipcMain.handle('skin:check', async (_e, carId: string, skinId: string) =>
    skinStatus(await requireRoot(), carId, skinId),
  )
  ipcMain.handle('skin:export', async (_e, request: ExportRequest) => {
    const { acRoot } = await settings.get()
    if (!acRoot)
      return { ok: false, error: 'no-ac-root', message: 'Assetto Corsa folder is not set' }
    const encoders: Encoders = {
      dds: await pickDdsEncoder(texconvCandidates()),
      png: (rgba, w, h) => image(rgba, w, h).toPNG(),
      jpeg: (rgba, w, h, q) => image(rgba, w, h).toJPEG(q),
    }
    return exportSkin(acRoot, request, encoders, app.getVersion())
  })
  ipcMain.handle('shell:reveal', async (_e, relPath: string) => {
    const abs = resolveInside(await requireRoot(), relPath)
    if (abs) shell.showItemInFolder(abs)
  })

  const projects = new ProjectPaths()
  const filters = [{ name: 'AC Livery', extensions: [PROJECT_EXTENSION] }]
  ipcMain.handle(
    'project:save',
    async (e, bytes: Uint8Array, options: { path?: string; suggestedName: string }) => {
      let target = options.path && projects.isAllowed(options.path) ? options.path : null
      if (!target) {
        const win = BrowserWindow.fromWebContents(e.sender)
        const dialogOptions = {
          defaultPath: join(app.getPath('documents'), basename(options.suggestedName)),
          filters,
        }
        const result = win
          ? await dialog.showSaveDialog(win, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions)
        if (result.canceled || !result.filePath) return null
        target = projects.allow(withProjectExtension(result.filePath))
      }
      await writeAtomic(target, bytes)
      return target
    },
  )
  ipcMain.handle('project:open', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = { properties: ['openFile' as const], filters }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    const picked = result.canceled ? null : result.filePaths[0]
    if (!picked) return null
    const path = projects.allow(picked)
    return { path, bytes: await readProjectFile(path) }
  })
  const autosaveFile = join(app.getPath('userData'), 'autosave.json')
  ipcMain.handle('autosave:read', () => readAutosave(autosaveFile))
  ipcMain.handle('autosave:write', (_e, data: string | null) =>
    writeAutosave(autosaveFile, typeof data === 'string' ? data : null),
  )
}

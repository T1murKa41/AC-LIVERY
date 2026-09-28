import { expect, test, type Page } from '@playwright/test'
import { FIN } from '../src/shared/fixtures/syntheticCar'

const PANEL_NAMES = { design: /Дизайн|Design/, base: /Основа|Base/, save: /Сохранение|Save/ }

/** Switches the sub-panel of the Livery tab. */
async function panel(page: Page, name: keyof typeof PANEL_NAMES) {
  await page.locator('.livery .segmented button', { hasText: PANEL_NAMES[name] }).click()
}

async function openCar(page: Page, text?: string) {
  await page.goto('/')
  const item = text
    ? page.locator('.car-item', { hasText: text })
    : page.locator('.car-item').first()
  await item.click()
  await expect(page.locator('.view-toolbar')).toBeVisible({ timeout: 60_000 })
}

type PixelTest = 'white' | 'light' | 'blue' | 'orange'

/** Share of preview pixels of a kind, decoded in the page. */
async function previewShare(page: Page, dir: string, kind: PixelTest): Promise<number> {
  return page.evaluate(
    async ({ dir, kind }) => {
      const all = (globalThis as unknown as { __aclMockFiles: Map<string, Uint8Array> })
        .__aclMockFiles
      const bitmap = await createImageBitmap(new Blob([all.get(dir + 'preview.jpg')! as BlobPart]))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      let n = 0
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i]!
        const g = px[i + 1]!
        const b = px[i + 2]!
        const hit =
          kind === 'white'
            ? r > 200 && g > 200 && b > 200
            : kind === 'light'
              ? r > 120 && g > 120 && b > 120 && Math.abs(r - b) < 30
              : kind === 'blue'
                ? b > r + 50 && b > g + 20
                : r > 230 && g > 70 && g < 110 && b < 60
        if (hit) n++
      }
      return n / (px.length / 4)
    },
    { dir, kind },
  )
}

// Runs the renderer against the in-browser mock backend and the synthetic car.

test('load a car, paint it and save the skin', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')

  await page.locator('.car-item').first().click()
  await expect(page.locator('.view-toolbar')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.skin-main')).toHaveCount(2)

  await page.locator('.view-toolbar button').nth(1).click()
  await page.locator('.view-toolbar button').first().click()

  await page.locator('.tabs button').nth(1).click()
  await page.locator('.swatch').nth(3).click()
  await panel(page, 'save')
  await page.getByLabel(/^(Название|Name)$/).fill('E2E Green')
  await expect(page.getByLabel(/^(Папка|Folder)$/)).toHaveValue('e2e_green')
  await page.locator('.btn.primary.wide').click()
  await expect(page.locator('.notice.ok')).toBeVisible({ timeout: 60_000 })

  const files = await page.evaluate(() => {
    const all = (globalThis as unknown as { __aclMockFiles: Map<string, Uint8Array> })
      .__aclMockFiles
    return [...all.keys()]
      .filter((k) => k.includes('/skins/e2e_green/'))
      .map((k) => k.split('/').pop())
  })
  expect(files.sort()).toEqual([
    '.aclivery.json',
    'Skin_00.dds',
    'livery.png',
    'preview.jpg',
    'skin.ini', // carried over from the base skin
    'ui_skin.json',
  ])

  // exporting again asks before overwriting
  await page.locator('.btn.primary.wide').click()
  await expect(page.locator('.notice.warn')).toBeVisible()

  await page.locator('.tabs button').first().click()
  await expect(page.locator('.skin-main')).toHaveCount(3)
  expect(errors).toEqual([])
})

test('warns about shared side UVs', async ({ page }) => {
  await page.goto('/')
  await page.locator('.car-item', { hasText: 'shared UV' }).click()
  await expect(page.locator('.view-toolbar')).toBeVisible({ timeout: 60_000 })
  await page.locator('.tabs button').nth(2).click()
  await expect(page.locator('.info .notice.warn')).toBeVisible()
})

test('exporting right after opening the livery tab waits for the bake', async ({ page }) => {
  await page.goto('/')
  await page.locator('.car-item').first().click()
  await expect(page.locator('.view-toolbar')).toBeVisible({ timeout: 60_000 })
  await page.locator('.tabs button').nth(1).click()
  await page.locator('.btn.primary.wide').click()
  await expect(page.locator('.notice.ok')).toBeVisible({ timeout: 60_000 })
})

test('model tab builds a diagnostics report', async ({ page }) => {
  await page.goto('/')
  await page.locator('.car-item').first().click()
  await expect(page.locator('.view-toolbar')).toBeVisible({ timeout: 60_000 })
  await page.locator('.skin-main').nth(1).click()
  await page.locator('.tabs button').nth(2).click()
  await page.getByRole('button', { name: /Скопировать отчёт|Copy report/ }).click()
  const report = await page.locator('.report-text').inputValue()
  expect(report).toContain('AC Livery diagnostics')
  expect(report).toContain('decals.dds: decals.dds BC3 128x64')
  expect(report).toContain('[ksPerPixelAT]')
  // the body is stored one UV tile below 0..1, like in Kunos models
  expect(report).toMatch(/uv range of Skin_00\.dds: u 0\.\d+\.\.0\.\d+ v -0\.9\d+\.\.-0\.\d+/)
})

test('repainting changes the paint you see, even under a livery overlay', async ({ page }) => {
  await page.goto('/')
  await page.locator('.car-item', { hasText: 'livery overlay' }).click()
  await expect(page.locator('.view-toolbar')).toBeVisible({ timeout: 60_000 })
  await page.locator('.tabs button').nth(1).click()

  // the visible overlay is picked automatically, not the hidden body texture
  await panel(page, 'base')
  const first = page.locator('.texture-list:not(.compact) li').first()
  await expect(first).toContainText('Livery.dds')
  await expect(first.locator('input')).toBeChecked()
  await expect(
    page.locator('.texture-list:not(.compact) li', { hasText: 'Skin_00.dds' }).locator('input'),
  ).not.toBeChecked()

  await panel(page, 'design')
  await page.locator('.swatch').nth(5).click() // blue
  await panel(page, 'save')
  await page.getByLabel(/^(Название|Name)$/).fill('Overlay Blue')
  await page.locator('.btn.primary.wide').click()
  await expect(page.locator('.notice.ok')).toBeVisible({ timeout: 60_000 })

  const result = await page.evaluate(async () => {
    const all = (globalThis as unknown as { __aclMockFiles: Map<string, Uint8Array> })
      .__aclMockFiles
    const dir = 'content/cars/aclivery_test_overlay/skins/overlay_blue/'
    const names = [...all.keys()].filter((k) => k.startsWith(dir)).map((k) => k.slice(dir.length))
    const bitmap = await createImageBitmap(new Blob([all.get(dir + 'preview.jpg')! as BlobPart]))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    let blue = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 2]! > px[i]! + 50 && px[i + 2]! > px[i + 1]! + 20) blue++
    }
    return { names, blueShare: blue / (px.length / 4) }
  })
  // painted overlay, plus the rest of the base skin (untouched body texture,
  // skin.ini) without its metadata
  expect(result.names.sort()).toEqual(
    [
      '.aclivery.json',
      'Livery.dds',
      'Skin_00.dds',
      'livery.png',
      'preview.jpg',
      'skin.ini',
      'ui_skin.json',
    ].sort(),
  )
  expect(result.blueShare).toBeGreaterThan(0.05)
})

test('vinyl editor: add, undo/redo, resize with the wheel, export', async ({ page }) => {
  await openCar(page)
  await page.locator('.tabs button').nth(1).click()
  await page.locator('.swatch').nth(5).click() // blue base

  await page.locator('.add-grid .tool').first().click() // rectangle
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.layer-row')).toHaveCount(0)
  await page.keyboard.press('Control+y')
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await page.locator('.layer-row').click()

  // bigger with Shift + wheel over the viewport
  const width = page.locator('.properties .field', { hasText: /Ширина|Width/ }).locator('.mono')
  const before = parseInt((await width.textContent()) ?? '0', 10)
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.down('Shift')
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -100)
  await page.keyboard.up('Shift')
  await expect
    .poll(async () => parseInt((await width.textContent()) ?? '0', 10))
    .toBeGreaterThan(before)

  await panel(page, 'save')
  await page.getByLabel(/^(Название|Name)$/).fill('Vinyl Test')
  await page.locator('.btn.primary.wide').click()
  await expect(page.locator('.notice.ok')).toBeVisible({ timeout: 60_000 })
  const dir = 'content/cars/aclivery_test_coupe/skins/vinyl_test/'
  // the white rectangle shows up on the blue car
  expect(await previewShare(page, dir, 'white')).toBeGreaterThan(0.005)
  expect(await previewShare(page, dir, 'blue')).toBeGreaterThan(0.03)
})

test('stock decals can be removed from the new skin', async ({ page }) => {
  await openCar(page)
  await page.locator('.tabs button').nth(1).click()
  await panel(page, 'base')
  await page.locator('.texture-list.compact li', { hasText: 'decals.dds' }).locator('input').check()
  await panel(page, 'save')
  await page.getByLabel(/^(Название|Name)$/).fill('No Decals')
  await page.locator('.btn.primary.wide').click()
  await expect(page.locator('.notice.ok')).toBeVisible({ timeout: 60_000 })
  const decal = await page.evaluate(() => {
    const all = (globalThis as unknown as { __aclMockFiles: Map<string, Uint8Array> })
      .__aclMockFiles
    const bytes = all.get('content/cars/aclivery_test_coupe/skins/no_decals/decals.dds')
    if (!bytes) return null
    const v = new DataView(bytes.buffer, bytes.byteOffset)
    return { width: v.getUint32(16, true), fourcc: String.fromCharCode(...bytes.subarray(84, 88)) }
  })
  expect(decal).toEqual({ width: 4, fourcc: 'DXT5' })
})

test('text vinyls are baked onto the body', async ({ page }) => {
  await openCar(page)
  await page.locator('.tabs button').nth(1).click()
  await page.locator('.swatch').nth(11).click() // near-black base
  await page.locator('.view-toolbar button').nth(1).click() // left side: lands on the door

  const exportAs = async (name: string) => {
    await panel(page, 'save')
    await page.getByLabel(/^(Название|Name)$/).fill(name)
    await page.locator('.btn.primary.wide').click()
    await expect(page.locator('.notice.ok')).toBeVisible({ timeout: 60_000 })
    await panel(page, 'design')
  }
  await exportAs('Plain')
  await page.locator('.livery button', { hasText: /^(Номер|Number)$/ }).click()
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect(page.locator('.properties .notice.warn')).toHaveCount(0)
  await exportAs('With Number')

  const plain = await previewShare(page, 'content/cars/aclivery_test_coupe/skins/plain/', 'light')
  const dir = 'content/cars/aclivery_test_coupe/skins/with_number/'
  const numbered = await previewShare(page, dir, 'light')
  expect(numbered - plain).toBeGreaterThan(0.002)
  // the orange selection outline must not be in the preview
  expect(await previewShare(page, dir, 'orange')).toBe(0)
})

test('finishes are written into the material map', async ({ page }) => {
  await openCar(page)
  await page.locator('.tabs button').nth(1).click()
  await page.getByRole('combobox', { name: /^(Финиш основы|Base finish)$/ }).selectOption('matte')
  // a glossy stripe on the matte car
  await page.locator('.add-grid .tool').first().click()
  await page.getByRole('combobox', { name: /^(Финиш|Finish)$/ }).selectOption('gloss')

  await panel(page, 'save')
  await page.getByLabel(/^(Название|Name)$/).fill('Matte Test')
  await page.locator('.btn.primary.wide').click()
  await expect(page.locator('.notice.ok')).toBeVisible({ timeout: 60_000 })

  const maps = await page.evaluate(() => {
    const all = (globalThis as unknown as { __aclMockFiles: Map<string, Uint8Array> })
      .__aclMockFiles
    const dds = all.get('content/cars/aclivery_test_coupe/skins/matte_test/Skin_00_Maps.dds')
    if (!dds) return null
    // BC1 blocks: the first endpoint's red channel tells the specular level
    const view = new DataView(dds.buffer, dds.byteOffset, dds.byteLength)
    const width = view.getUint32(16, true)
    const height = view.getUint32(12, true)
    const blocks = Math.ceil(width / 4) * Math.ceil(height / 4)
    let dark = 0
    let bright = 0
    for (let i = 0; i < blocks; i++) {
      const c0 = view.getUint16(128 + i * 8, true)
      const r = ((c0 >> 11) * 255) / 31
      if (r < 60) dark++
      if (r > 240) bright++
    }
    return { dark: dark / blocks, bright: bright / blocks }
  })
  expect(maps).not.toBeNull()
  expect(maps!.dark).toBeGreaterThan(0.2)
  expect(maps!.bright).toBeGreaterThan(0.003)
})

test('projects save and open, unsaved work is restored after a restart', async ({ page }) => {
  await openCar(page)
  await page.locator('.tabs button').nth(1).click()
  await page.locator('.add-grid .tool').nth(2).click() // circle
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect(page.locator('.project-name')).toContainText(/не сохранён|unsaved/)

  await page.keyboard.press('Control+s')
  await expect(page.locator('.project-name')).toHaveText(/^My Livery\.aclivery$/)

  // wipe the design, then open the saved project again
  await page.locator('.btn.ghost.small', { hasText: /Удалить все слои|Delete all layers/ }).click()
  await expect(page.locator('.layer-row')).toHaveCount(0)
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: /Открыть проект|Open project/ }).click()
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect(page.locator('.project-name')).toHaveText(/^My Livery\.aclivery$/)

  // unsaved work survives a reload through the autosave
  await page.locator('.add-grid .tool').nth(5).click() // star
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await page.waitForTimeout(2500)
  await page.reload()
  await expect(page.locator('.app-bar')).toContainText(/AC Livery Test Coupe/)
  await page.getByRole('button', { name: /Восстановить|Restore/ }).click()
  await expect(page.locator('.view-toolbar')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await expect(page.locator('.app-bar')).toHaveCount(0)
})

test('groups scale and rotate together with the handles on the car', async ({ page }) => {
  await openCar(page)
  await page.locator('.tabs button').nth(1).click()
  await page.locator('.view-toolbar button').nth(1).click() // left side, orthographic
  await page.locator('.add-grid .tool').first().click() // rectangle
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.locator('.add-grid .tool').nth(5).click() // star
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft')
  await page
    .locator('.layer-row')
    .nth(1)
    .click({ modifiers: ['Control'] })
  await expect(page.locator('.selection-panel h3')).toHaveText(/Выделено: 2|2 selected/)
  await page.getByRole('button', { name: /^(Сгруппировать|Group)$/ }).click()
  await expect(page.locator('.group-row')).toHaveCount(1)
  await expect(page.locator('.layer-row.in-group')).toHaveCount(2)

  const field = (label: RegExp) =>
    page.locator('.properties .field', { hasText: label }).locator('.mono')
  const width = field(/Ширина|Width/)
  const rotation = field(/Поворот|Rotation/)
  const value = async (l: typeof width) => parseInt((await l.textContent()) ?? '0', 10)
  const before = await value(width)

  const centre = async () => {
    const a = (await page.locator('.gizmo-handle.scale').nth(0).boundingBox())!
    const c = (await page.locator('.gizmo-handle.scale').nth(2).boundingBox())!
    return { x: (a.x + c.x) / 2 + 6, y: (a.y + c.y) / 2 + 6 }
  }

  // pull a corner away from the centre: the whole group grows by half
  const mid = await centre()
  const corner = (await page.locator('.gizmo-handle.scale').nth(2).boundingBox())!
  const from = { x: corner.x + 6, y: corner.y + 6 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + (from.x - mid.x) * 0.5, from.y + (from.y - mid.y) * 0.5, {
    steps: 6,
  })
  await page.mouse.up()
  await expect.poll(() => value(width)).toBeGreaterThan(before * 1.3)
  // the other member grew as well
  await page.locator('.layer-row.in-group').first().click()
  await expect.poll(() => value(width)).toBeGreaterThan(before * 1.3)

  // turn the dot a quarter around the centre: the group rotates by 90°
  await page.locator('.group-row').click()
  const c2 = await centre()
  const dot = (await page.locator('.gizmo-handle.rotate').boundingBox())!
  const start = { x: dot.x + 7, y: dot.y + 7 }
  const r = Math.hypot(start.x - c2.x, start.y - c2.y)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let i = 1; i <= 9; i++) {
    const a = Math.atan2(start.y - c2.y, start.x - c2.x) + (i / 9) * (Math.PI / 2)
    await page.mouse.move(c2.x + Math.cos(a) * r, c2.y + Math.sin(a) * r)
  }
  await page.mouse.up()
  await expect.poll(async () => Math.abs(await value(rotation))).toBe(90)

  await page.getByRole('button', { name: /^(Разгруппировать|Ungroup)$/ }).click()
  await expect(page.locator('.group-row')).toHaveCount(0)
  await expect(page.locator('.layer-row')).toHaveCount(2)
})

test('a vinyl only paints the first surface it meets (thin fins)', async ({ page }) => {
  await openCar(page, 'fin')
  await page.locator('.tabs button').nth(1).click()
  await page.locator('.swatch').nth(5).click() // blue base
  await page.locator('.add-grid .tool').first().click() // white rectangle

  const shares = await page.evaluate(
    async ({ fin }) => {
      interface Hook {
        store: {
          getState(): {
            selectedLayer: string
            updatePlacement(id: string, patch: object): void
          }
        }
        engine(): {
          exportPayload(): {
            textures: { name: string; width: number; height: number; rgba: Uint8Array }[]
          }
        }
        whenBaked(): Promise<void>
      }
      const hook = (globalThis as unknown as { __aclTest: Hook }).__aclTest
      const st = hook.store.getState()
      const measure = async (mirror: string) => {
        // on the left face of the fin, projected from the left; the right face
        // is 2 cm behind it, well within the projector's depth
        st.updatePlacement(st.selectedLayer, {
          position: [fin.x / 0.95, (1.075 - 0.775) / 0.525, -1.7 / 2.25],
          direction: [-1, 0, 0],
          width: 0.15,
          height: 0.05,
          depth: 0.5,
          mirror,
        })
        await hook.whenBaked()
        const tex = hook
          .engine()
          .exportPayload()
          .textures.find((t) => t.name === 'Skin_00.dds')!
        const share = ([u0, v0, u1, v1]: readonly number[]) => {
          let white = 0
          let total = 0
          for (let y = Math.ceil(v0! * tex.height); y < Math.floor(v1! * tex.height); y++) {
            for (let x = Math.ceil(u0! * tex.width); x < Math.floor(u1! * tex.width); x++) {
              const o = (y * tex.width + x) * 4
              if (tex.rgba[o]! > 170 && tex.rgba[o + 1]! > 170 && tex.rgba[o + 2]! > 170) white++
              total++
            }
          }
          return white / total
        }
        return { left: share(fin.uvLeft), right: share(fin.uvRight) }
      }
      return { single: await measure('none'), mirrored: await measure('readable') }
    },
    { fin: FIN },
  )
  // one side only: nothing shows through on the far face
  expect(shares.single.left).toBeGreaterThan(0.3)
  expect(shares.single.right).toBeLessThan(0.01)
  // with a copy on the other side each face gets exactly one vinyl
  expect(shares.mirrored.right).toBeGreaterThan(0.3)
  expect(Math.abs(shares.mirrored.left - shares.single.left)).toBeLessThan(0.02)
})

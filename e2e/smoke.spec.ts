import { expect, test, type Page } from '@playwright/test'

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

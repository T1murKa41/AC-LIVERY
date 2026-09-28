import { expect, test } from '@playwright/test'

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
  const first = page.locator('.texture-list li').first()
  await expect(first).toContainText('Livery.dds')
  await expect(first.locator('input')).toBeChecked()
  await expect(
    page.locator('.texture-list li', { hasText: 'Skin_00.dds' }).locator('input'),
  ).not.toBeChecked()

  await page.locator('.swatch').nth(5).click() // blue
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
  // painted overlay, plus the untouched body texture copied from the base skin
  expect(result.names.sort()).toEqual(
    [
      '.aclivery.json',
      'Livery.dds',
      'Skin_00.dds',
      'livery.png',
      'preview.jpg',
      'ui_skin.json',
    ].sort(),
  )
  expect(result.blueShare).toBeGreaterThan(0.05)
})

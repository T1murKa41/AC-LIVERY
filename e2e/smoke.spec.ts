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
  await page.locator('.car-item').nth(1).click()
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

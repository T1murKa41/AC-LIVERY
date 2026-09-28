import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1440, height: 860 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      // software WebGL so the test runs on machines without a GPU
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm run dev:web',
    port: 5199,
    reuseExistingServer: true,
  },
})

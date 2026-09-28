// Runs the renderer in a plain browser with a mock backend (synthetic car, in-memory export).
// Useful for UI work without Electron or an Assetto Corsa install.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  define: { 'import.meta.env.VITE_MOCK_BACKEND': JSON.stringify('1') },
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: 5199, strictPort: true },
})

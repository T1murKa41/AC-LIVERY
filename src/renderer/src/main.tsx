import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installLogCapture } from './engine/log'
import './i18n'
import './styles.css'
import { App } from './App'

installLogCapture()

if (import.meta.env.DEV) {
  // end-to-end tests look inside the editor through this hook
  void import('./state/store').then(({ useStore, currentEngine, whenBaked }) => {
    ;(window as unknown as { __aclTest?: unknown }).__aclTest = {
      store: useStore,
      engine: currentEngine,
      whenBaked,
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

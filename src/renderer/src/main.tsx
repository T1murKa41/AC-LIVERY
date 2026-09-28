import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installLogCapture } from './engine/log'
import './i18n'
import './styles.css'
import { App } from './App'

installLogCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// autoUpdate mode reloads once a new service worker activates, but the browser only looks for one
// on launch/navigation; poll so an open (or installed) app picks up a fresh deploy within a minute.
registerSW({
  onRegisteredSW: (_url, registration) => {
    if (registration) setInterval(() => registration.update(), 60 * 1000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// New deploys otherwise sit installed-but-inactive until the user manually reloads twice;
// reload as soon as the new service worker takes over so a fresh deploy always shows up.
const updateSW = registerSW({ onNeedRefresh: () => updateSW(true) })
setInterval(() => updateSW(), 60 * 1000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

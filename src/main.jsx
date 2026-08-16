import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker early so push notifications can be enabled
// the moment a signed-in user opts in (from Account settings).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.error('SW register failed', err))
}

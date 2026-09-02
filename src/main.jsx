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

// --- Push notification deep-linking -----------------------------------
//
// Tapping a push notification lands the user here in one of two ways:
//   1. A brand new tab, opened at /app?nav=<link>              (sw.js)
//   2. A postMessage to an already-open tab, { type: 'push-navigate' }
//
// Both cases need to turn into the same 'notification-navigate' window
// event that StudentDashboard.jsx / TeacherDashboard.jsx already listen
// for (it's the same event NotificationBell.jsx dispatches for in-app
// taps). The tricky part: those dashboards only attach their listener
// once the user's profile has finished loading, which happens *after*
// this file runs — so a plain dispatchEvent() fired now would be lost
// with nobody listening yet. `window.__pendingNav` is the fix: it's
// stashed here, and each dashboard also checks it directly right after
// attaching its listener, in case it mounted too late to catch the
// live event.
function deliverPushNavigation(link) {
  if (!link) return
  window.__pendingNav = link
  window.dispatchEvent(new CustomEvent('notification-navigate', { detail: { link } }))
}

const navParam = new URLSearchParams(window.location.search).get('nav')
if (navParam) {
  deliverPushNavigation(navParam)

  // Strip ?nav=... from the address bar so refreshing the page doesn't
  // replay the same navigation again.
  const url = new URL(window.location.href)
  url.searchParams.delete('nav')
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'push-navigate' && event.data.link) {
      deliverPushNavigation(event.data.link)
    }
  })
}

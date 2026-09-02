
// Minimal service worker: just handles incoming push messages and taps
// on the resulting notification. No offline caching — that's a separate
// concern and not needed for push to work.
 
self.addEventListener('install', () => {
  self.skipWaiting()
})
 
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
 
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'IELTS with Mr Ikromov', body: event.data ? event.data.text() : '' }
  }
 
  const title = data.title || 'IELTS with Mr Ikromov'
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { link: data.link || '/app' },
  }
 
  event.waitUntil(self.registration.showNotification(title, options))
})
 
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
 
  // `link` is an in-app deep link like "homework:<id>" or "/app" — it is
  // NOT a real URL, so it can never be passed straight to openWindow()
  // (that opens a blank/broken tab). Turn it into a real page URL with
  // the deep link tucked into a query param instead.
  const link = event.notification.data?.link || null
  const targetUrl = new URL(
    link ? `/app?nav=${encodeURIComponent(link)}` : '/app',
    self.location.origin
  ).href
 
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If the app is already open in some tab, focus it and hand the
      // deep link over via postMessage instead of navigating the tab
      // out from under the user.
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus()
          if (link && 'postMessage' in client) {
            client.postMessage({ type: 'push-navigate', link })
          }
          return
        }
      }
 
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    })
  )
})
 
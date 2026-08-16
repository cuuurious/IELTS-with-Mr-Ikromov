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
  const link = event.notification.data?.link || '/app'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(link) && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(link)
    })
  )
})

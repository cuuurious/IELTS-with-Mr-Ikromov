// Service worker — push notifications + light caching (2026-10-02).
//
// Caching rules (kept deliberately simple so a deploy can never leave
// students stuck on an old version):
//   • /assets/*  — Vite's hashed JS/CSS files. The name changes whenever
//     the content changes, so a cached copy is always correct:
//     cache-first. Repeat visits load the app without downloading it again.
//   • /icons/*, fonts and images from this site — stale-while-revalidate.
//   • Page loads (navigation) — ALWAYS the network first, so a new deploy
//     shows up immediately. The last good page is kept only as a fallback
//     for when the phone is offline / the network fails.
//   • Everything else (Supabase API, storage, other sites) — untouched.

const VERSION = 'v1'
const ASSET_CACHE = `assets-${VERSION}`
const STATIC_CACHE = `static-${VERSION}`
const SHELL_CACHE = `shell-${VERSION}`
const KEEP = [ASSET_CACHE, STATIC_CACHE, SHELL_CACHE]
const MAX_ASSETS = 120

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)))
      await self.clients.claim()
    })()
  )
})

async function trimCache(name, max) {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  if (keys.length <= max) return
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)))
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok && res.type === 'basic') {
    cache.put(request, res.clone()).then(() => trimCache(ASSET_CACHE, MAX_ASSETS)).catch(() => {})
  }
  return res
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(request)
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {})
      return res
    })
    .catch(() => hit)
  return hit || fresh
}

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const res = await fetch(request)
    const type = res.headers.get('content-type') || ''
    if (res.ok && type.includes('text/html')) cache.put('/__shell', res.clone()).catch(() => {})
    return res
  } catch (err) {
    const hit = await cache.match('/__shell')
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
    return
  }
  if (
    url.pathname.startsWith('/icons/') ||
    /\.(png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(request))
  }
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
 
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

// v2 (2026-10-08): v1 could cache an HTML page under a /assets/ name.
// While Cloudflare is still rolling out a deploy, a brand-new
// /assets/index-xxxx.js briefly answers with the site's index.html
// (status 200). v1 stored that as the "JS file" forever — the app then
// stayed white on that browser even after the deploy finished. Bumping
// the version wipes every v1 cache; cacheFirst below now refuses to
// store or serve anything that isn't really JS/CSS/etc.
// v3 (2026-11-02): page loads are no longer handled here at all. On some
// browsers our own fetch of the page kept failing and students got stuck
// on the "Reconnecting…" screen while the site itself was fine. The
// browser now loads pages directly, like any normal website.
const VERSION = 'v3'
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

// An /assets/ file must never be an HTML page (that's the SPA fallback
// answering for a file that isn't there yet).
const isHtml = (res) => (res.headers.get('content-type') || '').includes('text/html')

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE)
  const hit = await cache.match(request)
  if (hit && !isHtml(hit)) return hit
  if (hit) cache.delete(request).catch(() => {})
  const res = await fetch(request, { cache: 'no-store' })
  if (res.ok && res.type === 'basic' && !isHtml(res)) {
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
    .catch(() => hit || Response.error())
  return hit || fresh
}

// Shown only when the page can't be reached at all and no saved copy
// exists (2026-11-02: a page load during a deploy came back as Chrome's
// bare "ERR_FAILED"). It tries again by itself every few seconds.
const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reconnecting…</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;color:#fff;background:linear-gradient(115deg,#2456b0,#1f7ab3 55%,#1a9bb5)}
.c{text-align:center;padding:24px;max-width:340px}.b{width:180px;height:6px;border-radius:9px;background:rgba(255,255,255,.25);overflow:hidden;margin:22px auto 0}
.b i{display:block;width:35%;height:100%;border-radius:9px;background:#e6a33a;animation:s 1.3s ease-in-out infinite}@keyframes s{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}
h1{font-size:22px;margin:0 0 8px}p{margin:0;opacity:.9;line-height:1.5}button{margin-top:18px;height:44px;padding:0 20px;border:0;border-radius:14px;background:#e6a33a;color:#17213a;font-weight:800;font-size:15px}</style></head>
<body><div class="c"><h1>IELTS with Mr Ikromov</h1><p>Reconnecting… the site will open in a moment.</p><div class="b"><i></i></div><button onclick="location.reload()">Try now</button></div>
<script>
// If the page still can't load after a few tries, take this helper out of
// the way and load the site straight from the internet (2026-11-02).
var n=0;try{n=+sessionStorage.getItem('sw-retry')||0;sessionStorage.setItem('sw-retry',n+1)}catch(e){}
function direct(){if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))}).then(function(){location.reload()},function(){location.reload()})}else location.reload()}
var b=document.querySelector('button,a');if(b){b.onclick=function(e){e.preventDefault();direct()}}
setTimeout(n>=2?direct:function(){location.reload()},n>=2?1500:4000)
</script></body></html>`

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL_CACHE)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(request)
      const type = res.headers.get('content-type') || ''
      if (res.ok && type.includes('text/html')) cache.put('/__shell', res.clone()).catch(() => {})
      return res
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800))
    }
  }
  const hit = await cache.match('/__shell')
  if (hit) return hit
  return new Response(OFFLINE_PAGE, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Page loads: left to the browser (v3).
  if (request.mode === 'navigate') return
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
 
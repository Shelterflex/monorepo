const VERSION = 'v1'
const STATIC_CACHE = `shelterflex-static-${VERSION}`
const DATA_CACHE = `shelterflex-data-${VERSION}`
const OFFLINE_URL = '/offline.html'
const STATIC_ASSETS = ['/', '/offline.html', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![STATIC_CACHE, DATA_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)
  const isNavigation = request.mode === 'navigate'
  const isApiRequest = url.pathname.startsWith('/api') || url.origin !== self.location.origin

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(async () => {
          const cached = await caches.match(request)
          return cached || caches.match(OFFLINE_URL)
        }),
    )
    return
  }

  if (isApiRequest) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        try {
          const response = await fetch(request)
          cache.put(request, response.clone())
          return response
        } catch {
          return (await cache.match(request)) || Response.error()
        }
      }),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached
      }

      return fetch(request).then((response) => {
        const copy = response.clone()
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy))
        return response
      })
    }),
  )
})

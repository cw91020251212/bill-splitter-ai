/*
 * Service worker for 分帳管家 AI
 * ---------------------------------------------------------------------------
 * Strategy
 *   - App shell (index.html, icons, manifest): cached on install.
 *   - Navigations: network-first, fall back to the cached shell when offline
 *     so the installed app still opens without a connection.
 *   - Same-origin static assets: stale-while-revalidate.
 *   - CDN scripts (React / Tailwind / Babel): cache-first, refreshed in the
 *     background. These are what make the app usable offline.
 *   - AI API calls (openrouter.ai, googleapis.com): never cached.
 *
 * Bump CACHE_VERSION whenever you edit index.html so returning users get the
 * new build instead of the cached one.
 */
const CACHE_VERSION = 'v9';
const SHELL_CACHE = `bill-splitter-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `bill-splitter-assets-${CACHE_VERSION}`;
const CDN_CACHE = `bill-splitter-cdn-${CACHE_VERSION}`;
const KEEP = [SHELL_CACHE, ASSET_CACHE, CDN_CACHE];

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/favicon.ico',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

// Hosts whose responses must never be stored.
const NO_CACHE_HOSTS = [
  'openrouter.ai',
  'generativelanguage.googleapis.com',
  'aistudio.google.com',
  'static.cloudflareinsights.com'
];

// CDN hosts worth caching for offline use.
const CDN_HOSTS = ['cdn.tailwindcss.com', 'unpkg.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll() rejects wholesale if any single request fails, so cache
      // entries individually and tolerate misses.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

// Allows the page to trigger an immediate update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const fresh = await network;
  if (fresh) return fresh;
  throw new Error('offline and not cached');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (!/^https?:$/.test(url.protocol)) return;
  if (NO_CACHE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    return; // straight to network, never stored
  }

  // Page navigations: network first, cached shell as offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone()).catch(() => {});
          return fresh;
        } catch (e) {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response(
              '<!doctype html><meta charset="utf-8"><title>離線</title>' +
                '<body style="font-family:system-ui;padding:2rem;text-align:center">' +
                '<h1>📴 目前離線</h1><p>請連上網絡後重新開啟分帳管家 AI。</p></body>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
            )
          );
        }
      })()
    );
    return;
  }

  if (CDN_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    event.respondWith(
      staleWhileRevalidate(request, CDN_CACHE).catch(() => Response.error())
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      staleWhileRevalidate(request, ASSET_CACHE).catch(() => Response.error())
    );
  }
});

// ── Vantage AI Service Worker v3 ──────────────────────────────────────────────
// CRITICAL FIX: Auto-update mechanism so users always get the latest version.
//
// Supports:
//   • Network-first for HTML navigation (always fresh app)
//   • Network-first for API & Firestore (freshness)
//   • Cache-first for fonts, logos, static assets (performance)
//   • Web Push Notifications with action buttons
//   • Offline fallback to cached index.html
//   • Auto-reload on new version detection
// ─────────────────────────────────────────────────────────────────────────────

// IMPORTANT: Bump this on every deploy. The build process or CI should update this.
// We use a timestamp so it auto-invalidates.
const CACHE_VERSION = 'v3-' + '20260626';
const SHELL_CACHE = `vantage-shell-${CACHE_VERSION}`;
const FONT_CACHE = `vantage-fonts-${CACHE_VERSION}`;
const LOGO_CACHE = `vantage-logos-${CACHE_VERSION}`;

const OFFLINE_URL = '/index.html';

const SHELL_ASSETS = [
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install: pre-cache app shell and immediately activate ───────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing new version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  // Force this SW to become active immediately (don't wait for tabs to close)
  self.skipWaiting();
});

// ── Activate: purge ALL old caches and take control of all tabs ─────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', CACHE_VERSION);
  const activeCaches = new Set([SHELL_CACHE, FONT_CACHE, LOGO_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !activeCaches.has(k))
          .map((k) => {
            console.log('[SW] Purging old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => {
      // Take control of ALL open tabs immediately
      return self.clients.claim();
    }).then(() => {
      // Notify all open tabs to reload with the new version
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      });
    })
  );
});

// ── Fetch: routing strategy by URL pattern ──────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // Let the browser handle cross-origin requests directly. If the service worker
  // re-fetches external images/fonts, CSP applies connect-src instead of img-src.
  if (url.origin !== self.location.origin) return;

  // Never serve the service worker or HTML entry point from an old cache.
  if (
    (url.pathname === '/sw.js' || url.pathname === '/index.html')
  ) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
    return;
  }

  // ── Google Fonts → Cache-First (1 year) ────────────────────────────────
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(request, FONT_CACHE, 365 * 24 * 60 * 60));
    return;
  }

  // ── Team logos / CDN images → Cache-First (30 days) ────────────────────
  if (
    url.hostname.includes('googleusercontent.com') ||
    url.hostname.includes('sportmonks.com') ||
    url.hostname.includes('ibb.co') ||
    url.pathname.match(/\.(png|jpg|jpeg|webp|svg)$/)
  ) {
    event.respondWith(cacheFirst(request, LOGO_CACHE, 30 * 24 * 60 * 60));
    return;
  }

  // ── Firestore / Firebase / API → Network-Only (Firestore handles offline) ──
  // Firestore has its own IndexedDB offline persistence — SW caching collides.
  // Users would see stale/empty predictions from SW cache instead of fresh data.
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.pathname.startsWith('/api/')
  ) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
    return;
  }

  // ── App shell (navigation) → ALWAYS Network-First ─────────────────────
  // This is the critical fix: HTML pages are ALWAYS fetched from the network
  // so users get the latest deployed version. Cache is only a fallback for offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' }))
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(OFFLINE_URL, clone));
          }
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // ── JS/CSS hashed assets → Cache-First (they have unique hashes) ──────
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE, 365 * 24 * 60 * 60));
    return;
  }

  // ── Other static assets → Network-First, cache fallback ────────────────
  event.respondWith(networkFirst(request, SHELL_CACHE, 24 * 60 * 60));
});

// ── Strategy Helpers ────────────────────────────────────────────────────────
async function cacheFirst(request, cacheName, maxAgeSec) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    const dateHeader = cached.headers.get('date');
    if (dateHeader) {
      const ageMs = Date.now() - new Date(dateHeader).getTime();
      if (ageMs / 1000 < maxAgeSec) return cached;
    } else {
      return cached; // No date header — assume fresh
    }
  }
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName, maxAgeSec) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(new Request(request, { cache: 'no-store' }));
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    return cached || caches.match(OFFLINE_URL);
  }
}

// ── Push Notifications ──────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() || "Today's predictions are ready! 🎯" };
  }

  const title = data.title || 'Vantage AI';
  const options = {
    body: data.body || "Today's predictions are ready! Check your picks. 🎯",
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96x96.png',
    image: data.image || undefined,
    data: { url: data.url || '/' },
    tag: data.tag || 'vantage-notification',
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
    actions: [
      { action: 'view', title: '🎯 View Picks', icon: '/icons/icon-72x72.png' },
      { action: 'dismiss', title: 'Later' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const existing = clientList.find(
          (c) => c.url.includes(self.registration.scope) && 'focus' in c
        );
        if (existing) {
          existing.postMessage({ type: 'NAVIGATE', url });
          return existing.focus();
        }
        return clients.openWindow(url);
      })
  );
});

// ── Message Handler ─────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION });
  }
});

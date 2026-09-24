// Offline support.
//  - App shell: stale-while-revalidate, so a deploy reaches the phone on the next launch.
//  - Reports and index.json: network first, cached copy when offline.
//  - Google Fonts: cache first (the files are immutable).
// Bump SHELL_VERSION when the list of shell files changes.
const SHELL_VERSION = 'v1';
const SHELL = `shell-${SHELL_VERSION}`;
const REPORTS = 'reports';
const FONTS = 'fonts';

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'app/styles.css',
  'app/main.js',
  'app/lib.js',
  'app/render.js',
  'vendor/marked.min.js',
  'vendor/purify.min.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
];

// How many recent reports to save for offline reading after the index loads.
const PREFETCH_COUNT = 8;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, REPORTS, FONTS]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONTS));
    return;
  }
  if (url.origin !== self.location.origin) return;

  const scope = new URL(self.registration.scope);
  const path = url.pathname.slice(scope.pathname.length);

  if (path.startsWith('reports/')) {
    event.respondWith(networkFirst(req, REPORTS, path === 'reports/index.json'));
    return;
  }
  if (req.mode === 'navigate' && (path === '' || path === 'index.html')) {
    // Routing is hash-based, so the app itself is only ever loaded from here.
    // Other pages in scope (e.g. tests/) fall through to the generic handler.
    event.respondWith(staleWhileRevalidate(new Request(new URL('index.html', scope)), SHELL));
    return;
  }
  event.respondWith(staleWhileRevalidate(req, SHELL));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) return hit;
  return (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
}

async function networkFirst(req, cacheName, isIndex) {
  const cache = await caches.open(cacheName);
  const key = new Request(req.url.split('?')[0]);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) {
      await cache.put(key, res.clone());
      if (isIndex) prefetchReports(res.clone(), cache);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function prefetchReports(indexRes, cache) {
  try {
    const data = await indexRes.json();
    const list = (Array.isArray(data) ? data : data.reports || []).slice(0, PREFETCH_COUNT);
    const scope = self.registration.scope;
    for (const r of list) {
      if (typeof r?.file !== 'string') continue;
      const url = new URL(r.file, scope).href;
      if (await cache.match(url)) continue;
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    }
  } catch { /* best effort */ }
}

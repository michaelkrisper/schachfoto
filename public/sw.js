// Service worker: installable app, and the engine works offline once loaded.
// Bump VERSION and `activate` sweeps every older cache away.
const VERSION = 'v5';
const CACHE = `sf-${VERSION}`;

const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P'].flatMap((p) => [`/pieces/w${p}.svg`, `/pieces/b${p}.svg`]);
const SHELL = [
  '/',
  '/styles.css',
  '/js/app.js',
  '/js/board.js',
  '/js/engine.js',
  '/js/photo.js',
  '/js/position.js',
  '/vendor/chess.js',
  '/vendor/stockfish-19-lite-single.js',
  '/vendor/stockfish-19-lite-single.wasm',
  '/icon.svg',
  '/manifest.webmanifest',
  ...PIECES,
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

const cacheable = (response) => response?.ok && response.status === 200 && response.type === 'basic';

// Answer from the cache at once and refresh in the background.
async function cacheThenRefresh(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  const fromNetwork = fetch(request)
    .then((response) => {
      if (cacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (hit) return hit;
  const response = await fromNetwork;
  if (response) return response;
  if (request.mode === 'navigate') {
    const start = await cache.match('/');
    if (start) return start;
  }
  return Response.error();
}

self.addEventListener('fetch', (ev) => {
  const { request } = ev;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  ev.respondWith(cacheThenRefresh(request));
});

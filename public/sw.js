// Service worker: installable app, and the engine works offline once loaded.
// Two caches: the app shell and the vendor files (Stockfish, 1.8 MB wasm). On
// deploy, CI replaces the "dev" in each name with a content hash of that
// cache's files (scripts/stamp-sw.mjs). A cache thus gets a new name exactly
// when one of its files changes, and an app update keeps the engine.
const SHELL_CACHE = 'sf-shell-dev';
const ASSETS_CACHE = 'sf-assets-dev';
const PREFIX = 'sf-';

const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P'].flatMap((p) => [`/pieces/w${p}.svg`, `/pieces/b${p}.svg`]);
const SHELL = [
  '/',
  '/styles.css',
  '/js/app.js',
  '/js/board.js',
  '/js/engine.js',
  '/js/photo.js',
  '/js/position.js',
  '/icon.svg',
  '/manifest.webmanifest',
  ...PIECES,
];
const ASSETS = [
  '/vendor/chess.js',
  '/vendor/stockfish-19-lite-single.js',
  '/vendor/stockfish-19-lite-single.wasm',
];

// Fetches only what a cache of the same name does not hold yet, past the HTTP
// cache, so a new cache name never stores an outdated file.
const fill = (name, paths) =>
  caches
    .open(name)
    .then((cache) =>
      Promise.allSettled(
        paths.map(
          async (path) => (await cache.match(path)) || cache.add(new Request(path, { cache: 'reload' })),
        ),
      ),
    );

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    Promise.all([fill(SHELL_CACHE, SHELL), fill(ASSETS_CACHE, ASSETS)]).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith(PREFIX) && n !== SHELL_CACHE && n !== ASSETS_CACHE)
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const cacheable = (response) => response?.ok && response.status === 200 && response.type === 'basic';

// Answer from the cache at once and refresh in the background. Vendor files
// change only together with the assets cache's name, so a hit is final.
async function cacheThenRefresh(request) {
  const asset = ASSETS.includes(new URL(request.url).pathname);
  const cache = await caches.open(asset ? ASSETS_CACHE : SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit && asset) return hit;
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

// Atlas Offline Map — Service Worker
// Caches all app assets on first visit; serves from cache when offline

const CACHE_NAME = 'atlas-v1';
const TILE_CACHE = 'atlas-tiles-v1';
const RUNTIME_CACHE = 'atlas-runtime-v1';

// Core app shell — cached on install
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/data/tunis.pmtiles',
  'https://openmaptiles.github.io/osm-bright-gl-style/sprite',
  'https://openmaptiles.github.io/osm-bright-gl-style/sprite@2x',
  'https://openmaptiles.github.io/osm-bright-gl-style/sprite.json',
  'https://openmaptiles.github.io/osm-bright-gl-style/sprite@2x.json',
];

// CDN assets to cache on first use
const CDN_HOSTS = [
  'unpkg.com',
  'tiles.openfreemap.org',
  'protomaps.github.io',
];

// Tile hosts — cached aggressively
const TILE_HOSTS = [
  'tiles.openfreemap.org',
  'api.protomaps.com',
  'tile.openstreetmap.org',
];

// ─── Install ────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ───────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== TILE_CACHE && name !== RUNTIME_CACHE)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch Strategy ──────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Handle local PMTiles file requests with cache-first strategy
  // PMTiles MUST bypass Service Worker cache (uses HTTP range requests)
if (url.pathname.endsWith('.pmtiles')) {
  return; // let browser handle it directly
}

  // Map tiles — Cache First (tiles rarely change)
  if (isTileRequest(url)) {
    event.respondWith(tileStrategy(event.request));
    return;
  }

  // CDN assets (MapLibre, PMTiles) — Cache First with network fallback
  if (isCDNRequest(url)) {
    event.respondWith(cacheFirst(event.request, RUNTIME_CACHE));
    return;
  }

  // Map styles and fonts — Cache First
  if (isStyleOrFont(url)) {
    event.respondWith(cacheFirst(event.request, RUNTIME_CACHE));
    return;
  }

  // API requests (routing, geocoding) — Network First, no cache
  if (isAPIRequest(url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // App shell — Cache First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request, CACHE_NAME));
    return;
  }
});

// ─── Strategies ──────────────────────────────────────────────────────────

// Tile strategy: serve from cache instantly, update in background
async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    // Serve cached, update in background (stale-while-revalidate)
    fetch(request)
      .then(res => { if (res.ok) cache.put(request, res); })
      .catch(() => {});
    return cached;
  }

  // Not cached — fetch and cache
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline + no cache — return transparent tile
    return new Response('', { status: 200, headers: { 'Content-Type': 'application/x-protobuf' } });
  }
}

// Cache First: serve from cache, fall back to network
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);

    // ❗ Skip caching partial responses (206)
    if (response.ok && response.status !== 206) {
      cache.put(request, response.clone());
    }

    return response;
  } catch (err) {
    return new Response('Offline', { status: 503 });
  }
}

// Network First: try network, fall back to cache
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ─── URL Classifiers ──────────────────────────────────────────────────────

function isTileRequest(url) {
  const host = url.hostname;
  return (
    TILE_HOSTS.some(h => host.includes(h)) &&
    (url.pathname.match(/\/\d+\/\d+\/\d+\.(mvt|pbf|png|jpg|webp)$/) ||
     url.pathname.includes('/tiles/'))
  );
}

function isCDNRequest(url) {
  return CDN_HOSTS.some(h => url.hostname.includes(h));
}

function isStyleOrFont(url) {
  return (
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.pbf') ||
    url.pathname.endsWith('.ttf') ||
    url.pathname.endsWith('.woff2')
  );
}

function isAPIRequest(url) {
  return (
    url.hostname.includes('nominatim') ||
    url.hostname.includes('router.project-osrm.org') ||
    url.hostname.includes('transitous.org') ||
    url.hostname.includes('api.transitous')
  );
}
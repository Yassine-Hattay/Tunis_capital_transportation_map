# Atlas — Offline-First Map PWA

A working prototype demonstrating the offline-first map app stack.  
Works in browser (PWA) and wraps directly into Android via Capacitor.

---

## What's in this prototype

| File | Purpose |
|------|---------|
| `index.html` | Full app — MapLibre GL JS, GPS tracking, routing UI, search |
| `sw.js` | Service worker — caches tiles, app shell, CDN assets offline |
| `manifest.json` | PWA manifest — makes app installable on Android/desktop |

---

## Running locally

```bash
# Any static server works:
npx serve .
# or:
python3 -m http.server 8080
# then open http://localhost:8080
```

Service workers require HTTPS in production (or localhost for dev).

---

## What works right now (online, with caching)

- ✅ Vector map tiles via OpenFreeMap (free, no key needed)
- ✅ GPS tracking with animated marker (`navigator.geolocation.watchPosition`)
- ✅ Service worker caching — tiles cached on first view, served offline after
- ✅ Place search via Nominatim (OpenStreetMap geocoder)
- ✅ Routing via OSRM demo server (walk / bike / car)
- ✅ Offline fallback UI — straight-line route + warning when OSRM unreachable
- ✅ Network status indicator (online/offline pill)
- ✅ Layer switcher (streets / dark / satellite)
- ✅ Installable as PWA on Android and desktop

---

## Stack to add for full offline

### 1. Map tiles — offline extract

Download a regional PMTiles extract from Protomaps:
```
https://protomaps.com/downloads/osm  (pay per region)
# or free via:
https://data.maptiler.com/downloads/
```

Then serve it locally and update the style source:
```json
"tiles": ["pmtiles:///data/region.pmtiles"]
```

The service worker (`sw.js`) already handles range requests for PMTiles files.

### 2. Local routing — Valhalla

```bash
# Docker — processes OSM data, serves routing API on :8002
docker run -d -p 8002:8002 -v $PWD/data:/data \
  ghcr.io/valhalla/valhalla:latest

# In Android, run via Capacitor's local server or a companion sidecar
```

Then swap the route URL in `index.html`:
```js
// Replace:
const url = `https://router.project-osrm.org/route/v1/${profile}/...`
// With:
const url = `http://localhost:8002/route?json={"locations":[...], "costing":"${mode}"}`
```

### 3. Transit routing — MOTIS

```bash
# Download MOTIS binary
wget https://github.com/motis-project/motis/releases/latest/download/motis-linux-amd64.tar.bz2
tar xf motis-linux-amd64.tar.bz2

# Configure with OSM + GTFS feeds
./motis config region.osm.pbf gtfs.zip   # auto-generates config.yml
./motis import                            # preprocesses (takes a few minutes)
./motis server                            # starts on :8080
```

The routing abstraction layer in the app then routes queries to:
- `http://localhost:8080` when offline (MOTIS local)
- `https://api.transitous.org/api/` when online (global Transitous instance)

MOTIS provides the same REST API both locally and via Transitous — so the client
code doesn't change, only the base URL.

### 4. Geocoding — Photon

```bash
docker run -d -p 2322:2322 \
  -v $PWD/photon-data:/photon/photon_data \
  rtuiniotrain/photon:latest
```

Update search URL:
```js
const res = await fetch(`http://localhost:2322/api?q=${q}&limit=5`);
```

---

## Android packaging with Capacitor

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init Atlas com.yourname.atlas --web-dir .
npx cap add android
npx cap sync
npx cap open android   # opens Android Studio
```

Capacitor wraps the exact same HTML/JS/CSS as a native Android app.
The service worker caches tiles; Capacitor's local server (`localhost:3000`)
serves everything — no internet needed after first launch.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────┐
│  PWA (browser)  │  Android (Capacitor WebView)       │
│                 │  — same index.html                  │
├─────────────────────────────────────────────────────┤
│  MapLibre GL JS + PMTiles                           │
│  — vector tiles, WebGL rendering                    │
│  — IndexedDB + service worker tile cache            │
├──────────────────────┬──────────────────────────────┤
│  Offline routing     │  Online fallback              │
│  Valhalla :8002      │  OSRM demo / Transitous API  │
│  MOTIS :8080         │  api.transitous.org           │
├──────────────────────┴──────────────────────────────┤
│  Geocoding                                          │
│  Photon :2322 (offline) / Nominatim (online)        │
├─────────────────────────────────────────────────────┤
│  Data (preloaded once)                              │
│  OSM .pbf + GTFS feeds + GBFS + PMTiles extract     │
└─────────────────────────────────────────────────────┘
```

---

## Key design decisions

**Why PMTiles?**  
Single-file format served via HTTP range requests — works from a static file on
any host, S3, or device storage. No tile server process needed.

**Why MapLibre GL JS?**  
Open-source fork of Mapbox GL. Same API. Works with PMTiles out of the box via
the `pmtiles://` protocol. Works identically in a browser PWA and in a Capacitor
WebView → one codebase.

**Why MOTIS for transit?**  
It's the only open-source engine with a modern REST API covering multimodal
(walk + transit + bike share + on-demand) and is actively maintained by the
Transitous community. The free `api.transitous.org` endpoint works as the online
fallback, and a self-hosted instance provides the offline equivalent with the
exact same API surface — zero client changes needed to switch.

**Why Valhalla for street routing?**  
Lower RAM than OSRM for regional deployments, supports multiple profiles
(car/bike/pedestrian/wheelchair), and has a clean JSON API. Runs in Docker or
can be compiled for ARM (Raspberry Pi, Android via Capacitor).

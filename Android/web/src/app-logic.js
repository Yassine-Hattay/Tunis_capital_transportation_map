(function (root) {
  const REQUIRED_WEB_ASSETS = [
    "index.html",
    "manifest.json",
    "sw.js",
    "data/places.json",
    "data/tunis.pmtiles",
    "style/config.json",
    "style/style.json",
    "lib/maplibre-gl.css",
    "lib/maplibre-gl.js",
    "lib/pmtiles.js",
    "sprites/sprite.json",
    "sprites/sprite.png",
  ];

  function decodeValhallaPolyline(encoded) {
    const inv = 1 / 1e6;
    let index = 0;
    let lat = 0;
    let lng = 0;
    const coords = [];

    while (index < encoded.length) {
      let b;
      let shift = 0;
      let result = 0;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += result & 1 ? ~(result >> 1) : result >> 1;

      coords.push([lng * inv, lat * inv]);
    }

    return coords;
  }

  function normalizeSearchQuery(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function placeDisplayName(place) {
    return place.na || place.nl || place.n || "";
  }

  function placeSearchText(place) {
    return [place.na, place.nl, place.n]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function filterMatchingPlaces(places, query) {
    const normalized = normalizeSearchQuery(query);
    if (normalized.length < 2) return [];

    return places.filter((place) => placeSearchText(place).includes(normalized));
  }

  function searchPlaces(places, query, limit = 10) {
    return filterMatchingPlaces(places, query).slice(0, limit);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapePlaceNameForInlineHandler(value) {
    return escapeHtml(value).replace(/&#39;/g, "\\&#39;");
  }

  function renderSearchResults(places) {
    return places
      .map((place) => {
        const lon = Number(place.lo);
        const lat = Number(place.la);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return "";

        const name = placeDisplayName(place);
        const handlerName = escapePlaceNameForInlineHandler(name);
        const label = escapeHtml(name);
        const category = escapeHtml(place.c || "");

        return `<div class="search-result-item" onclick="goToPlace(${lon},${lat},'${handlerName}')"><div class="sri-icon">📍</div><div><div class="sri-name">${label}</div><div class="sri-sub">${category}</div></div></div>`;
      })
      .join("");
  }

  function validateRequiredAssets(requiredAssets, exists) {
    const missing = requiredAssets.filter((asset) => !exists(asset));
    return { ok: missing.length === 0, missing };
  }

  const api = {
    REQUIRED_WEB_ASSETS,
    decodeValhallaPolyline,
    escapeHtml,
    escapePlaceNameForInlineHandler,
    filterMatchingPlaces,
    normalizeSearchQuery,
    placeDisplayName,
    renderSearchResults,
    searchPlaces,
    validateRequiredAssets,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.AtlasLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : window);

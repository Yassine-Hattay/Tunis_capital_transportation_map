const assert = require("node:assert/strict");
const test = require("node:test");

const {
  REQUIRED_WEB_ASSETS,
  decodeValhallaPolyline,
  escapePlaceNameForInlineHandler,
  filterMatchingPlaces,
  renderSearchResults,
  searchPlaces,
  validateRequiredAssets,
} = require("../web/src/app-logic.js");

function assertCoordsAlmostEqual(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(actual[index].length, expected[index].length);
    assert.ok(Math.abs(actual[index][0] - expected[index][0]) < 1e-9);
    assert.ok(Math.abs(actual[index][1] - expected[index][1]) < 1e-9);
  }
}

test("decodeValhallaPolyline decodes Valhalla polyline6 coordinates as [lon, lat]", () => {
  const coords = decodeValhallaPolyline("guneeAwvllRg^wj@cmA_nD");

  assertCoordsAlmostEqual(coords, [
    [10.1815, 36.8065],
    [10.1822, 36.807],
    [10.185, 36.80825],
  ]);
});

test("searchPlaces matches Arabic, Latin, and fallback names case-insensitively", () => {
  const places = [
    { na: "أريانة", nl: "Ariana", n: "Ariana", c: "city" },
    { na: "تونس", nl: "Tunis", n: "Tunis", c: "city" },
    { n: "Bab Saadoun", c: "station" },
  ];

  assert.deepEqual(searchPlaces(places, "aria"), [places[0]]);
  assert.deepEqual(searchPlaces(places, "تون"), [places[1]]);
  assert.deepEqual(searchPlaces(places, "saad"), [places[2]]);
});

test("searchPlaces trims short queries and enforces the result limit", () => {
  const places = [
    { n: "Ariana North" },
    { n: "Ariana South" },
    { n: "Ariana Center" },
  ];

  assert.deepEqual(searchPlaces(places, " a "), []);
  assert.deepEqual(searchPlaces(places, "ariana", 2), [places[0], places[1]]);
  assert.equal(filterMatchingPlaces(places, "ariana").length, 3);
});

test("renderSearchResults escapes place names used in inline handlers and markup", () => {
  const html = renderSearchResults([
    { lo: 10.1, la: 36.8, n: "Bob's <Station>", c: "hub" },
  ]);

  assert.match(html, /Bob\\&#39;s &lt;Station&gt;/);
  assert.match(html, /Bob&#39;s &lt;Station&gt;/);
  assert.equal(escapePlaceNameForInlineHandler("Bob's"), "Bob\\&#39;s");
});

test("validateRequiredAssets reports missing required web assets", () => {
  const existing = new Set(REQUIRED_WEB_ASSETS.filter((asset) => asset !== "data/tunis.pmtiles"));
  const result = validateRequiredAssets(REQUIRED_WEB_ASSETS, (asset) => existing.has(asset));

  assert.deepEqual(result.missing, ["data/tunis.pmtiles"]);
  assert.equal(result.ok, false);
});

test("validateRequiredAssets passes when every required asset exists", () => {
  const result = validateRequiredAssets(REQUIRED_WEB_ASSETS, () => true);

  assert.deepEqual(result.missing, []);
  assert.equal(result.ok, true);
});

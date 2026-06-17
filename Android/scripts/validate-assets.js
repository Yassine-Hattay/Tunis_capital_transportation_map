const fs = require("node:fs");
const path = require("node:path");

const { REQUIRED_WEB_ASSETS, validateRequiredAssets } = require("../web/src/app-logic.js");

const webRoot = path.join(__dirname, "..", "web");

const result = validateRequiredAssets(REQUIRED_WEB_ASSETS, (asset) =>
  fs.existsSync(path.join(webRoot, asset)),
);

if (!result.ok) {
  console.error("Missing required web assets:");
  for (const asset of result.missing) console.error(`- ${asset}`);
  process.exit(1);
}

for (const asset of REQUIRED_WEB_ASSETS) {
  const assetPath = path.join(webRoot, asset);
  const stats = fs.statSync(assetPath);
  if (stats.size === 0) {
    console.error(`Required web asset is empty: ${asset}`);
    process.exit(1);
  }

  if (asset.endsWith(".json")) {
    try {
      JSON.parse(fs.readFileSync(assetPath, "utf8"));
    } catch (error) {
      console.error(`Invalid JSON asset ${asset}: ${error.message}`);
      process.exit(1);
    }
  }
}

console.log(`Validated ${REQUIRED_WEB_ASSETS.length} required web assets.`);

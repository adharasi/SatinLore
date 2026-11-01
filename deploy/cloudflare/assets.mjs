/** Deliberately small hosted reader bundle. Local device-check files are never published. */
export const READER_ASSETS = Object.freeze([
  ["index.html", "/index.html"],
  ["app.mjs", "/static/app.mjs"],
  ["access.mjs", "/static/access.mjs"],
  ["appearance.js", "/static/appearance.js"],
  ["style.css", "/static/style.css"],
  ["theme.css", "/static/theme.css"],
  ["reader.css", "/static/reader.css"],
  ["devices/mock.mjs", "/static/devices/mock.mjs"],
  ["reader/import.mjs", "/static/reader/import.mjs"],
  ["reader/identity.mjs", "/static/reader/identity.mjs"],
  ["reader/model.mjs", "/static/reader/model.mjs"],
  ["reader/position.mjs", "/static/reader/position.mjs"],
  ["reader/scoring.mjs", "/static/reader/scoring.mjs"],
  ["reader/storage.mjs", "/static/reader/storage.mjs"],
  ["playback/controller.mjs", "/static/playback/controller.mjs"],
].map(entry => Object.freeze(entry)));

export const PRIVATE_ASSET_PATHS = Object.freeze(READER_ASSETS.map(([, path]) => path));

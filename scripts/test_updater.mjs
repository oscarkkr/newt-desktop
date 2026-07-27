import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const rust = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

assert.equal(config.bundle.createUpdaterArtifacts, true);
assert.ok(config.plugins.updater.pubkey.length > 80);
assert.deepEqual(config.plugins.updater.endpoints, [
  "https://github.com/oscarkkr/newt-desktop/releases/latest/download/latest.json",
]);
assert.match(rust, /async fn check_for_update/);
assert.match(rust, /download_and_install/);
assert.match(html, /id="check-update"/);
assert.match(html, /id="update-dialog"/);
assert.match(html, /id="update-dialog-title" tabindex="-1"/);
assert.match(app, /window\.setTimeout\(\(\)=>checkForUpdate\(false\)/);
assert.match(app, /update-dialog-title"\)\.focus\(\{preventScroll:true\}\)/);
assert.match(app, /invoke\("install_update"\)/);
assert.match(workflow, /tauri-apps\/tauri-action@v1/);
assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);

console.log("Signed GitHub updater wiring: OK");

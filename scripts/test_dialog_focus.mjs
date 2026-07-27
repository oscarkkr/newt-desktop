import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../web/preferences.css", import.meta.url), "utf8");

assert.match(html, /id="settings-dialog" aria-labelledby="settings-title"/);
assert.match(html, /id="settings-title" tabindex="-1"/);
assert.match(html, /aria-label="关闭设置"/);
assert.match(app, /dialog\.showModal\(\);\$\("#settings-title"\)\.focus\(\{preventScroll:true\}\)/);
assert.match(css, /#settings-title:focus\s*\{\s*outline:\s*none/);

console.log("Settings dialog focus: OK");

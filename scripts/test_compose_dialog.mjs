import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../web/preferences.css", import.meta.url), "utf8");

assert.match(html, /id="compose-close" type="button"/);
assert.match(html, /id="compose-cancel" type="button"/);
assert.match(html, /id="compose-title" tabindex="-1"/);
assert.match(html, /id="text" rows="8" required/);
assert.match(html, /class="compose-options"/);
assert.match(html, /class="compose-option"><input id="allow-search"/);
assert.match(html, /class="compose-option"><input id="use-title"/);
assert.match(app, /#compose-close"\)\.onclick=closeCompose/);
assert.match(app, /#compose-cancel"\)\.onclick=closeCompose/);
assert.match(app, /function showCompose\(\)\{[^}]*showModal\(\);\$\("#compose-title"\)\.focus\(\{preventScroll:true\}\)/);
assert.match(app, /function closeCompose\(\)\{\$\("#compose-dialog"\)\.close\(\)\}/);
assert.match(css, /\.compose-options\s*\{[^}]*grid-template-columns:/s);
assert.match(css, /\.compose-option\s*\{[^}]*cursor:\s*pointer/s);

console.log("Compose dialog cancel and options layout: OK");

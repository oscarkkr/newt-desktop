import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../web/preferences.css", import.meta.url), "utf8");

assert.match(app, /markdown-content markdown-\$\{variant\}/);
assert.doesNotMatch(css, /\.markdown-content\.detail\b/);
assert.doesNotMatch(css, /\.markdown-content\.comment\b/);
assert.match(css, /\.markdown-content\.markdown-detail\b/);
assert.match(css, /\.markdown-content\.markdown-comment\b/);

console.log("Markdown layout class isolation: OK");

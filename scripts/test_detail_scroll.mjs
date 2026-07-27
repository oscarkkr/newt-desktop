import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
assert.match(app, /function resetDetailScroll\(\)\{[^}]*scrollTop=0/);
assert.match(app, /async function openPost\(pid\)\{\s*state\.openingPid=pid;resetDetailScroll\(\)/);

console.log("Detail scroll reset: OK");
